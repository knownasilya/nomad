var errorPageCSS = `
*, *::before, *::after {
  box-sizing: border-box;
}
a {
  text-decoration: none;
  color: inherit;
  cursor: pointer;
}
body {
  background: #f7f7f8;
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Ubuntu, Cantarell, "Oxygen Sans", "Helvetica Neue", sans-serif;
  color: #444;
}

/* ── shared card shell ── */
.error-card {
  background: #fff;
  border: 1px solid #e4e4e7;
  border-radius: 10px;
  max-width: 480px;
  margin: 20vh auto 0;
  padding: 32px 36px 28px;
  box-shadow: 0 2px 12px rgba(0,0,0,.06);
}

/* ── icon ── */
.error-icon {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
  font-size: 20px;
}
.error-icon.warn  { background: #fff4e5; color: #d97706; }
.error-icon.info  { background: #f0f4ff; color: #4468ca; }
.error-icon.sad   { background: #f3f3f5; color: #888; }

/* ── typography ── */
h1 {
  margin: 0 0 8px;
  font-size: 17px;
  font-weight: 600;
  color: #111;
  line-height: 1.3;
}
.desc {
  font-size: 13px;
  line-height: 1.6;
  color: #666;
  margin: 0 0 6px;
}
.desc strong { color: #333; }
.code-label {
  font-size: 11px;
  color: #aaa;
  font-family: monospace;
  margin-top: 4px;
}

/* ── divider ── */
.divider {
  border: none;
  border-top: 1px solid #ebebed;
  margin: 20px 0;
}

/* ── action row (non-cert errors) ── */
.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.btn {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 500;
  height: 30px;
  padding: 0 12px;
  border: 1px solid #ddd;
  background: #fafafa;
  color: #555;
  letter-spacing: .1px;
  white-space: nowrap;
  transition: background .1s, border-color .1s;
}
.btn:hover   { background: #f0f0f2; border-color: #ccc; }
.btn:active  { background: #e8e8eb; }
.btn:focus   { outline: 2px solid #007aff40; outline-offset: 1px; }
.btn.primary {
  background: #007aff;
  border-color: #006ee6;
  color: #fff;
  font-weight: 600;
}
.btn.primary:hover  { background: #006ee6; }
.btn.primary:active { background: #0060cc; }

/* ── cert error: stacked action list ── */
.cert-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cert-actions .btn {
  width: 100%;
  justify-content: center;
  height: 34px;
  font-size: 13px;
}
.btn.back {
  background: #007aff;
  border-color: #006ee6;
  color: #fff;
  font-weight: 600;
}
.btn.back:hover  { background: #006ee6; }
.btn.proceed {
  background: #fff;
  color: #555;
}

/* ── always-trust disclosure ── */
.always-trust {
  margin-top: 4px;
  border: 1px solid #f0d0d0;
  border-radius: 6px;
  overflow: hidden;
}
.always-trust summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  font-size: 12px;
  color: #c0392b;
  cursor: pointer;
  user-select: none;
  background: #fff8f8;
  list-style: none;
}
.always-trust summary::-webkit-details-marker { display: none; }
.always-trust summary:hover { background: #fff0f0; }
.always-trust summary::after {
  content: "+";
  font-size: 14px;
  color: #e05555;
  line-height: 1;
}
.always-trust[open] summary::after { content: "x"; font-size: 11px; }
.always-trust-body {
  padding: 12px;
  background: #fff;
  border-top: 1px solid #f0d0d0;
}
.always-trust-body p {
  margin: 0 0 10px;
  font-size: 12px;
  color: #777;
  line-height: 1.5;
}
.btn.danger {
  background: #c0392b;
  border-color: #a93226;
  color: #fff;
  font-weight: 600;
}
.btn.danger:hover { background: #a93226; }

a.link { color: #007aff; text-decoration: underline; }
`;

/**
 * @typedef {Object} ErrorPageInput
 * @property {string} [resource]
 * @property {number} [errorCode]
 * @property {string} [errorDescription]
 * @property {string} [errorInfo]
 * @property {string} [title]
 * @property {string} [validatedURL]
 * @property {boolean} [isInsecureResponse]
 */

/**
 * Generate an error page HTML
 * @param {ErrorPageInput|string} e
 * @returns {string}
 */
export default function (e) {
  if (typeof e === 'object' && e.isInsecureResponse) {
    return renderCertError(e);
  }
  return renderGenericError(e);
}

function renderCertError(e) {
  var origin = stripOrigin(e.validatedURL);
  var enc = encodeURIComponent(e.validatedURL || '');
  var errorCode = e.errorCode || '';
  // Use console.log-based IPC: chrome-error:// blocks link navigation but not console output.
  // pane.js listens for __nomad_cert__:<action>:<encodedUrl> messages.
  var onceClick = "event.preventDefault();console.log('__nomad_cert__:once:" + enc + "')";
  var alwaysClick = "event.preventDefault();console.log('__nomad_cert__:always:" + enc + "')";
  var body = `
    <div class="error-icon warn"><i class="fa fa-lock"></i></div>
    <h1>Connection not secure</h1>
    <p class="desc">The certificate for <strong>${origin}</strong> is invalid or does not match the hostname. Your data could be at risk.</p>
    <p class="code-label">${errorCode ? errorCode + ' &middot; ' : ''}${e.errorDescription || 'ERR_CERT_INVALID'}</p>
    <hr class="divider">
    <div class="cert-actions">
      <a class="btn back" href="javascript:window.history.back()">Go back to safety</a>
      <a class="btn proceed" href="javascript:void(0)" onclick="${onceClick}">Proceed anyway (unsafe)</a>
      <details class="always-trust">
        <summary>Always trust this domain</summary>
        <div class="always-trust-body">
          <p>Permanently skip certificate checks for <strong>${origin}</strong>. Only use this for local development servers you control.</p>
          <a class="btn danger" style="width:100%;justify-content:center;display:inline-flex;height:30px;font-size:12px;" href="javascript:void(0)" onclick="${alwaysClick}">Add to trusted domains</a>
        </div>
      </details>
    </div>`;
  return renderShell(body);
}

function renderGenericError(e) {
  var icon = 'fa-exclamation-circle';
  var iconClass = 'warn';
  var title = "This site can't be reached";
  var info = '';
  var button = '<a class="btn primary" href="javascript:window.location.reload()">Try again</a>';
  var errorCode = '';

  if (typeof e === 'object') {
    errorCode = e.errorCode || '';
    switch (e.errorCode) {
      case -106:
        iconClass = 'info';
        title = 'No internet connection';
        info = '<p>Your computer is not connected to the internet.</p><ul><li>Reset your Wi-Fi connection</li><li>Check your router and modem</li></ul>';
        break;
      case -105:
        iconClass = 'sad';
        icon = 'fa-frown-o';
        info = '<p>Could not resolve the DNS address for <strong>' + stripOrigin(e.validatedURL) + '</strong>.</p>';
        break;
      case 404:
        iconClass = 'sad';
        icon = 'fa-frown-o';
        title = e.title || 'Page not found';
        info = '<p>' + (e.errorInfo || '') + '</p>';
        break;
      case 504:
        icon = 'fa-share-alt';
        title = 'Nomad could not reach this ' + (e.resource || 'page');
        info = '<p>The p2p ' + (e.resource || 'resource') + ' was not reachable on the network.</p>';
        break;
      default:
        if (e.errorInfo) info = '<p>' + e.errorInfo + '</p>';
    }
  } else if (typeof e === 'string') {
    info = '<p>' + e + '</p>';
  }

  var body = `
    <div class="error-icon ${iconClass}"><i class="fa ${icon}"></i></div>
    <h1>${title}</h1>
    <div class="desc">${info}</div>
    ${errorCode ? '<p class="code-label">' + errorCode + (e.errorDescription ? ' &middot; ' + e.errorDescription : '') + '</p>' : ''}
    <hr class="divider">
    <div class="actions">
      <a class="btn" href="javascript:window.history.back()">Go back</a>
      ${button}
    </div>`;
  return renderShell(body);
}

function renderShell(body) {
  return (`
    <html>
      <head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8" /></head>
      <body>
        <style>${errorPageCSS}</style>
        <link rel="stylesheet" href="beaker://assets/font-awesome.css">
        <div class="error-card">${body}</div>
      </body>
    </html>`).replace(/\n/g, '');
}

function stripOrigin(url) {
  if (!url) return '';
  var s = url;
  // remove trailing slash
  if (s.endsWith('/')) s = s.slice(0, -1);
  if (s.startsWith('https://')) s = s.slice(8);
  else if (s.startsWith('http://')) s = s.slice(7);
  return s;
}
