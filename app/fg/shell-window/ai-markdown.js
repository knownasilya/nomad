// The AI Sidebar's Markdown (ai-sidebar.js): a small renderer for what model answers use. Links open
// only when shared/item-links.mjs says they may, as the URL it builds; the sidebar's click handler
// opens them in a tab. Tests: tests/unit/ai-markdown.test.js.

import { parseItemLink } from '../../../shared/item-links.mjs';

// Minimal markdown -> HTML (headings, lists, code fences, inline emphasis/code, links). Mirrors the
// renderer chat-bubble/ai-sidebar used before the two were unified into ai-sidebar.js.
export function mdToHtml(text) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const emphasis = (s) =>
    s
      .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  // `s` is escaped already. Code spans and links are set aside first, so emphasis never reaches
  // into a URL and a link inside backticks stays code.
  const inline = (s) => {
    const kept = [];
    const keep = (html) => `\uE000${kept.push(html) - 1}\uE000`;
    s = s.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${code}</code>`));
    s = s.replace(/\[([^\]\n]+)\]\(\s*([^\s()]+)\s*\)/g, (m, label, href) => {
      const a = linkHtml(href, emphasis(label));
      return a ? keep(a) : m;
    });
    s = s.replace(/(^|[\s(]|&lt;)((?:https?|hyper|nomad):\/\/[^\s<"]+)/g, (m, before, url) => {
      // Sentence punctuation (or the > of <url>) after a bare URL isn't part of it.
      const tail = /(?:[.,;:!?)\]'"]|&gt;)+$/.exec(url)?.[0] || '';
      const a = linkHtml(url.slice(0, url.length - tail.length));
      return a ? before + keep(a) + tail : m;
    });
    return emphasis(s).replace(/\uE000(\d+)\uE000/g, (_, i) => kept[Number(i)]);
  };

  const tokens = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      tokens.push({ type: 'code', code: codeLines.join('\n') });
      i++;
      continue;
    }
    const hm = line.match(/^(#{1,3}) (.+)/);
    if (hm) {
      tokens.push({ type: 'heading', level: hm[1].length, text: hm[2] });
      i++;
      continue;
    }
    if (line.match(/^[-*] /)) {
      const items = [];
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(lines[i].slice(2));
        i++;
      }
      tokens.push({ type: 'list', items });
      continue;
    }
    if (line.trim() === '') {
      tokens.push({ type: 'blank' });
      i++;
      continue;
    }
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('```') &&
      !lines[i].match(/^[-*] /) &&
      !lines[i].match(/^#{1,3} /)
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    tokens.push({ type: 'para', lines: paraLines });
  }

  const parts = tokens.map((t) => {
    if (t.type === 'code') return `<pre><code>${esc(t.code)}</code></pre>`;
    if (t.type === 'heading') {
      const tag = `h${t.level}`;
      return `<${tag}>${inline(esc(t.text))}</${tag}>`;
    }
    if (t.type === 'list')
      return `<ul>${t.items.map((s) => `<li>${inline(esc(s))}</li>`).join('')}</ul>`;
    if (t.type === 'para') return `<p>${t.lines.map((l) => inline(esc(l))).join('<br>')}</p>`;
    return '';
  });
  return parts.join('') || `<p>${inline(esc(text))}</p>`;
}

// An <a> for a link in an answer, or '' when it isn't one to open (shared/item-links.mjs: web and
// hyper:// pages, and the nomad:// pages for the user's things). `href` is HTML-escaped text; the
// click handler (_onAnswerClick) opens what parseItemLink says, never the href as written.
function linkHtml(href, labelHtml) {
  const raw = href.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const link = parseItemLink(raw);
  if (!link) return '';
  const attr = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<a href="${attr(link.url)}" title="${attr(link.url)}">${labelHtml ?? href}</a>`;
}
