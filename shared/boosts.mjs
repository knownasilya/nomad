// nomad/shared/boosts.mjs
//
// Boosts: the user's own changes to a site, like Arc's (ADR-0023). A Boost belongs to a site and
// holds any of: preset styles (dark mode, sepia, …), elements to hide (CSS selectors, picked with
// the zapper or typed), custom CSS, and custom JavaScript. Each has a name and can be turned on and
// off from the tab. One set per user, kept in the Vault so every linked Device has them:
//
//   /.vault/boosts/<id>.json   { type, id, name, site, enabled, presets, hide, css, js, createdAt, updatedAt }
//
// `site` is a host without "www." (example.com). A Boost applies to that host and every host under
// it (www.example.com, docs.example.com), over http, https and hyper://.
//
// Pure: no imports. Used by app/bg/ui/boosts.js, the webview preload, and the shell menu.

export const BOOSTS_PREFIX = '/.vault/boosts/';
export const BOOST_TYPE = 'nomad/boost';

const PAGE_SCHEMES = ['http:', 'https:', 'hyper:'];
const MAX_NAME = 80;
const MAX_CODE = 200000; // characters, for each of css and js
const MAX_SELECTOR = 1000;
const MAX_HIDE = 1000;

// Sites
// =

const HOSTNAME = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;

// The host of a page Boosts can change, lowercased, without a trailing dot. Null for any other
// page: nomad://, file://, the private drive, a frame-less error page.
export function pageHost(url) {
  let u;
  try {
    u = new URL(String(url || ''));
  } catch {
    return null;
  }
  if (!PAGE_SCHEMES.includes(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || (u.protocol === 'hyper:' && host === 'private')) return null;
  return host;
}

// The site a new Boost for this page gets: its host without "www.".
export function siteOf(url) {
  const host = pageHost(url);
  return host ? host.replace(/^www\./, '') : null;
}

// A site as typed: "https://www.example.com/x", "*.example.com" or "example.com" give
// "example.com". Throws for something that isn't a host.
export function normalizeSite(input) {
  let s = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/^\*\./, '');
  if (!s) throw new Error('A Boost needs a site, like example.com');
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = 'https://' + s;
  let host = '';
  try {
    host = new URL(s).hostname.toLowerCase();
  } catch {}
  host = host.replace(/\.$/, '').replace(/^www\./, '');
  if (!host || !HOSTNAME.test(host) || host === 'private') {
    throw new Error(`“${String(input).trim()}” isn’t a site. Use a host, like example.com`);
  }
  return host;
}

// Does a Boost for `site` apply to the page at `url`? The site itself and every host under it.
export function matchesSite(site, url) {
  const host = pageHost(url);
  if (!host || !site) return false;
  return host === site || host.endsWith('.' + site);
}

// Presets
// =

// Each preset adds to the page's filter, its own CSS, or both. Filters from every preset turned
// on for a page go in one `filter` on the root element, so dark mode and sepia mix.
// Nomad's own layers on the page (the zapper, Highlights' note buttons) are turned back too.
const MEDIA =
  'img, video, canvas, iframe, embed, object, [style*="background-image"], nomad-boost-zapper, nomad-highlights';
export const PRESETS = [
  {
    id: 'dark',
    label: 'Dark mode',
    description: 'Inverts light pages, keeping photos and video as they are',
    filter: 'invert(1) hue-rotate(180deg)',
    // The root gets a background so the inverted canvas is dark, and media is turned back, once
    // (not again inside media already turned back).
    css:
      'html { background-color: #fff !important; }\n' +
      `:is(${MEDIA}):not(:is(${MEDIA}) *) { filter: invert(1) hue-rotate(180deg) !important; }`,
  },
  {
    id: 'sepia',
    label: 'Sepia',
    description: 'Warmer colors, easier on the eyes at night',
    filter: 'sepia(0.45) brightness(0.97)',
    css: '',
  },
  {
    id: 'grayscale',
    label: 'Grayscale',
    description: 'No color, fewer distractions',
    filter: 'grayscale(1)',
    css: '',
  },
  {
    id: 'no-motion',
    label: 'No animations',
    description: 'Stops CSS animations, transitions and smooth scrolling',
    filter: '',
    css:
      '*, *::before, *::after { animation: none !important; transition: none !important; }\n' +
      'html { scroll-behavior: auto !important; }',
  },
  {
    id: 'hide-media',
    label: 'Hide images',
    description: 'Hides images and video, keeping the layout',
    filter: '',
    css: 'img, picture, video, svg image { visibility: hidden !important; }',
  },
];

const PRESET_IDS = PRESETS.map((p) => p.id);
export const presetById = (id) => PRESETS.find((p) => p.id === id) || null;

// Selectors
// =

// A selector to hide. Each one gets a rule of its own, so one the browser can't parse hides
// nothing but leaves the others working; braces would let it end its rule early.
export function isHideSelector(s) {
  return (
    typeof s === 'string' &&
    s.trim().length > 0 &&
    s.length <= MAX_SELECTOR &&
    !/[{}]/.test(s) &&
    !s.includes('/*')
  );
}

const STATE_CLASS =
  /^(is-|has-|js-)|^(active|hover|hovered|focus|focused|open|opened|closed|selected|visible|hidden|show|shown|current|expanded|collapsed|loaded|loading|sticky|fixed)$/i;

// Whether a class or id names the element the same way on the next load. Generated names (CSS
// modules, CSS-in-JS hashes, React ids, long numbers) change between builds or visits, and state
// classes come and go as the page is used. Only plain identifiers pass, so they need no escaping.
export function isStableName(s) {
  if (typeof s !== 'string' || !/^-?[a-zA-Z_][\w-]*$/.test(s) || s.length > 40) return false;
  if (STATE_CLASS.test(s)) return false;
  if (/\d{3,}/.test(s)) return false; // post-12345, ember1234
  if (/^(css|sc|jsx|emotion|svelte|astro|styled)-/i.test(s)) return false; // CSS-in-JS
  if (/_{1,2}[a-zA-Z0-9-]{5,}$/.test(s) && /\d/.test(s.slice(s.lastIndexOf('_')))) return false; // CSS modules
  // Letters and digits mixed through a short word: a hash (a1b2c3, xY9kP2).
  const digits = (s.match(/\d/g) || []).length;
  if (digits >= 2 && /[a-z]\d[a-z]|\d[a-z]\d/i.test(s)) return false;
  return true;
}

// The selector that names `el` and nothing else on the page, made of what should hold on the next
// load: a stable id if one is near, then tags with their stable classes, and a position among
// same-tag siblings only where those don't tell them apart. `count(selector)` is how many elements
// on the page match. `el` needs tagName, id, classList, parentElement and children, as an Element
// has.
export function selectorFor(el, count, { maxDepth = 8 } = {}) {
  const parts = [];
  let node = el;
  while (node && node.tagName && parts.length < maxDepth) {
    const tag = String(node.tagName).toLowerCase();
    if (tag === 'html') break;
    if (node.id && isStableName(node.id) && count('#' + node.id) === 1) {
      parts.unshift('#' + node.id);
      return parts.join(' > ');
    }
    const classes = [...(node.classList || [])].filter(isStableName).slice(0, 3);
    let seg = tag + classes.map((c) => '.' + c).join('');
    const parent = node.parentElement;
    if (parent && tag !== 'body') {
      const siblings = [...parent.children];
      const alike = siblings.filter(
        (c) =>
          String(c.tagName).toLowerCase() === tag && classes.every((cl) => c.classList.contains(cl))
      );
      if (alike.length > 1) {
        const sameTag = siblings.filter((c) => String(c.tagName).toLowerCase() === tag);
        seg += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
    }
    parts.unshift(seg);
    const sel = parts.join(' > ');
    if (count(sel) === 1 || tag === 'body') return sel;
    node = parent;
  }
  return parts.join(' > ');
}

// The selector for every element like `el`: its tag and stable classes, wherever they are. Null
// when it has no stable class (a bare tag would hide far too much).
export function similarSelectorFor(el) {
  const tag = String(el?.tagName || '').toLowerCase();
  const classes = [...(el?.classList || [])].filter(isStableName).slice(0, 3);
  if (!tag || !classes.length || tag === 'body' || tag === 'html') return null;
  return tag + classes.map((c) => '.' + c).join('');
}

// Records
// =

// Sorts by creation time, and is safe to use as a path segment.
export function newBoostId(now = Date.now(), rand = Math.random) {
  const tail = Math.floor(rand() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return now.toString(36).padStart(9, '0') + '-' + tail;
}

export function isBoostId(id) {
  return typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id);
}

export function boostPath(id) {
  if (!isBoostId(id)) throw new Error('Not a boost id: ' + id);
  return BOOSTS_PREFIX + id + '.json';
}

const oneLine = (s) =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .trim();

function code(s, what) {
  const text = typeof s === 'string' ? s : '';
  if (text.length > MAX_CODE)
    throw new Error(`The ${what} is too long (over ${MAX_CODE} characters)`);
  return text;
}

// The selectors to hide, trimmed, without repeats, in the order given. Throws for one that can't
// be a selector, naming it.
export function cleanHideList(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const s = String(raw || '').trim();
    if (!s) continue;
    if (!isHideSelector(s)) throw new Error(`“${s.slice(0, 60)}” can’t be used as a selector`);
    if (!out.includes(s)) out.push(s);
  }
  if (out.length > MAX_HIDE)
    throw new Error(`A Boost can hide at most ${MAX_HIDE} kinds of element`);
  return out;
}

// The Boost record to store. `prev` is the stored Boost with that id, if any; fields left out
// keep its values.
/**
 * @param {{ id: string, name?: string, site?: string, enabled?: boolean, presets?: string[], hide?: string[], css?: string, js?: string }} fields
 * @param {any} [prev]
 */
export function makeBoost(fields, prev = null, now = new Date().toISOString()) {
  const f = {
    ...prev,
    ...Object.fromEntries(Object.entries(fields || {}).filter(([, v]) => v !== undefined)),
  };
  if (!isBoostId(f.id)) throw new Error('Not a boost id: ' + f.id);
  const site = normalizeSite(f.site);
  const name = oneLine(f.name).slice(0, MAX_NAME) || site;
  const presets = PRESET_IDS.filter((id) => Array.isArray(f.presets) && f.presets.includes(id));
  return {
    type: BOOST_TYPE,
    id: f.id,
    name,
    site,
    enabled: f.enabled !== false,
    presets,
    hide: cleanHideList(f.hide),
    css: code(f.css, 'CSS'),
    js: code(f.js, 'JavaScript'),
    createdAt: (prev && prev.createdAt) || now,
    updatedAt: now,
  };
}

export function isBoost(rec) {
  return (
    !!rec &&
    rec.type === BOOST_TYPE &&
    isBoostId(rec.id) &&
    typeof rec.site === 'string' &&
    HOSTNAME.test(rec.site)
  );
}

// Oldest first, the order they were made: the order their CSS applies in, so a later Boost wins.
export function sortBoosts(list) {
  return [...(list || [])].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1
  );
}

// The Boosts for the page at `url`, on or off, oldest first.
export function boostsFor(url, list) {
  return sortBoosts((list || []).filter((b) => isBoost(b) && matchesSite(b.site, url)));
}

// What a Boost does, in a few words, for a menu: ["Dark mode", "3 hidden", "CSS", "JS"].
export function describeBoost(b) {
  const out = (b.presets || []).map((id) => presetById(id)?.label).filter(Boolean);
  if (b.hide && b.hide.length) out.push(`${b.hide.length} hidden`);
  if (b.css && b.css.trim()) out.push('CSS');
  if (b.js && b.js.trim()) out.push('JS');
  return out;
}

// Applying
// =

// The CSS that hides the Boost's elements: one rule per selector.
export function hideCss(hide) {
  return (hide || [])
    .filter(isHideSelector)
    .map((s) => `${s} { display: none !important; }`)
    .join('\n');
}

// The stylesheet for a page from its Boosts that are on, in order: the presets once each (one
// root filter for all of them), then each Boost's hidden elements and its own CSS. Empty when no
// Boost styles the page.
export function pageCss(boosts) {
  const on = (boosts || []).filter((b) => b && b.enabled !== false);
  const presets = PRESETS.filter((p) => on.some((b) => (b.presets || []).includes(p.id)));
  const chunks = [];
  const filter = presets
    .map((p) => p.filter)
    .filter(Boolean)
    .join(' ');
  if (filter) chunks.push(`html { filter: ${filter} !important; }`);
  for (const p of presets) if (p.css) chunks.push(p.css);
  for (const b of on) {
    const hidden = hideCss(b.hide);
    if (hidden) chunks.push(`/* ${commentSafe(b.name)}: hidden elements */\n${hidden}`);
    if (b.css && b.css.trim()) chunks.push(`/* ${commentSafe(b.name)} */\n${b.css}`);
  }
  return chunks.join('\n\n');
}

const commentSafe = (s) => oneLine(s).replace(/\*\//g, '* /');

// The script that runs a Boost's JavaScript in the page: inside an async function (so `await`
// works and its names stay its own), with errors logged under the Boost's name. The sourceURL
// names it in the page's devtools.
export function boostScript(b) {
  const label = JSON.stringify(`Boost “${oneLine(b.name)}” failed:`);
  return (
    `(async () => {\n${b.js}\n})().catch((e) => console.error(${label}, e));\n` +
    `//# sourceURL=nomad-boost:///${b.id}.js`
  );
}

// A short hash of a script's code (53 bits, as hex), so the page can tell a script it already ran
// from one that changed.
export function codeRev(text) {
  const s = String(text || '');
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

// What the page gets: its stylesheet and the scripts to run, from the Boosts that are on. A
// script's `rev` changes only when its code does.
export function pagePayload(url, list) {
  const boosts = boostsFor(url, list).filter((b) => b.enabled !== false);
  return {
    css: pageCss(boosts),
    scripts: boosts
      .filter((b) => b.js && b.js.trim())
      .map((b) => ({ id: b.id, name: b.name, rev: codeRev(b.js), code: boostScript(b) })),
  };
}
