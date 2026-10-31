// The readable part of a web page, for Reader's saved articles (shared/reader-articles.mjs).
//
// Runs Mozilla's Readability (the engine behind Firefox's Reader View) over the page's HTML,
// parsed with linkedom: no browser, no scripts run, nothing loaded. The HTML comes from the tab
// the user is reading (its live DOM, so pages drawn by script work) or from fetching a pasted
// link. No Electron imports, so the unit tests run it.

import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

// Elements that start a new paragraph in the text.
const BLOCK = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'BLOCKQUOTE',
  'PRE',
  'UL',
  'OL',
  'LI',
  'DL',
  'DT',
  'DD',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'TABLE',
  'TR',
  'FIGURE',
  'FIGCAPTION',
  'HR',
  'BR',
]);
const SKIP = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'SVG',
  'IFRAME',
  'BUTTON',
  'FORM',
]);

// The readable text of an element, in a small Markdown subset the Reader's reading view draws:
// paragraphs split by a blank line, "## " headings, "- " list items, "> " quotes, and ``` around
// preformatted text. Links and images are left out: the view loads nothing from the page.
export function blockText(root) {
  const out = [];
  let line = '';
  let prefix = '';
  const flush = () => {
    const t = line.replace(/[ \t\u00a0\r\n]+/g, ' ').trim();
    if (t) out.push(prefix + t);
    line = '';
    prefix = '';
  };
  const walk = (node, quote) => {
    for (const child of node.childNodes || []) {
      if (child.nodeType === 3) {
        line += child.textContent;
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toUpperCase();
      if (SKIP.has(tag)) continue;
      if (tag === 'PRE') {
        flush();
        const code = String(child.textContent || '')
          .replace(/\s+$/, '')
          .replace(/^\n+/, '');
        if (code.trim()) out.push('```\n' + code + '\n```');
        continue;
      }
      if (!BLOCK.has(tag)) {
        walk(child, quote);
        continue;
      }
      flush();
      const q = quote || tag === 'BLOCKQUOTE';
      const h = /^H([1-6])$/.exec(tag);
      prefix =
        (q ? '> ' : '') +
        (h ? '#'.repeat(Math.max(2, Number(h[1]))) + ' ' : tag === 'LI' ? '- ' : '');
      // A block's own text keeps its mark; text after a nested block (inside an <li>) gets the quote only.
      for (const c of child.childNodes || []) {
        if (c.nodeType === 1 && BLOCK.has(c.tagName.toUpperCase())) {
          flush();
          walk({ childNodes: [c] }, q);
          prefix = q ? '> ' : '';
        } else walk({ childNodes: [c] }, q);
      }
      flush();
    }
  };
  walk(root, false);
  flush();
  return out.join('\n\n');
}

const meta = (doc, ...sels) => {
  for (const s of sels) {
    const v = doc.querySelector(s)?.getAttribute('content');
    if (v && v.trim()) return v.trim();
  }
  return '';
};

// { title, byline, siteName, excerpt, text, image, publishedAt } for the page at `url`. Never
// throws for a page that isn't an article: it falls back to the page's title and description.
export function extractArticle(html, url) {
  const { document } = parseHTML(String(html || ''));
  const image = absolute(
    meta(document, 'meta[property="og:image"]', 'meta[name="twitter:image"]'),
    url
  );
  const fallbackTitle =
    meta(document, 'meta[property="og:title"]', 'meta[name="twitter:title"]') ||
    (document.querySelector('title')?.textContent || '').trim();
  const description = meta(document, 'meta[name="description"]', 'meta[property="og:description"]');
  const siteName = meta(document, 'meta[property="og:site_name"]', 'meta[name="application-name"]');
  const publishedAt = meta(
    document,
    'meta[property="article:published_time"]',
    'meta[name="date"]',
    'meta[itemprop="datePublished"]'
  );

  let parsed = null;
  try {
    parsed = new Readability(document, { charThreshold: 300 }).parse();
  } catch {}

  let text = '';
  if (parsed?.content) {
    const { document: content } = parseHTML(
      `<!doctype html><html><body>${parsed.content}</body></html>`
    );
    text = blockText(content.body);
  }
  if (!text && parsed?.textContent) text = parsed.textContent.replace(/\s+/g, ' ').trim();

  return {
    title: cleanTitle(parsed?.title || fallbackTitle, siteName),
    byline: parsed?.byline || '',
    siteName: parsed?.siteName || siteName,
    excerpt: parsed?.excerpt || description,
    text,
    image,
    publishedAt: parsed?.publishedTime || publishedAt,
  };
}

// "How sourdough works | Bread Blog" -> "How sourdough works", when the end is the site's name.
function cleanTitle(title, siteName) {
  const t = String(title || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!siteName) return t;
  const m = t.match(/^(.{8,}?)\s+[|\-–—·:]\s+(.+)$/);
  return m && m[2].toLowerCase() === siteName.toLowerCase() ? m[1] : t;
}

function absolute(src, base) {
  if (!src) return '';
  try {
    const u = new URL(src, base);
    return /^https?:$/.test(u.protocol) ? u.toString() : '';
  } catch {
    return '';
  }
}
