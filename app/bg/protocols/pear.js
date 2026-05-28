import { parseDriveUrl } from '../../lib/urls';
import { toNiceUrl } from '../../lib/strings';
import { Readable } from 'stream';
import parseRange from 'range-parser';
import once from 'once';
import * as logLib from '../logger';
import markdown from '../../lib/markdown';
import * as drives from '../hyper/drives';
import * as filesystem from '../filesystem/index';
import * as capabilities from '../hyper/capabilities';
import datServeResolvePath from '@beaker/dat-serve-resolve-path';
import errorPage from '../lib/error-page';
import * as mime from '../lib/mime';
import * as auditLog from '../dbs/audit-log';

const logger = logLib.child({ category: 'pear', subcategory: 'pear-scheme' });
const md = markdown({
  allowHTML: true,
  useHeadingIds: true,
  useHeadingAnchors: false,
  hrefMassager: undefined,
  highlight: undefined,
});

// exported api
// =

export function register(protocol) {
  protocol.registerStreamProtocol('pear', protocolHandler);
}

export const protocolHandler = async function (request, respond) {
  var drive;
  var cspHeader = undefined;
  var corsHeader = '*';
  var customFrontend = false;
  var wantsHTML = mime.acceptHeaderWantsHTML(request.headers.Accept);
  const logUrl = toNiceUrl(request.url);

  respond = once(respond);

  // pear.js serves via the same Hypercore/Hyperdrive infrastructure as hyper://,
  // but uses the pear:// scheme in all redirects and error messages.
  // We also read pear.json (Pear v2 app manifest) in addition to index.json.

  const respondBuiltinFrontend = async () => {
    return respond({
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html',
        'Access-Control-Allow-Origin': corsHeader,
        'Allow-CSP-From': '*',
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': `default-src beaker:; img-src * data: asset: blob:; media-src * data: asset: blob:; style-src beaker: 'unsafe-inline';`,
        'Beaker-Trusted-Interface': '1',
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
      data: intoStream(await checkoutFS.pda.readFile('/.ui/ui.html')),
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

  logger.silly(`Starting ${logUrl}`, { url: request.url });
  var urlp = parseDriveUrl(request.url, true);
  if (!urlp.host) {
    return respondError(404, 'Drive Not Found', {
      title: 'Site Not Found',
      errorDescription: 'Invalid URL',
      errorInfo: `${request.url} is an invalid pear:// URL`,
    });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return respondError(405, 'Method Not Supported');
  }

  var driveKey;
  var driveVersion;
  if (urlp.host.endsWith('.cap')) {
    let cap = capabilities.lookupCap(urlp.host);
    if (!cap) {
      return respondError(404, 'No record found for ' + urlp.host, {
        errorDescription: 'Invalid capability record',
        errorInfo: `No record found for pear://${urlp.host}`,
      });
    }
    driveKey = cap.target.key;
    driveVersion = cap.target.version;
  } else {
    try {
      driveKey = await drives.fromURLToKey(urlp.host, true);
      driveVersion = urlp.version;
    } catch (err) {
      return respondError(404, 'No DNS record found for ' + urlp.host, {
        errorDescription: 'No DNS record found',
        errorInfo: `No DNS record found for pear://${urlp.host}`,
      });
    }
  }

  auditLog.record(
    '-browser',
    'serve',
    { url: urlp.origin, path: urlp.pathname },
    undefined,
    async () => {
      try {
        logger.silly(`Loading drive for ${logUrl}`, { url: request.url });
        drive = await drives.getOrLoadDrive(driveKey);
      } catch (err) {
        logger.warn(`Failed to open drive ${driveKey}`, { err });
        return respondError(500, 'Failed');
      }

      let filepath = decodeURIComponent(urlp.path);
      if (!filepath) filepath = '/';
      if (filepath.indexOf('?') !== -1) {
        filepath = filepath.slice(0, filepath.indexOf('?'));
      }
      let hasTrailingSlash = filepath.endsWith('/');

      let checkoutFS;
      try {
        const checkout = await drives.getDriveCheckout(drive, driveVersion);
        checkoutFS = checkout.checkoutFS;
      } catch (err) {
        logger.warn(`Failed to open drive checkout ${driveKey}`, { err });
        return respondError(500, 'Failed');
      }

      // read manifest: prefer pear.json (Pear v2 app manifest) then index.json
      let manifest;
      try {
        manifest = await checkoutFS.pda.readManifest();
      } catch (e) {
        manifest = null;
      }
      if (!manifest || !manifest.main) {
        try {
          const pearJson = JSON.parse(await checkoutFS.pda.readFile('/pear.json'));
          manifest = manifest ? Object.assign({}, manifest, pearJson) : pearJson;
        } catch (e) {
          // no pear.json, use whatever manifest we have
        }
      }

      const version = await checkoutFS.session.drive.version();
      if (version === 0) {
        logger.silly(`Drive not found ${logUrl}`, { url: request.url });
        return respondError(404, 'Site not found', {
          title: 'Site Not Found',
          errorDescription: 'No peers hosting this site were found',
          errorInfo:
            'You may still be connecting to peers - try reloading the page.',
        });
      }

      if (manifest && manifest.csp && typeof manifest.csp === 'string') {
        cspHeader = manifest.csp;
      }

      const uiExists = await checkoutFS.pda
        .stat('/.ui/ui.html')
        .catch((e) => false);
      if (uiExists) {
        customFrontend = true;
      }

      let statusCode = 200;
      let headers = {};
      let canExecuteHTML = true;
      let entry = await datServeResolvePath(
        checkoutFS.pda,
        manifest,
        urlp,
        request.headers.Accept
      );

      if (entry && !customFrontend) {
        let pathParts = entry.path.split('/').filter(Boolean);
        pathParts.pop();
        while (pathParts.length) {
          let path = '/' + pathParts.join('/');
          let stat = await checkoutFS.pda.stat(path).catch((e) => undefined);
          if (stat && stat.mount) {
            canExecuteHTML = false;
            break;
          }
          pathParts.pop();
        }
      }

      if (entry && entry.isDirectory()) {
        if (!hasTrailingSlash) {
          logger.silly(`Redirecting to trailing slash ${logUrl}`, {
            url: request.url,
          });
          return respondRedirect(
            `pear://${urlp.host}${urlp.version ? '+' + urlp.version : ''}${
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

      if (customFrontend && wantsHTML) {
        logger.silly(`Serving custom frontend ${logUrl}`, { url: request.url });
        return respondCustomFrontend(checkoutFS);
      }

      if (!entry) {
        logger.silly('Not found', { url: request.url });
        let res = await checkoutFS.pda
          .stat('/.ui/ui.html')
          .catch((err) => ({ err }));
        if (
          res?.err &&
          /(not available|connectable)/i.test(res?.err.toString())
        ) {
          return respondError(404, 'File Not Available', {
            errorDescription: 'File Not Available',
            errorInfo: `Nomad could not find any peers to access ${urlp.path}`,
            title: 'File Not Available',
          });
        }
        return respondError(404, 'File Not Found', {
          errorDescription: 'File Not Found',
          errorInfo: `Nomad could not find the file at ${urlp.path}`,
          title: 'File Not Found',
        });
      }

      if (entry.path.endsWith('.goto') && entry.metadata.href) {
        try {
          let u = new URL(entry.metadata.href);
          logger.silly(
            `Redirecting for .goto ${logUrl} to ${entry.metadata.href}`,
            { url: request.url, href: entry.metadata.href }
          );
          return respondRedirect(entry.metadata.href);
        } catch (e) {
          // pass through
        }
      }

      let mimeType = entry.metadata.mimetype || entry.metadata.mimeType;
      if (!mimeType) {
        mimeType = mime.identify(entry.path);
      }
      if (!canExecuteHTML && mimeType.includes('text/html')) {
        mimeType = 'text/plain';
      }

      headers['Accept-Ranges'] = 'bytes';
      let length;
      let range = request.headers.Range || request.headers.range;
      if (range) range = parseRange(entry.size, range);
      if (range && range.type === 'bytes') {
        range = range[0];
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

      if (
        !range &&
        entry.path.endsWith('.md') &&
        mime.acceptHeaderWantsHTML(request.headers.Accept)
      ) {
        let content = await checkoutFS.pda.readFile(entry.path, 'utf8');
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
        let chunk;
        for await (const part of checkoutFS.session.drive.createReadStream(
          entry.path,
          { start: 0, length: 512 }
        )) {
          chunk = chunk ? Buffer.concat([chunk, part]) : part;
        }
        mimeType = mime.identify(entry.path, chunk);
      }
      if (!canExecuteHTML && mimeType.includes('text/html')) {
        mimeType = 'text/plain';
      }
      headers['Content-Type'] = mimeType;
      logger.silly(`Serving file ${logUrl}`, { url: request.url });
      if (request.method === 'HEAD') {
        respond({ statusCode: 204, headers, data: intoStream('') });
      } else {
        respond({
          statusCode,
          headers,
          data: checkoutFS.session.drive.createReadStream(entry.path, range),
        });
      }
    }
  );
};

function intoStream(text) {
  return new Readable({
    read() {
      this.push(text);
      this.push(null);
    },
  });
}
