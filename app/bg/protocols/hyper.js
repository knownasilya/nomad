import { webContents } from 'electron';
import { parseDriveUrl } from '../../lib/urls';
import { toNiceUrl } from '../../lib/strings';
import { Readable } from 'stream';
import parseRange from 'range-parser';
import once from 'once';
import b4a from 'b4a';
import * as logLib from '../logger';
import markdown from '../../lib/markdown';
import * as drives from '../hyper/drives';
import * as autobases from '../hyper/autobases';
import * as filesystem from '../filesystem/index';
import * as capabilities from '../hyper/capabilities';
import errorPage from '../lib/error-page';
import * as mime from '../lib/mime';
import * as auditLog from '../dbs/audit-log';
import * as wcTrust from '../wc-trust';

const logger = logLib.child({ category: 'hyper', subcategory: 'hyper-scheme' });
const md = markdown({
  allowHTML: true,
  useHeadingIds: true,
  useHeadingAnchors: false,
  hrefMassager: undefined,
  highlight: undefined,
});

class WhackAMoleStream {
  constructor(stream) {
    this.onreadable = noop;
    this.ended = false;
    this.stream = stream;
    this.needsDeferredReadable = false;
    this.readableOnce = false;

    stream.on('end', () => {
      this.ended = true;
    });

    stream.on('readable', () => {
      this.readableOnce = true;

      if (this.needsDeferredReadable) {
        setImmediate(this.onreadable);
        this.needsDeferredReadable = false;
        return;
      }

      this.onreadable();
    });
  }

  read(...args) {
    const buf = this.stream.read(...args);
    this.needsDeferredReadable = buf === null;
    return buf;
  }

  on(name, fn) {
    if (name === 'readable') {
      this.onreadable = fn;
      if (this.readableOnce) fn();
      return this.stream.on('readable', noop); // readable has sideeffects
    }

    return this.stream.on(name, fn);
  }

  destroy() {
    this.stream.on('error', noop);
    this.stream.destroy();
  }

  removeListener(name, fn) {
    this.stream.removeListener(name, fn);

    if (name === 'readable') {
      this.onreadable = noop;
      this.stream.removeListener('readable', noop);
    }

    if (name === 'end' && !this.ended) {
      this.destroy();
    }
  }
}

function noop() {}

// exported api
// =

export function register(protocol) {
  protocol.registerStreamProtocol('hyper', protocolHandler);
}

export const protocolHandler = async function (request, respond) {
  var drive;
  var cspHeader = undefined;
  var corsHeader = '*';
  var customFrontend = false;
  var wantsHTML = mime.acceptHeaderWantsHTML(request.headers.Accept);
  const logUrl = toNiceUrl(request.url);

  respond = once(respond);
  const respondBuiltinFrontend = async () => {
    // session.webRequest.onCompleted does not fire for hyper:// (custom protocol).
    // Set WC trust directly now that we know we're serving a trusted interface.
    if (request.webContentsId) {
      const wc = webContents.fromId(request.webContentsId);
      if (wc) wcTrust.setWcTrust(wc, wcTrust.TRUST.TRUSTED);
    }
    return respond({
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': corsHeader,
        'Allow-CSP-From': '*',
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': `default-src beaker:; img-src * data: asset: blob:; media-src * data: asset: blob:; style-src beaker: 'unsafe-inline';`,
        'Beaker-Trusted-Interface': '1', // see wc-trust.js
      },
      data: intoStream(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <link rel="stylesheet" href="beaker://app-stdlib/css/fontawesome.css">
    <script type="module" src="beaker://drive-view/index.js"></script>
  </head>
</html>`),
    });
  };
  const respondCustomFrontend = async (checkoutFS) => {
    return respond({
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': corsHeader,
        'Allow-CSP-From': '*',
        'Content-Security-Policy': cspHeader,
      },
      data: intoStream(b4a.toString(await checkoutFS.drive.get('/.ui/ui.html') || b4a.alloc(0))),
    });
  };
  const respondRedirect = (url) => {
    respond({
      statusCode: 200,
      headers: { 'Content-Type': 'text/html', 'Allow-CSP-From': '*' },
      data: intoStream(
        `<!doctype html><meta http-equiv="refresh" content="0; url=${url}">`
      ),
    });
  };
  const respondError = (code, status, errorPageInfo) => {
    if (errorPageInfo) {
      errorPageInfo.validatedURL = request.url;
      errorPageInfo.errorCode = code;
    }
    var accept = request.headers.Accept || '';
    if (accept.includes('text/html')) {
      respond({
        statusCode: code,
        headers: {
          'Content-Type': 'text/html',
          'Content-Security-Policy': "default-src 'unsafe-inline' beaker:;",
          'Access-Control-Allow-Origin': corsHeader,
          'Allow-CSP-From': '*',
        },
        data: intoStream(errorPage(errorPageInfo || code + ' ' + status)),
      });
    } else {
      respond({ statusCode: code });
    }
  };

  // validate request
  logger.silly(`Starting ${logUrl}`, { url: request.url });
  var urlp = parseDriveUrl(request.url, true);
  if (!urlp.host) {
    return respondError(404, 'Drive Not Found', {
      title: 'Site Not Found',
      errorDescription: 'Invalid URL',
      errorInfo: `${request.url} is an invalid hyper:// URL`,
    });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return respondError(405, 'Method Not Supported');
  }

  // resolve the name
  var driveKey;
  var driveVersion;
  if (urlp.host.endsWith('.cap')) {
    let cap = capabilities.lookupCap(urlp.host);
    if (!cap) {
      return respondError(404, 'No record found for ' + urlp.host, {
        errorDescription: 'Invalid capability record',
        errorInfo: `No record found for hyper://${urlp.host}`,
      });
    }
    driveKey = cap.target.key;
    driveVersion = cap.target.version;
  } else {
    try {
      if (urlp.host === 'private' && request.webContentsId) {
        // Resolve hyper://private/ per-request using the requesting tab's space,
        // so multiple windows with different active spaces each see their own root drive.
        const spaceId = filesystem.getSpaceIdForWebContents(request.webContentsId);
        const spaceUrl = spaceId ? filesystem.getSpaceRootDriveUrl(spaceId) : null;
        if (spaceUrl) {
          driveKey = await drives.fromURLToKey(spaceUrl, true);
        } else {
          driveKey = await drives.fromURLToKey(urlp.host, true);
        }
      } else {
        driveKey = await drives.fromURLToKey(urlp.host, true);
      }
      driveVersion = urlp.version;
    } catch (err) {
      return respondError(404, 'No DNS record found for ' + urlp.host, {
        errorDescription: 'No DNS record found',
        errorInfo: `No DNS record found for hyper://${urlp.host}`,
      });
    }
  }

  // protect the system drive
  if (filesystem.isRootUrl(`hyper://${driveKey}/`)) {
    corsHeader = undefined;
  }

  auditLog.record(
    '-browser',
    'serve',
    { url: urlp.origin, path: urlp.pathname },
    undefined,
    async () => {
      // check if this URL belongs to an autobase collaborative drive
      const driveCfg = filesystem.getDriveConfig(driveKey);
      if (driveCfg && driveCfg.type === 'autobase') {
        logger.silly(`Serving autobase drive ${logUrl}`, { url: request.url });
        return serveAutobase(driveKey, urlp, request, respond, respondError, respondRedirect);
      }

      try {
        // start searching the network
        logger.silly(`Loading drive for ${logUrl}`, { url: request.url });
        drive = await drives.getOrLoadDrive(driveKey);
      } catch (err) {
        logger.warn(`Failed to open drive ${driveKey}`, { err });
        return respondError(500, 'Failed');
      }

      // parse path
      let filepath = decodeURIComponent(urlp.path);
      if (!filepath) filepath = '/';
      if (filepath.indexOf('?') !== -1) {
        filepath = filepath.slice(0, filepath.indexOf('?')); // strip off any query params
      }
      let hasTrailingSlash = filepath.endsWith('/');

      // checkout version if needed
      let checkoutFS;
      try {
        const checkout = await drives.getDriveCheckout(drive, driveVersion);
        checkoutFS = checkout.checkoutFS;
      } catch (err) {
        logger.warn(`Failed to open drive checkout ${driveKey}`, { err });
        return respondError(500, 'Failed');
      }

      // read /index.json (used for CSP and path resolution)
      let manifest = null;
      try {
        const buf = await checkoutFS.drive.get('/index.json');
        if (buf) manifest = JSON.parse(b4a.toString(buf));
      } catch (e) {}

      // check to see if we actually have data from the drive
      if (checkoutFS.drive.version === 0) {
        logger.silly(`Drive not found ${logUrl}`, { url: request.url });
        return respondError(404, 'Site not found', {
          title: 'Site Not Found',
          errorDescription: 'No peers hosting this site were found',
          errorInfo:
            'You may still be connecting to peers - try reloading the page.',
        });
      }

      // read manifest CSP
      if (manifest && manifest.csp && typeof manifest.csp === 'string') {
        cspHeader = manifest.csp;
      }

      // check for the presence of a frontend
      const uiEntry = await checkoutFS.drive.entry('/.ui/ui.html').catch(() => null);
      if (uiEntry) customFrontend = true;

      // resolve request path to a drive entry
      let statusCode = 200;
      let headers = {};
      let canExecuteHTML = true;
      let entry = await _resolveEntry(checkoutFS.drive, filepath, hasTrailingSlash);

      // handle folder
      if (entry && entry.isDirectory()) {
        if (!hasTrailingSlash) {
          // make sure there's a trailing slash
          logger.silly(`Redirecting to trailing slash ${logUrl}`, {
            url: request.url,
          });
          return respondRedirect(
            `hyper://${urlp.host}${urlp.version ? '+' + urlp.version : ''}${
              urlp.pathname || ''
            }/${urlp.search || ''}`
          );
        }

        if (customFrontend) {
          logger.silly(`Serving custom frontend ${logUrl}`, {
            url: request.url,
          });
          return respondCustomFrontend(checkoutFS);
        }

        logger.silly(`Serving builtin frontend ${logUrl}`, {
          url: request.url,
        });
        return respondBuiltinFrontend();
      }

      // custom frontend
      if (customFrontend && wantsHTML) {
        logger.silly(`Serving custom frontend ${logUrl}`, { url: request.url });
        return respondCustomFrontend(checkoutFS);
      }

      // 404
      if (!entry) {
        logger.silly('Not found', { url: request.url });
        return respondError(404, 'File Not Found', {
          errorDescription: 'File Not Found',
          errorInfo: `Nomad could not find the file at ${urlp.path}`,
          title: 'File Not Found',
        });
      }

      // handle .goto redirects
      if (entry.path.endsWith('.goto') && entry.metadata.href) {
        try {
          let u = new URL(entry.metadata.href); // make sure it's a valid url
          logger.silly(
            `Redirecting for .goto ${logUrl} to ${entry.metadata.href}`,
            { url: request.url, href: entry.metadata.href }
          );
          return respondRedirect(entry.metadata.href);
        } catch (e) {
          // pass through
        }
      }

      // detect mimetype
      let mimeType = entry.metadata.mimetype || entry.metadata.mimeType;
      if (!mimeType) {
        mimeType = mime.identify(entry.path);
      }
      if (!canExecuteHTML && mimeType.includes('text/html')) {
        mimeType = 'text/plain';
      }

      // handle range
      headers['Accept-Ranges'] = 'bytes';
      let length;
      let range = request.headers.Range || request.headers.range;
      if (range) range = parseRange(entry.size, range);
      if (range && range.type === 'bytes') {
        range = range[0]; // only handle first range given
        statusCode = 206;
        length = range.end - range.start + 1;
        headers['Content-Length'] = '' + length;
        headers['Content-Range'] =
          'bytes ' + range.start + '-' + range.end + '/' + entry.size;
      } else {
        if (entry.size) {
          length = entry.size;
          headers['Content-Length'] = '' + length;
        }
      }

      Object.assign(headers, {
        'Content-Security-Policy': cspHeader,
        'Access-Control-Allow-Origin': corsHeader,
        'Allow-CSP-From': '*',
        'Cache-Control': 'no-cache',
      });

      // Read file buffer once (drives are in-process; no streaming needed)
      const fileBuf = await checkoutFS.drive.get(entry.path);
      if (!fileBuf) {
        return respondError(404, 'File Not Found', {
          errorDescription: 'File Not Found',
          errorInfo: `Nomad could not find the file at ${urlp.path}`,
          title: 'File Not Found',
        });
      }

      // markdown rendering
      if (
        !range &&
        entry.path.endsWith('.md') &&
        mime.acceptHeaderWantsHTML(request.headers.Accept)
      ) {
        let content = b4a.toString(fileBuf);
        let contentType = canExecuteHTML ? 'text/html' : 'text/plain';
        content = canExecuteHTML
          ? `<!doctype html>
<html>
  <head>
    <meta charset="utf8">
    <style>
      body {
        font-family: sans-serif;
        max-width: 800px;
        margin: 0 auto;
        padding: 0 10px;
        line-height: 1.4;
      }
      body * {
        max-width: 100%;
      }
    </style>
  </head>
  <body>
    ${md.render(content)}
  </body>
</html>`
          : content;
        logger.silly(`Serving markdown ${logUrl}`, { url: request.url });
        return respond({
          statusCode: 200,
          headers: Object.assign(headers, { 'Content-Type': contentType }),
          data: intoStream(content),
        });
      }

      if (!mimeType) {
        mimeType = mime.identify(entry.path, fileBuf.slice(0, 512));
      }
      if (!canExecuteHTML && mimeType.includes('text/html')) {
        mimeType = 'text/plain';
      }
      headers['Content-Type'] = mimeType;
      logger.silly(`Serving file ${logUrl}`, { url: request.url });

      // apply byte range if requested
      let body = fileBuf;
      if (range && range !== -1 && range !== -2 && range.type === 'bytes' && range[0]) {
        const r = range[0];
        body = fileBuf.slice(r.start, r.end + 1);
      }

      if (request.method === 'HEAD') {
        respond({ statusCode: 204, headers, data: intoStream('') });
      } else {
        respond({
          statusCode,
          headers,
          data: new WhackAMoleStream(Readable.from(body)),
        });
      }
    }
  );
};

function intoStream(text) {
  return new Readable({
    read() {
      this.push(typeof text === 'string' ? b4a.from(text) : text);
      this.push(null);
    },
  });
}

async function serveAutobase(driveKey, urlp, request, respond, respondError, respondRedirect) {
  let sess;
  try {
    sess = await autobases.getOrLoadCollaborativeDrive(driveKey);
    if (!sess) throw new Error('Not found');
  } catch (err) {
    logger.warn(`Failed to load autobase ${driveKey}`, { err });
    return respondError(500, 'Failed to load collaborative drive');
  }

  const bee = sess.drive;

  let filepath = decodeURIComponent(urlp.path);
  if (!filepath) filepath = '/';
  if (filepath.indexOf('?') !== -1) filepath = filepath.slice(0, filepath.indexOf('?'));
  const hasTrailingSlash = filepath.endsWith('/');

  // Check for custom frontend at /.ui/ui.html
  const uiNode = await bee.get('/.ui/ui.html').catch(() => null);
  if (uiNode) {
    // Any HTML-wanting request to a "directory-like" path → serve the UI
    const wantsHTML = mime.acceptHeaderWantsHTML(request.headers.Accept)
    if (wantsHTML && (filepath === '/' || hasTrailingSlash || !filepath.includes('.'))) {
      const buf = uiNode.value
      return respond({
        statusCode: 200,
        headers: {
          'Content-Type': 'text/html',
          'Access-Control-Allow-Origin': '*',
          'Allow-CSP-From': '*',
          'Cache-Control': 'no-cache',
        },
        data: intoStream(buf),
      });
    }
  }

  // Serve the requested file from Hyperbee
  const lookupPath = filepath.replace(/\/$/, '') || '/'

  // Try exact path first
  let node = await bee.get(lookupPath).catch(() => null)

  // Try directory index files
  if (!node) {
    const prefix = lookupPath.endsWith('/') ? lookupPath : lookupPath + '/'
    for (const name of ['index.html', 'index.md']) {
      node = await bee.get(prefix + name).catch(() => null)
      if (node) { filepath = prefix + name; break }
    }
  }

  if (!node) {
    return respondError(404, 'File Not Found', {
      errorDescription: 'File Not Found',
      errorInfo: `Could not find ${urlp.path} in this collaborative drive`,
      title: 'File Not Found',
    });
  }

  const buf = node.value
  const mimeType = mime.identify(node.key)
  return respond({
    statusCode: 200,
    headers: {
      'Content-Type': mimeType || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Allow-CSP-From': '*',
      'Cache-Control': 'no-cache',
    },
    data: new WhackAMoleStream(Readable.from(buf)),
  });
}

/**
 * Resolve a request path to a drive entry object.
 * Returns null if not found.
 */
async function _resolveEntry(drive, filepath, hasTrailingSlash) {
  // Normalise: strip trailing slash for entry lookup
  const lookupPath = filepath.replace(/\/$/, '') || '/';

  // Try exact file
  const entry = await drive.entry(lookupPath).catch(() => null);
  if (entry && entry.value?.blob) {
    return {
      path: entry.key,
      size: entry.value.blob.byteLength || 0,
      metadata: entry.value.metadata || {},
      isDirectory() { return false; },
    };
  }

  // Try as directory: look for index files
  const prefix = lookupPath.endsWith('/') ? lookupPath : lookupPath + '/';
  for (const name of ['index.html', 'index.md', 'index.txt']) {
    const idxEntry = await drive.entry(prefix + name).catch(() => null);
    if (idxEntry && idxEntry.value?.blob) {
      if (!hasTrailingSlash) {
        // Signal caller to redirect (return as directory so redirect fires)
        return { path: prefix, size: 0, metadata: {}, isDirectory() { return true; } };
      }
      return {
        path: prefix + name,
        size: idxEntry.value.blob.byteLength || 0,
        metadata: idxEntry.value.metadata || {},
        isDirectory() { return false; },
      };
    }
  }

  // Check if any entries exist under this prefix (i.e., it's a directory)
  // eslint-disable-next-line no-unreachable-loop
  for await (const _e of drive.list(prefix, { recursive: false })) {
    return { path: prefix, size: 0, metadata: {}, isDirectory() { return true; } };
  }

  return null;
}
