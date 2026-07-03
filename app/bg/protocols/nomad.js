import errorPage from '../lib/error-page';
import * as mime from '../lib/mime';
import { drivesDebugPage } from '../hyper/debugging';
import * as logLib from '../logger';
import path from 'path';
import fs from 'fs';
import jetpack from 'fs-jetpack';
import ICO from 'icojs';

// constants
// =

// content security policies
const NOMAD_CSP = `
  default-src 'self' nomad:;
  img-src nomad: asset: data: blob: hyper: http: https;
  script-src 'self' nomad: 'unsafe-eval';
  media-src 'self' nomad: hyper:;
  style-src 'self' 'unsafe-inline' nomad:;
  child-src 'self';
`.replace(/\n/g, '');
const NOMAD_APP_CSP = `
  default-src 'self' nomad:;
  img-src nomad: asset: data: blob: hyper: http: https;
  script-src 'self' nomad: hyper: 'unsafe-eval';
  media-src 'self' nomad: hyper:;
  style-src 'self' 'unsafe-inline' nomad:;
  child-src 'self' hyper:;
`.replace(/\n/g, '');
const SIDEBAR_CSP = `
default-src 'self' nomad:;
img-src nomad: asset: data: blob: hyper: http: https;
script-src 'self' nomad: hyper: blob: 'unsafe-eval';
media-src 'self' nomad: hyper:;
style-src 'self' 'unsafe-inline' nomad:;
child-src 'self' nomad:;
`.replace(/\n/g, '');
// The editor hosts the Monaco TypeScript language service, which spawns web
// workers from nomad://assets/vs/* (a different host than the nomad://editor
// page). Allow those cross-host + blob: workers via worker-src/child-src.
// Monaco (>=0.44) inlines the codicon icon font as a data:font/ttf URI in
// editor.main.css, so font-src must allow data:.
const EDITOR_CSP = `
default-src 'self' nomad:;
img-src nomad: asset: data: blob: hyper: http: https;
script-src 'self' nomad: blob: 'unsafe-eval';
media-src 'self' nomad: hyper:;
style-src 'self' 'unsafe-inline' nomad:;
font-src 'self' nomad: data:;
child-src 'self' nomad: blob:;
worker-src 'self' nomad: blob:;
`.replace(/\n/g, '');

const logger = logLib.child({ category: 'nomad', subcategory: 'nomad-scheme' });

// exported api
// =

export function register(protocol) {
  protocol.handle('nomad', nomadProtocol);
}

// internal methods
// =

async function nomadProtocol(request) {
  logger.silly('nomad protocol request', { url: request.url });
  try {
    var cb = async (statusCode, status, contentType, filePath, CSP) => {
      const headers = {
        'Cache-Control': 'no-cache',
        'Content-Type': contentType || 'text/html; charset=utf-8',
        'Content-Security-Policy': CSP || NOMAD_CSP,
        'Access-Control-Allow-Origin': '*',
      };
      let body;
      if (typeof filePath === 'string') {
        try {
          // Read the file into a buffer and hand the whole body to Electron at
          // once. Re-wrapping a net.fetch() ReadableStream in a new Response
          // (`new Response(fileRes.body)`) races the stream pump across the
          // protocol.handle boundary on Electron 42 — intermittently the bytes
          // never reach the renderer, so nomad://desktop/ resolves with no
          // document and the tab falls to chrome-error / ERR_UNKNOWN_URL_SCHEME.
          // Buffering removes the race; nomad:// assets are small.
          const data = await fs.promises.readFile(filePath);
          return new Response(data, { status: statusCode, headers });
        } catch (e) {
          logger.warn('Failed to serve nomad asset', { filePath, err: e });
          return new Response(errorPage({ errorCode: 404, errorDescription: 'Not Found' }), {
            status: 404,
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
          });
        }
      } else if (typeof filePath === 'function') {
        body = filePath();
      } else {
        body = errorPage({ errorCode: statusCode, errorDescription: status });
      }
      return new Response(body, { status: statusCode, headers });
    };

    async function serveICO(filePath, size = 16) {
      // read the file
      const data = await jetpack.readAsync(filePath, 'buffer');

      // parse the ICO to get the 16x16
      const images = await ICO.parse(data, 'image/png');
      let image = images[0];
      for (let i = 1; i < images.length; i++) {
        if (Math.abs(images[i].width - size) < Math.abs(image.width - size)) {
          image = images[i];
        }
      }

      // serve
      return cb(200, 'OK', 'image/png', () => Buffer.from(image.buffer));
    }

    let requestUrl = request.url;

    // strip off the hash
    if (requestUrl.includes('#')) {
      requestUrl = requestUrl.slice(0, requestUrl.indexOf('#'));
    }

    // strip off the query
    if (requestUrl.includes('?')) {
      requestUrl = requestUrl.slice(0, requestUrl.indexOf('?'));
    }

    // redirects from old pages
    if (requestUrl.startsWith('nomad://start/')) {
      return cb(
        200,
        'OK',
        'text/html',
        () => `<!doctype html><meta http-equiv="refresh" content="0; url=nomad://desktop/">`
      );
    }

    // browser ui
    if (requestUrl === 'nomad://shell-window/') {
      return cb(
        200,
        'OK',
        'text/html; charset=utf-8',
        path.join(__dirname, 'fg', 'shell-window', 'index.html')
      );
    }
    if (requestUrl === 'nomad://shell-window/main.js') {
      return cb(
        200,
        'OK',
        'application/javascript; charset=utf-8',
        path.join(__dirname, 'fg', 'shell-window', 'index.build.js')
      );
    }
    if (requestUrl === 'nomad://location-bar/') {
      return cb(
        200,
        'OK',
        'text/html; charset=utf-8',
        path.join(__dirname, 'fg', 'location-bar', 'index.html')
      );
    }
    if (requestUrl === 'nomad://shell-menus/') {
      return cb(
        200,
        'OK',
        'text/html; charset=utf-8',
        path.join(__dirname, 'fg', 'shell-menus', 'index.html')
      );
    }
    if (requestUrl === 'nomad://prompts/') {
      return cb(
        200,
        'OK',
        'text/html; charset=utf-8',
        path.join(__dirname, 'fg', 'prompts', 'index.html')
      );
    }
    if (requestUrl === 'nomad://perm-prompt/') {
      return cb(
        200,
        'OK',
        'text/html; charset=utf-8',
        path.join(__dirname, 'fg', 'perm-prompt', 'index.html')
      );
    }
    if (requestUrl === 'nomad://modals/') {
      return cb(
        200,
        'OK',
        'text/html; charset=utf-8',
        path.join(__dirname, 'fg', 'modals', 'index.html')
      );
    }
    if (requestUrl === 'nomad://assets/syntax-highlight.js') {
      return cb(
        200,
        'OK',
        'application/javascript; charset=utf-8',
        path.join(__dirname, 'assets/js/syntax-highlight.js')
      );
    }
    if (requestUrl === 'nomad://assets/syntax-highlight.css') {
      return cb(
        200,
        'OK',
        'text/css; charset=utf-8',
        path.join(__dirname, 'assets/css/syntax-highlight.css')
      );
    }
    if (requestUrl === 'nomad://assets/design-tokens.css') {
      return cb(
        200,
        'OK',
        'text/css; charset=utf-8',
        path.join(__dirname, 'assets/css/design-tokens.css')
      );
    }
    if (requestUrl === 'nomad://assets/font-awesome.css') {
      return cb(
        200,
        'OK',
        'text/css; charset=utf-8',
        path.join(__dirname, 'assets/css/fa-all.min.css')
      );
    }
    if (requestUrl === 'nomad://assets/webfonts/fa-regular-400.woff2') {
      return cb(
        200,
        'OK',
        'text/css; charset=utf-8',
        path.join(__dirname, 'assets/fonts/fa-regular-400.woff2')
      );
    }
    if (requestUrl === 'nomad://assets/webfonts/fa-regular-400.woff') {
      return cb(
        200,
        'OK',
        'text/css; charset=utf-8',
        path.join(__dirname, 'assets/fonts/fa-regular-400.woff')
      );
    }
    if (requestUrl === 'nomad://assets/webfonts/fa-regular-400.svg') {
      return cb(
        200,
        'OK',
        'text/css; charset=utf-8',
        path.join(__dirname, 'assets/fonts/fa-regular-400.svg')
      );
    }
    if (requestUrl === 'nomad://assets/webfonts/fa-solid-900.woff2') {
      return cb(
        200,
        'OK',
        'text/css; charset=utf-8',
        path.join(__dirname, 'assets/fonts/fa-solid-900.woff2')
      );
    }
    if (requestUrl === 'nomad://assets/webfonts/fa-solid-900.woff') {
      return cb(
        200,
        'OK',
        'text/css; charset=utf-8',
        path.join(__dirname, 'assets/fonts/fa-solid-900.woff')
      );
    }
    if (requestUrl === 'nomad://assets/webfonts/fa-solid-900.svg') {
      return cb(
        200,
        'OK',
        'text/css; charset=utf-8',
        path.join(__dirname, 'assets/fonts/fa-solid-900.svg')
      );
    }
    if (requestUrl === 'nomad://assets/webfonts/fa-brands-400.woff2') {
      return cb(
        200,
        'OK',
        'text/css; charset=utf-8',
        path.join(__dirname, 'assets/fonts/fa-brands-400.woff2')
      );
    }
    if (requestUrl === 'nomad://assets/webfonts/fa-brands-400.woff') {
      return cb(
        200,
        'OK',
        'text/css; charset=utf-8',
        path.join(__dirname, 'assets/fonts/fa-brands-400.woff')
      );
    }
    if (requestUrl === 'nomad://assets/webfonts/fa-brands-400.svg') {
      return cb(
        200,
        'OK',
        'text/css; charset=utf-8',
        path.join(__dirname, 'assets/fonts/fa-brands-400.svg')
      );
    }
    if (requestUrl === 'nomad://assets/font-photon-entypo') {
      return cb(
        200,
        'OK',
        'application/font-woff',
        path.join(__dirname, 'assets/fonts/photon-entypo.woff')
      );
    }
    if (requestUrl === 'nomad://assets/font-source-sans-pro') {
      return cb(
        200,
        'OK',
        'application/font-woff2',
        path.join(__dirname, 'assets/fonts/source-sans-pro.woff2')
      );
    }
    if (requestUrl === 'nomad://assets/font-source-sans-pro-le') {
      return cb(
        200,
        'OK',
        'application/font-woff2',
        path.join(__dirname, 'assets/fonts/source-sans-pro-le.woff2')
      );
    }
    if (requestUrl === 'nomad://assets/logo-black.svg') {
      return cb(200, 'OK', 'image/svg+xml', path.join(__dirname, 'assets/img/logo-black.svg'));
    }
    if (requestUrl === 'nomad://assets/spinner.gif') {
      return cb(200, 'OK', 'image/gif', path.join(__dirname, 'assets/img/spinner.gif'));
    }
    if (requestUrl.startsWith('nomad://assets/logo2')) {
      return cb(200, 'OK', 'image/png', path.join(__dirname, 'assets/img/logo2.png'));
    }
    if (requestUrl.startsWith('nomad://assets/logo-ondark')) {
      return cb(200, 'OK', 'image/png', path.join(__dirname, 'assets/img/logo-ondark.png'));
    }
    if (requestUrl.startsWith('nomad://assets/logo')) {
      return cb(200, 'OK', 'image/png', path.join(__dirname, 'assets/img/logo.png'));
    }
    if (requestUrl.startsWith('nomad://assets/default-user-thumb')) {
      return cb(200, 'OK', 'image/jpeg', path.join(__dirname, 'assets/img/default-user-thumb.jpg'));
    }
    if (requestUrl.startsWith('nomad://assets/default-thumb')) {
      return cb(200, 'OK', 'image/jpeg', path.join(__dirname, 'assets/img/default-thumb.jpg'));
    }
    if (requestUrl.startsWith('nomad://assets/default-frontend-thumb')) {
      return cb(
        200,
        'OK',
        'image/jpeg',
        path.join(__dirname, 'assets/img/default-frontend-thumb.jpg')
      );
    }
    if (requestUrl.startsWith('nomad://assets/search-icon-large')) {
      return cb(200, 'OK', 'image/jpeg', path.join(__dirname, 'assets/img/search-icon-large.png'));
    }
    if (requestUrl.startsWith('nomad://assets/favicons/')) {
      return serveICO(
        path.join(
          __dirname,
          'assets/favicons',
          requestUrl.slice('nomad://assets/favicons/'.length)
        )
      );
    }
    if (requestUrl.startsWith('nomad://assets/search-engines/')) {
      return cb(
        200,
        'OK',
        'image/png',
        path.join(
          __dirname,
          'assets/img/search-engines',
          requestUrl.slice('nomad://assets/search-engines/'.length)
        )
      );
    }
    if (requestUrl.startsWith('nomad://assets/img/templates/')) {
      let imgPath = requestUrl.slice('nomad://assets/img/templates/'.length);
      return cb(200, 'OK', 'image/png', path.join(__dirname, `assets/img/templates/${imgPath}`));
    }
    if (requestUrl.startsWith('nomad://assets/img/frontends/')) {
      let imgPath = requestUrl.slice('nomad://assets/img/frontends/'.length);
      return cb(200, 'OK', 'image/png', path.join(__dirname, `assets/img/frontends/${imgPath}`));
    }
    if (requestUrl.startsWith('nomad://assets/img/drive-types/')) {
      let imgPath = requestUrl.slice('nomad://assets/img/drive-types/'.length);
      return cb(200, 'OK', 'image/png', path.join(__dirname, `assets/img/drive-types/${imgPath}`));
    }

    // userland
    if (requestUrl === 'nomad://app-stdlib' || requestUrl.startsWith('nomad://app-stdlib/')) {
      return serveAppAsset(requestUrl, path.join(__dirname, 'userland', 'app-stdlib'), cb);
    }
    if (requestUrl === 'nomad://diff' || requestUrl.startsWith('nomad://diff/')) {
      return serveAppAsset(requestUrl, path.join(__dirname, 'userland', 'diff'), cb);
    }
    if (requestUrl === 'nomad://library' || requestUrl.startsWith('nomad://library/')) {
      return serveAppAsset(
        requestUrl,
        path.join(__dirname, 'userland', 'library'),
        cb,
        // @ts-ignore
        { fallbackToIndexHTML: true }
      );
    }
    if (requestUrl === 'nomad://drive-view' || requestUrl.startsWith('nomad://drive-view/')) {
      return serveAppAsset(requestUrl, path.join(__dirname, 'userland', 'drive-view'), cb);
    }
    if (requestUrl === 'nomad://cmd-pkg' || requestUrl.startsWith('nomad://cmd-pkg/')) {
      return serveAppAsset(requestUrl, path.join(__dirname, 'userland', 'cmd-pkg'), cb);
    }
    if (requestUrl === 'nomad://site-info' || requestUrl.startsWith('nomad://site-info/')) {
      return serveAppAsset(
        requestUrl,
        path.join(__dirname, 'userland', 'site-info'),
        cb,
        // @ts-ignore
        { fallbackToIndexHTML: true }
      );
    }
    if (requestUrl === 'nomad://setup' || requestUrl.startsWith('nomad://setup/')) {
      return serveAppAsset(
        requestUrl,
        path.join(__dirname, 'userland', 'setup'),
        cb,
        // @ts-ignore
        { fallbackToIndexHTML: true }
      );
    }
    if (requestUrl === 'nomad://init' || requestUrl.startsWith('nomad://init/')) {
      return serveAppAsset(
        requestUrl,
        path.join(__dirname, 'userland', 'init'),
        cb,
        // @ts-ignore
        { fallbackToIndexHTML: true }
      );
    }
    if (requestUrl === 'nomad://editor' || requestUrl.startsWith('nomad://editor/')) {
      return serveAppAsset(
        requestUrl,
        path.join(__dirname, 'userland', 'editor'),
        cb,
        // @ts-ignore
        { CSP: EDITOR_CSP }
      );
    }
    if (requestUrl === 'nomad://explorer' || requestUrl.startsWith('nomad://explorer/')) {
      return serveAppAsset(
        requestUrl,
        path.join(__dirname, 'userland', 'explorer'),
        cb,
        // @ts-ignore
        { fallbackToIndexHTML: true }
      );
    }
    if (
      requestUrl === 'nomad://hypercore-tools' ||
      requestUrl.startsWith('nomad://hypercore-tools/')
    ) {
      return serveAppAsset(
        requestUrl,
        path.join(__dirname, 'userland', 'hypercore-tools'),
        cb,
        // @ts-ignore
        { fallbackToIndexHTML: true }
      );
    }
    if (requestUrl === 'nomad://webterm' || requestUrl.startsWith('nomad://webterm/')) {
      return serveAppAsset(requestUrl, path.join(__dirname, 'userland', 'webterm'), cb, {
        fallbackToIndexHTML: true,
        CSP: SIDEBAR_CSP,
      });
    }
    if (requestUrl === 'nomad://desktop' || requestUrl.startsWith('nomad://desktop/')) {
      return serveAppAsset(requestUrl, path.join(__dirname, 'userland', 'desktop'), cb, {
        CSP: NOMAD_APP_CSP,
        fallbackToIndexHTML: true,
      });
    }
    if (requestUrl === 'nomad://history' || requestUrl.startsWith('nomad://history/')) {
      return serveAppAsset(requestUrl, path.join(__dirname, 'userland', 'history'), cb);
    }
    if (requestUrl === 'nomad://reader' || requestUrl.startsWith('nomad://reader/')) {
      return serveAppAsset(
        requestUrl,
        path.join(__dirname, 'userland', 'reader'),
        cb,
        // @ts-ignore
        { fallbackToIndexHTML: true }
      );
    }
    if (requestUrl === 'nomad://settings' || requestUrl.startsWith('nomad://settings/')) {
      return serveAppAsset(requestUrl, path.join(__dirname, 'userland', 'settings'), cb);
    }
    if (requestUrl.startsWith('nomad://assets/img/onboarding/')) {
      let imgPath = requestUrl.slice('nomad://assets/img/onboarding/'.length);
      return cb(200, 'OK', 'image/png', path.join(__dirname, `assets/img/onboarding/${imgPath}`));
    }
    if (requestUrl === 'nomad://assets/monaco.js') {
      return cb(
        200,
        'OK',
        'application/javascript; charset=utf-8',
        path.join(__dirname, 'assets/js/editor/monaco.js')
      );
    }
    if (requestUrl.startsWith('nomad://assets/vs/') && requestUrl.endsWith('.js')) {
      let filePath = requestUrl.slice('nomad://assets/vs/'.length);
      return cb(
        200,
        'OK',
        'application/javascript',
        path.join(__dirname, `assets/js/editor/vs/${filePath}`)
      );
    }
    if (requestUrl.startsWith('nomad://assets/vs/') && requestUrl.endsWith('.css')) {
      let filePath = requestUrl.slice('nomad://assets/vs/'.length);
      return cb(
        200,
        'OK',
        'text/css; charset=utf-8',
        path.join(__dirname, `assets/js/editor/vs/${filePath}`)
      );
    }
    if (requestUrl.startsWith('nomad://assets/vs/') && requestUrl.endsWith('.ttf')) {
      let filePath = requestUrl.slice('nomad://assets/vs/'.length);
      return cb(200, 'OK', 'font/ttf', path.join(__dirname, `assets/js/editor/vs/${filePath}`));
    }

    // debugging
    if (requestUrl === 'nomad://active-drives/') {
      return cb(200, 'OK', 'text/html; charset=utf-8', drivesDebugPage);
    }

    return cb(404, 'Not Found');
  } catch (e) {
    logger.error('nomad protocol handler error', { url: request.url, err: e });
    return new Response(errorPage({ errorCode: 500, errorDescription: 'Internal Error' }), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
  }
}

// helper to serve requests to app packages
async function serveAppAsset(
  requestUrl,
  dirPath,
  cb,
  { CSP, fallbackToIndexHTML } = { CSP: undefined, fallbackToIndexHTML: false }
) {
  // resolve the file path
  const urlp = new URL(requestUrl);
  var pathname = urlp.pathname;
  if (pathname === '' || pathname === '/') {
    pathname = '/index.html';
  }
  var filepath = path.join(dirPath, pathname);

  // make sure the file exists
  try {
    await fs.promises.stat(filepath);
  } catch (e) {
    if (fallbackToIndexHTML) {
      filepath = path.join(dirPath, '/index.html');
    } else {
      return cb(404, 'Not Found');
    }
  }

  // identify the mime type
  var contentType = mime.identify(filepath);

  // serve
  return cb(200, 'OK', contentType, filepath, CSP);
}
