#!/usr/bin/env node
// Every control that shows only an icon must say what it does. On desktop that's a tooltip on
// hover: a `title` (the native tooltip, which is also its accessible name) or a `data-tooltip`
// (app-stdlib's tooltip.css) together with an `aria-label` (a CSS tooltip is not read out). On the
// phone it's the label on touch and hold (see the mobile section below). This finds the ones that
// don't, in the desktop UI's lit templates and HTML and the phone's screens.
//
//   node scripts/check-icon-buttons.mjs          list offenders, exit 1 if any
//
// tests/unit/icon-button-labels.test.js runs the same check, so `npm test` fails on a new one.
// "A control" is a <button>, any <a>, and any element with a click handler or role="button".
// "Only an icon" is nothing but Font Awesome / icon-class spans, <img>, <svg>, and `${…}` parts
// that are themselves only icons. A `${…}` the scanner can't see into (`${this.label}`) counts as
// text, so a label from a binding is never flagged. If the scanner is wrong about a control, put
// `<!-- icon-button-ok: why -->` inside it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Where the desktop UI lives. Vendored code and generated bundles are skipped.
const DIRS = ['app/fg', 'app/userland'];
const SKIP = [
  /[\\/]vendor[\\/]/,
  /[\\/]node_modules[\\/]/,
  /[\\/]app-stdlib[\\/]js[\\/]vs[\\/]/, // Monaco
  /\.build\.js$/,
  /\.min\.js$/,
  /[\\/]fontawesome/,
  /[\\/]editor[\\/]js[\\/]types[\\/]/,
];

// ---- a tiny scanner for JS strings, template literals and `${…}` -------------------------------

function skipQuoted(s, i) {
  const q = s[i];
  for (i++; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === q) return i + 1;
  }
  return s.length;
}

// s[i] is a backtick; returns the index after the closing one.
function skipTemplate(s, i) {
  for (i++; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '`') return i + 1;
    else if (s[i] === '$' && s[i + 1] === '{') i = exprEnd(s, i + 2);
  }
  return s.length;
}

// i is just past `${`; returns the index of the matching `}`.
function exprEnd(s, i) {
  let depth = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"') i = skipQuoted(s, i);
    else if (c === '`') i = skipTemplate(s, i);
    else if (c === '/' && s[i + 1] === '/')
      i = s.indexOf('\n', i) < 0 ? s.length : s.indexOf('\n', i);
    else if (c === '{') {
      depth++;
      i++;
    } else if (c === '}') {
      if (depth === 0) return i;
      depth--;
      i++;
    } else i++;
  }
  return s.length;
}

// Read an opening tag's attributes from `i` (just past the tag name). HTML-quoted values and
// `${…}` (which can hold a `>` in an arrow function) are skipped whole. Returns [attrs, after].
function readAttrs(s, i) {
  const start = i;
  while (i < s.length) {
    const c = s[i];
    if (c === '$' && s[i + 1] === '{') i = exprEnd(s, i + 2) + 1;
    else if (c === '"' || c === "'") {
      const q = c;
      for (i++; i < s.length && s[i] !== q; i++) {
        if (s[i] === '$' && s[i + 1] === '{') i = exprEnd(s, i + 2);
      }
      i++;
    } else if (c === '>') return [s.slice(start, i), i + 1];
    else if (c === '`')
      return null; // ran out of the template: not a real tag
    else i++;
  }
  return null;
}

// ---- what counts as an icon, a control, a label ------------------------------------------------

const ICON_CLASS_RE =
  /\bclass\s*=\s*["'`]?[^"'`>]*?(?:^|[\s"'`])(?:fa[srlbd]?|fa-[\w-]+|icon|[\w-]+-icon|favicon)(?=[\s"'`$]|$)/;

function attrNames(attrs) {
  // `title`, `.title`, `?title`, `data-tooltip`, `aria-label`, …
  const names = new Set();
  for (const m of attrs.matchAll(/(?:^|\s)[.?@]?([\w:-]+)\s*=/g)) names.add(m[1].toLowerCase());
  return names;
}

function isIconElement(name, attrs) {
  if (name === 'img' || name === 'svg') return true;
  return (name === 'span' || name === 'i') && ICON_CLASS_RE.test(attrs);
}

export function isControl(name, attrs) {
  if (name === 'button' || name === 'a') return true;
  const names = attrNames(attrs);
  return names.has('click') || /\brole\s*=\s*["']button["']/.test(attrs);
}

// What a `${…}` renders: the bodies of any html`…` in it, each walked like markup. Anything else
// (a property, a call, a string with letters) might be text.
function exprContent(expr) {
  if (/^\s*(?:this\.)?_?(?:render\w*Icon|icon|faIcon)\s*\(/i.test(expr))
    return { icon: true, text: false };
  let icon = false;
  let text = false;
  let rest = '';
  let i = 0;
  let bodies = 0;
  while (i < expr.length) {
    if (expr.startsWith('html`', i) || (expr[i] === '`' && /html\s*$/.test(expr.slice(0, i)))) {
      const tick = expr.indexOf('`', i);
      const end = skipTemplate(expr, tick);
      const r = contentOf(expr.slice(tick + 1, end - 1));
      icon ||= r.icon;
      text ||= r.text;
      bodies++;
      i = end;
    } else if (expr[i] === "'" || expr[i] === '"' || expr[i] === '`') {
      const end = expr[i] === '`' ? skipTemplate(expr, i) : skipQuoted(expr, i);
      rest += ' ' + expr.slice(i, end) + ' ';
      i = end;
    } else rest += expr[i++];
  }
  if (!bodies) return { icon: false, text: true };
  // a string literal with words in it, outside the templates, can be rendered as text
  if (/(['"`])[^'"`]*[A-Za-z][^'"`]*\1/.test(rest.replace(/\b(?:class|classMap)\b/g, ''))) {
    // …unless it's only used to build an icon class like `fa-${a ? 'play' : 'pause'}`
    text ||= !/^[^?]*\?\s*(['"])[\w-]*\1\s*:\s*(['"])[\w-]*\2\s*$/.test(rest.trim());
  }
  return { icon, text };
}

// Walk template markup: did it draw an icon, and did it draw any text?
export function contentOf(s) {
  let icon = false;
  let text = false;
  let i = 0;
  while (i < s.length) {
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i);
      i = end < 0 ? s.length : end + 3;
    } else if (s[i] === '<' && /[a-zA-Z/]/.test(s[i + 1] || '')) {
      const m = /^<\/?([a-zA-Z][\w-]*)/.exec(s.slice(i, i + 40));
      if (!m) {
        text = true;
        i++;
        continue;
      }
      const name = m[1].toLowerCase();
      const r = readAttrs(s, i + m[0].length);
      if (!r) break;
      const [attrs, after] = r;
      if (s[i + 1] !== '/' && isIconElement(name, attrs)) {
        icon = true;
        if (name === 'svg') {
          const end = s.indexOf('</svg>', after);
          i = end < 0 ? s.length : end + 6;
          continue;
        }
      }
      i = after;
    } else if (s[i] === '$' && s[i + 1] === '{') {
      const end = exprEnd(s, i + 2);
      const r = exprContent(s.slice(i + 2, end));
      icon ||= r.icon;
      text ||= r.text;
      i = end + 1;
    } else if (s.startsWith('&nbsp;', i)) i += 6;
    else if (s[i] === '&' && /^&#?\w+;/.test(s.slice(i, i + 10))) {
      // &times; and friends draw a glyph
      icon = true;
      i = s.indexOf(';', i) + 1;
    } else {
      // a letter or digit is a label; a symbol (× + ▾ …) is a glyph used as an icon
      if (/[\p{L}\p{N}]/u.test(s[i])) text = true;
      else if (/[\p{S}…⋯]/u.test(s[i])) icon = true;
      i++;
    }
  }
  return { icon, text };
}

export function isIconOnly(inner) {
  if (/icon-button-ok/.test(inner)) return false;
  const { icon, text } = contentOf(inner);
  return icon && !text;
}

export function problem(attrs) {
  const names = attrNames(attrs);
  if (names.has('title')) return null;
  if (names.has('data-tooltip')) {
    return names.has('aria-label') || names.has('aria-labelledby')
      ? null
      : 'data-tooltip without aria-label';
  }
  return 'no title or data-tooltip';
}

// The end of the element that starts at `after` (just past its opening tag): the matching close.
function closeOf(s, name, after) {
  const re = new RegExp(`<(/?)${name}\\b`, 'gi');
  re.lastIndex = after;
  let depth = 0;
  for (let m; (m = re.exec(s)); ) {
    if (m[1]) {
      if (depth === 0) return m.index;
      depth--;
    } else {
      const r = readAttrs(s, m.index + m[0].length);
      if (r && !r[0].trimEnd().endsWith('/')) depth++;
    }
  }
  return -1;
}

const OPEN_RE = /<([a-z][\w-]*)\b/g;
// A class that says an empty element is a button drawn by CSS
const DRAWN_RE = /\bclass\s*=\s*["'`]?[^"'`>]*\b(?:close|btn|button|icon)\b/;

export function scanSource(src) {
  const out = [];
  for (const m of src.matchAll(OPEN_RE)) {
    const name = m[1];
    const read = readAttrs(src, m.index + m[0].length);
    if (!read) continue;
    const [attrs, after] = read;
    if (!isControl(name, attrs)) continue;
    let end;
    let iconOnly;
    if (name === 'img' || attrs.trimEnd().endsWith('/')) {
      end = after;
      iconOnly = name === 'img';
    } else {
      const close = closeOf(src, name, after);
      if (close < 0) continue;
      end = close + name.length + 3;
      const inner = src.slice(after, close);
      // an icon element that is itself the control: <span class="fas fa-times" @click=…></span>
      if (/icon-button-ok/.test(inner)) continue;
      const { icon, text } = contentOf(inner);
      if (text) continue;
      // An icon element that is itself the control (<span class="fas fa-times" @click=…>), or
      // an empty one that CSS draws (<div class="tab-close" @click=…></div>).
      iconOnly =
        icon || isIconElement(name, attrs) || (inner.trim() === '' && DRAWN_RE.test(attrs));
    }
    if (!iconOnly) continue;
    const why = problem(attrs);
    if (!why) continue;
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ line, why, snippet: src.slice(m.index, end).replace(/\s+/g, ' ').slice(0, 160) });
  }
  return out;
}

// ---- the phone (React Native) ----------------------------------------------------------------
// Icon buttons there are `IconButton` (components/IconButton.tsx), which takes a required
// `label` and shows it on touch and hold. A hand-built Pressable/Touchable* whose only child is
// an icon must do the same: an `accessibilityLabel` for TalkBack and an `onLongPress` (usually
// `() => showLabel(label)` from lib/tooltip.ts) so a sighted user can find out what it does.

const MOBILE_DIRS = ['mobile/app', 'mobile/components'];
const TOUCH_RE =
  /<(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|TouchableNativeFeedback)\b/g;
const RN_ICON_RE =
  /<(Icon|FontAwesome\w*|SiteIcon|Image|ActivityIndicator)\b(?:[^>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\/>/g;

// JSX attributes up to the tag's `>`, skipping `{…}` (which can hold `=>`).
function readJsxAttrs(s, i) {
  const start = i;
  let depth = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if ((c === "'" || c === '"' || c === '`') && depth > 0)
      i = (c === '`' ? skipTemplate(s, i) : skipQuoted(s, i)) - 1;
    else if (c === '>' && depth === 0) return [s.slice(start, i), i + 1];
  }
  return null;
}

export function scanMobileSource(src) {
  const out = [];
  for (const m of src.matchAll(TOUCH_RE)) {
    const name = m[1];
    const read = readJsxAttrs(src, m.index + m[0].length);
    if (!read) continue;
    const [attrs, after] = read;
    if (attrs.trimEnd().endsWith('/')) continue;
    const close = closeOf(src, name, after);
    if (close < 0) continue;
    const inner = src.slice(after, close);
    if (/icon-button-ok/.test(inner)) continue;
    RN_ICON_RE.lastIndex = 0;
    if (!RN_ICON_RE.test(inner)) continue;
    // anything but icons (a <Text>, a {…} that might render one) is a visible label
    if (inner.replace(RN_ICON_RE, '').trim() !== '') continue;
    const missing = [];
    if (!/\baccessibilityLabel\s*=|\baria-label\s*=/.test(attrs))
      missing.push('accessibilityLabel');
    if (!/\bonLongPress\s*=/.test(attrs)) missing.push('onLongPress (showLabel)');
    if (!missing.length) continue;
    const line = src.slice(0, m.index).split('\n').length;
    out.push({
      line,
      why: `no ${missing.join(' or ')}; use IconButton`,
      snippet: src
        .slice(m.index, close + name.length + 3)
        .replace(/\s+/g, ' ')
        .slice(0, 160),
    });
  }
  return out;
}

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (SKIP.some((re) => re.test(p))) continue;
    if (ent.isDirectory()) yield* walk(p);
    else if (/\.(js|mjs|ts|tsx|html)$/.test(ent.name)) yield p;
  }
}

export function scanRepo(root = ROOT) {
  const results = [];
  for (const d of DIRS) {
    for (const file of walk(path.join(root, d))) {
      const src = fs.readFileSync(file, 'utf8');
      for (const r of scanSource(src)) results.push({ file: path.relative(root, file), ...r });
    }
  }
  for (const d of MOBILE_DIRS) {
    const dir = path.join(root, d);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      if (!file.endsWith('.tsx')) continue;
      const src = fs.readFileSync(file, 'utf8');
      for (const r of scanMobileSource(src))
        results.push({ file: path.relative(root, file), ...r });
    }
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const found = scanRepo();
  for (const r of found) console.log(`${r.file}:${r.line}  ${r.why}\n    ${r.snippet}`);
  console.log(`\n${found.length} icon-only control(s) without a tooltip`);
  process.exit(found.length ? 1 : 0);
}
