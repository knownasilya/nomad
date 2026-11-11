// The AI's component pages (saveAsset's `openui`, app/lib/genui/page.mjs): read the parts a page
// carries from the app's own files once, check the program draws something, and build the page.

import path from 'path';
import { promises as fs } from 'fs';
import { genuiPage } from '../../lib/genui/page.mjs';
import { parseGenUi } from '../../lib/genui/parse.mjs';

let parts = null;

// __dirname is app/ in the bundle (as for the preloads, bg/ui/windows.js).
function readParts() {
  if (!parts) {
    parts = Promise.all([
      fs.readFile(path.join(__dirname, 'fg', 'genui-page', 'index.build.js'), 'utf8'),
      fs.readFile(path.join(__dirname, 'assets', 'css', 'fa-all.min.css'), 'utf8').catch(() => ''),
      fs.readFile(path.join(__dirname, 'assets', 'fonts', 'fa-solid-900.woff2')).catch(() => null),
    ]).then(([script, faCss, font]) => ({ script, faCss, fontBase64: font ? font.toString('base64') : '' }));
    parts.catch(() => (parts = null));
  }
  return parts;
}

// The program's first problem, in words the model can act on, or ''.
export function programError(source) {
  const text = String(source || '').trim();
  if (!text) return '`openui` is empty';
  if (/^```/.test(text)) return 'Pass the openui-lang program itself in `openui`, without the ``` fence';
  const { root, meta } = parseGenUi(text);
  if (!root) {
    const err = meta?.errors?.[0]?.message;
    return `That openui-lang program draws nothing${err ? ` (${err})` : ''}. Start it with root = Stack([...])`;
  }
  return '';
}

/** @returns {Promise<string>} the page's HTML */
export async function buildPage({ title, source }) {
  const err = programError(source);
  if (err) throw new Error(err);
  const p = await readParts();
  return genuiPage({
    title,
    source: String(source).trim(),
    script: p.script,
    faCss: p.faCss,
    fontBase64: p.fontBase64,
    made: `Made with Nomad’s AI · ${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`,
  });
}
