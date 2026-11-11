// The script inside an HTML Asset the AI drew from components (app/lib/genui/page.mjs): it draws the
// page's OpenUI Lang program with the AI Sidebar's own <nomad-genui> (app/fg/shell-window/genui/),
// in `standalone` mode. scripts/build.js bundles it into one file, index.build.js, which the page
// carries inline, so the file works on its own: in Assets' sandboxed preview, on the phone, or
// downloaded and opened in any browser.
//
// The page holds its data in <script type="application/json" id="nomad-genui">:
// { source: string, iconCss: string }. A link or an @OpenUrl button opens in a new window where the
// page is allowed to (Assets' preview isn't).

import '../shell-window/genui/index.js';

function start() {
  const root = document.getElementById('nomad-genui-root');
  const data = document.getElementById('nomad-genui');
  if (!root || !data) return;
  let page = { source: '', iconCss: '' };
  try {
    page = { ...page, ...JSON.parse(data.textContent || '{}') };
  } catch {}
  const ui = document.createElement('nomad-genui');
  ui.standalone = true;
  ui.iconCss = String(page.iconCss || '');
  ui.source = String(page.source || '');
  ui.addEventListener('genui-action', (e) => {
    const step = (e.detail?.steps || []).find((s) => s.type === 'open_url');
    if (step && /^(https?|hyper):\/\//i.test(step.url)) window.open(step.url, '_blank', 'noopener');
  });
  root.replaceChildren(ui);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
