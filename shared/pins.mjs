// nomad/shared/pins.mjs
//
// A Space's pinned pages. Desktop shows them as icon tiles at the top of the tab sidebar (and as
// pinned tabs in the top bar); the phone shows them as shortcuts on its home page. Both read and
// write one file in the Space's Root Drive (its Space Library when the Space is shared, ADR-0029):
//
//   /nomad/pins.json   ["https://example.com/", "hyper://<key>/", ...]   (in the order pinned)
//
// A pin's title is the title of the bookmark with the same href in that drive (the phone and the
// new tab page do the same), so pinning a page also bookmarks it.
//
// On desktop a pinned tab is bound to one pin by its `pinUrl`. The pin is what persists: closing
// the tab leaves the tile, and clicking the tile opens the tab again. Unpinning on any Device
// unpins the bound tab on the others (it stays open as an ordinary tab).
//
// Pure: no imports. Used by app/bg/ui/space-pins.js (desktop); the phone's mobile/lib/hyperUrl.ts
// normalizeUrl gives the same canonical form.

export const PINS_PATH = '/nomad/pins.json';
export const BOOKMARKS_PREFIX = '/bookmarks/';

const MAX_PINS = 100;
const MAX_URL = 2048;
const MAX_TITLE = 300;

// The canonical form a pin is stored and matched in: no userinfo, no default port, at least a '/'
// path; http(s) hosts lowercased. The same as desktop's normalizeUrl (app/lib/urls.ts) and the
// phone's (mobile/lib/hyperUrl.ts), so the Devices agree on which page a pin is.
export function normalizePinUrl(url) {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(
    String(url || '').trim()
  );
  if (!m) return '';
  const scheme = m[1].toLowerCase();
  let host = m[2].replace(/^[^@]*@/, '');
  if (scheme === 'http' || scheme === 'https') {
    host = host.toLowerCase().replace(scheme === 'https' ? /:443$/ : /:80$/, '');
  }
  if (!host) return '';
  return `${scheme}://${host}${m[3] || '/'}${m[4] || ''}${m[5] || ''}`;
}

// Whether a page can be pinned: anything with a scheme and a host, except the new tab page.
export function isPinnable(url) {
  const href = normalizePinUrl(url);
  return !!href && href.length <= MAX_URL && !href.startsWith('nomad://desktop/');
}

// The pins in a pins.json body (string or bytes already decoded), normalized, deduped, in order.
// Anything unreadable is no pins.
export function parsePins(text) {
  let data;
  try {
    data = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out = [];
  for (const v of data) {
    if (typeof v !== 'string') continue;
    const href = normalizePinUrl(v);
    if (href && href.length <= MAX_URL && !out.includes(href)) out.push(href);
    if (out.length >= MAX_PINS) break;
  }
  return out;
}

export function serializePins(pins) {
  return JSON.stringify(parsePins(pins), null, 2);
}

// `pins` with `href` added (at `at`, else at the end). Already pinned: unchanged.
export function withPin(pins, href, at) {
  const h = normalizePinUrl(href);
  const list = parsePins(pins);
  if (!h || list.includes(h)) return list;
  const i = Number.isInteger(at) && at >= 0 && at <= list.length ? at : list.length;
  list.splice(i, 0, h);
  return list.slice(0, MAX_PINS);
}

export function withoutPin(pins, href) {
  const h = normalizePinUrl(href);
  return parsePins(pins).filter((p) => p !== h);
}

// `pins` with `href` moved to index `to` (counted in the list without it).
export function movePin(pins, href, to) {
  const h = normalizePinUrl(href);
  const list = parsePins(pins);
  if (!list.includes(h)) return list;
  const rest = list.filter((p) => p !== h);
  const i = Math.max(0, Math.min(rest.length, Number.isInteger(to) ? to : rest.length));
  rest.splice(i, 0, h);
  return rest;
}

// What a pin is called when no bookmark names it: the host (or a short drive key).
export function fallbackTitle(href) {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(String(href || ''));
  if (!m) return String(href || '');
  const host = m[2].replace(/^www\./i, '');
  if (m[1].toLowerCase() === 'hyper' && /^[0-9a-z]{52,64}$/i.test(host))
    return `${host.slice(0, 6)}…${host.slice(-4)}`;
  return host;
}

// A pin's address as its tile's tooltip shows it: no http(s):// or www., no lone trailing slash,
// and a hyper:// key cut short like fallbackTitle.
export function pinTooltipUrl(url) {
  const s = String(url || '');
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/is.exec(s);
  if (!m) return s;
  const scheme = m[1].toLowerCase();
  let host = m[2];
  const rest = m[3] === '/' ? '' : m[3];
  if (scheme === 'http' || scheme === 'https') return host.replace(/^www\./i, '') + rest;
  if (scheme === 'hyper' && /^[0-9a-z]{52,64}$/i.test(host))
    host = `${host.slice(0, 6)}…${host.slice(-4)}`;
  return `${scheme}://${host}${rest}`;
}

// [{ href, title }] for `pins`, each titled by its bookmark (`bookmarks`: [{ href, title }]).
export function titledPins(pins, bookmarks = []) {
  const titles = new Map();
  for (const b of bookmarks || []) {
    const h = normalizePinUrl(b && b.href);
    const t = typeof b?.title === 'string' ? b.title.trim() : '';
    if (h && t && !titles.has(h)) titles.set(h, t.slice(0, MAX_TITLE));
  }
  return parsePins(pins).map((href) => ({ href, title: titles.get(href) || fallbackTitle(href) }));
}

// How the pinned tabs of one Space line up with its pins, once the pins are known.
// `tabs`: [{ isPinned, pinUrl?, url }] (only that Space's tabs). Returns:
//   bind:   [{ index, href }]  a pinned tab with no pinUrl yet (a tab pinned before pins synced):
//                              bind it to the pin for its page
//   add:    [href]             those pages, when they aren't pinned yet: pin them (once)
//   unpin:  [index]            a pinned tab whose pin was removed (on any Device), or a second tab
//                              bound to the same pin: make it an ordinary tab
export function reconcileTabs(tabs, pins) {
  const set = new Set(parsePins(pins));
  const taken = new Set();
  const out = { bind: [], add: [], unpin: [] };
  (tabs || []).forEach((tab, index) => {
    if (!tab || !tab.isPinned) return;
    if (tab.pinUrl) {
      const href = normalizePinUrl(tab.pinUrl);
      if (!set.has(href) || taken.has(href)) out.unpin.push(index);
      else taken.add(href);
      return;
    }
    const href = normalizePinUrl(tab.url);
    if (!href || !isPinnable(href) || taken.has(href)) {
      out.unpin.push(index);
      return;
    }
    taken.add(href);
    out.bind.push({ index, href });
    if (!set.has(href) && !out.add.includes(href)) out.add.push(href);
  });
  return out;
}

// The tiles to draw for one Space: each pin, with the visible tab index of its open tab (or -1),
// then any pinned tab that no pin names yet (pins not loaded, or a write still on its way).
// `tabs`: the window's visible tabs, [{ isPinned, pinUrl?, url, title }].
export function pinTiles(pins, tabs) {
  const tiles = [];
  const used = new Set();
  for (const pin of pins || []) {
    const index = (tabs || []).findIndex(
      (t, i) => t && t.isPinned && !used.has(i) && normalizePinUrl(t.pinUrl || t.url) === pin.href
    );
    if (index !== -1) used.add(index);
    tiles.push({ href: pin.href, title: pin.title, index });
  }
  (tabs || []).forEach((t, index) => {
    if (!t || !t.isPinned || used.has(index)) return;
    const href = normalizePinUrl(t.pinUrl || t.url) || String(t.url || '');
    tiles.push({ href, title: t.title || fallbackTitle(href), index });
  });
  return tiles;
}
