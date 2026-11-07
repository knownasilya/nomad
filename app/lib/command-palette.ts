// The Cmd/Ctrl+K command palette (fg/shell-menus/command-palette.js): one box that opens an
// address, switches to an open tab, reopens a recent page, or opens one of Nomad's own pages.
// Everything it lists is the current Space's: its tabs in this window and the history visited in it
// (bg/ui/subwindows/shell-menus.js `getPalette` / `searchPaletteHistory`). No DOM here, so
// tests/unit/command-palette.test.js runs it as it is.
//
// Matching is the rule Notes and Reader use (app-stdlib/js/search-match.js): every word typed, in
// any order, ignoring case and accents.

import { examineLocationInput } from './urls';
import { foldText, queryWords, matchesWords } from '../userland/app-stdlib/js/search-match.js';
import { matchNames } from '../../shared/names.mjs';

// Nomad's own pages. `app` is the page whose favicon the row shows; `keywords` are other words a
// person might type for it. `top` pages are listed before anything is typed.
export const BUILTIN_PAGES = [
  { url: 'nomad://library/', title: 'My Library', app: 'library', keywords: 'hyperdrives drives', top: true },
  { url: 'nomad://notes/', title: 'Notes', app: 'notes', top: true },
  { url: 'nomad://reader/', title: 'Reader', app: 'reader', keywords: 'feeds rss subscriptions', top: true },
  { url: 'nomad://calendar/', title: 'Calendar', app: 'calendar', keywords: 'events agenda', top: true },
  { url: 'nomad://photos/', title: 'Photos', app: 'photos', keywords: 'album pictures', top: true },
  { url: 'nomad://messages/', title: 'Messages', app: 'messages', keywords: 'inbox', top: true },
  { url: 'nomad://ai/', title: 'AI', app: 'ai', keywords: 'assistant', top: true },
  { url: 'nomad://history/', title: 'History', app: 'history', top: true },
  { url: 'nomad://search/', title: 'Search', app: 'search', top: true },
  { url: 'nomad://settings/', title: 'Settings', app: 'settings', keywords: 'preferences', top: true },
  { url: 'nomad://library/jobs', title: 'Jobs', section: 'My Library', app: 'library', keywords: 'ai schedule' },
  { url: 'nomad://library/mods', title: 'Mods', section: 'My Library', app: 'library', keywords: 'css styles' },
  { url: 'nomad://library/names', title: 'Names', section: 'My Library', app: 'library' },
  { url: 'nomad://library/personas', title: 'Personas', section: 'My Library', app: 'library', keywords: 'identity profile' },
  { url: 'nomad://library/secrets', title: 'Secrets', section: 'My Library', app: 'library', keywords: 'api keys tokens' },
  { url: 'nomad://library/sharing', title: 'Sharing', section: 'My Library', app: 'library', keywords: 'shared spaces members' },
  { url: 'nomad://library/bookmarks', title: 'Bookmarks', section: 'My Library', app: 'library' },
  { url: 'nomad://library/downloads', title: 'Downloads', section: 'My Library', app: 'library' },
  { url: 'nomad://ai/chats', title: 'Chats', section: 'AI', app: 'ai', keywords: 'conversations' },
  { url: 'nomad://ai/memory', title: 'Memory', section: 'AI', app: 'ai', keywords: 'memories' },
  { url: 'nomad://ai/skills', title: 'Skills', section: 'AI', app: 'ai' },
  { url: 'nomad://ai/sites', title: 'Sites', section: 'AI', app: 'ai', keywords: 'send data allowed' },
  { url: 'nomad://ai/setup', title: 'Setup', section: 'AI', app: 'ai', keywords: 'models settings' },
  { url: 'hyper://private/', title: 'My Private Drive', icon: 'fas fa-lock', keywords: 'private' },
  { url: 'nomad://webmcp/', title: 'WebMCP Inspector', icon: 'fas fa-plug', keywords: 'tools devtools' },
];

export const RECENT_LIMIT = 8;
export const TAB_LIMIT = 20;

// Group headings, in the order the groups are listed.
export const GROUPS = {
  tab: 'Open tabs',
  name: 'Names',
  page: 'Nomad pages',
  recent: 'Recent',
};

// Pages that aren't worth reopening: the new tab page and the palette's own kind of chrome.
const SKIP_RECENT = /^(nomad:\/\/desktop|nomad:\/\/shell-|about:blank)/;

export function normalizeUrl(url = '') {
  return String(url).replace(/#.*$/, '').replace(/\/$/, '');
}

// Is this the empty new tab page? The palette opens a page there instead of beside it.
export function isNewTabPage(url = '') {
  return !url || String(url).startsWith('nomad://desktop');
}

type PaletteTab = { index: number; title?: string; url: string; isActive?: boolean; isPinned?: boolean };
type PaletteVisit = { url: string; title?: string; ts?: number };
type PaletteInput = {
  query?: string;
  tabs?: PaletteTab[]; // this Space's tabs in this window
  recent?: PaletteVisit[]; // this Space's newest visits, newest first
  history?: PaletteVisit[]; // this Space's history search for the query
  searchEngine?: { name: string; url: string } | null;
  names?: Array<{ name: string; url: string; title?: string; hidden?: boolean }>; // the user's names and this Space's (hyper/names.js)
};

// The palette's rows for what's typed, in the order they're listed; Enter opens the first. Each is
// { kind: 'goto'|'search'|'name'|'tab'|'page'|'recent', title, url, subtitle?, tabIndex?, group? },
// and one with a tabIndex switches to that tab.
export function paletteResults({ query = '', tabs = [], recent = [], history = [], searchEngine, names = [] }: PaletteInput = {}): any[] {
  const q = String(query || '').trim();
  if (q.startsWith(NAMES_ONLY)) return nameResults(q.slice(NAMES_ONLY.length).trim(), names);
  const words = queryWords(q);
  const otherTabs = tabs.filter((t) => !t.isActive);
  const openUrls = new Map();
  for (const t of tabs) {
    const key = normalizeUrl(t.url);
    if (!openUrls.has(key) || !t.isActive) openUrls.set(key, t);
  }

  // Open tabs (not the one you're on: switching to it does nothing)
  const tabRows = rank(
    otherTabs
      .filter((t) => matchesWords(`${t.title || ''} ${t.url || ''}`, words))
      .map((t) => ({
        kind: 'tab',
        group: GROUPS.tab,
        title: t.title || t.url,
        url: t.url,
        subtitle: t.url,
        tabIndex: t.index,
        isPinned: !!t.isPinned,
      })),
    words
  ).slice(0, TAB_LIMIT);

  // Nomad's own pages. One that's already open in a tab switches to it, and isn't listed again when
  // that tab is listed above.
  const pages = words.length ? BUILTIN_PAGES : BUILTIN_PAGES.filter((p) => p.top);
  const listedTabs = new Set(tabRows.map((r) => r.tabIndex));
  const pageRows = rank(
    pages
      .filter((p) => matchesWords(`${p.title} ${p.section || ''} ${p.keywords || ''} ${p.url}`, words))
      .map((p) => {
        // the tab you're on counts too: choosing it just closes the palette, never opens a second copy
        const open = findOpenTab(otherTabs, p.url) || findOpenTab(tabs, p.url);
        return {
          kind: 'page',
          group: GROUPS.page,
          title: p.section ? `${p.section} · ${p.title}` : p.title,
          url: p.url,
          subtitle: p.url,
          app: p.app,
          icon: p.icon,
          tabIndex: open ? open.index : undefined,
        };
      })
      .filter((r) => r.tabIndex === undefined || !listedTabs.has(r.tabIndex)),
    words
  );

  // Recent pages in this Space: the newest visits that match, then older history that does. A page
  // open in a tab is listed there instead.
  const seen = new Set(openUrls.keys());
  for (const p of BUILTIN_PAGES) seen.add(normalizeUrl(p.url));
  const recentRows = [];
  for (const v of [...recent, ...history]) {
    if (recentRows.length >= RECENT_LIMIT) break;
    if (!v || !v.url || SKIP_RECENT.test(v.url)) continue;
    const key = normalizeUrl(v.url);
    if (seen.has(key)) continue;
    if (!matchesWords(`${v.title || ''} ${v.url}`, words)) continue;
    seen.add(key);
    recentRows.push({
      kind: 'recent',
      group: GROUPS.recent,
      title: v.title || v.url,
      url: v.url,
      subtitle: v.url,
      ts: v.ts,
    });
  }

  // Before anything is typed, where you've been comes before the list of Nomad's pages; once you
  // type, a page whose name you typed is a better match than a page you visited.
  if (!q) return [...tabRows, ...recentRows, ...pageRows];

  // What's typed, as an address and as a search
  const { vWithProtocol, vSearch, isProbablyUrl } = examineLocationInput(q);
  const engine = searchEngine || { name: 'Nomad', url: 'nomad://search/?q=' };
  const goto = { kind: 'goto', title: `Go to ${q}`, url: vWithProtocol };
  const search = {
    kind: 'search',
    title: `Search ${engine.name} for “${q}”`,
    url: engine.url + vSearch,
    query: q,
  };
  // The user's names (ADR-0018), matched the way the location bar matches them (shared/names.mjs):
  // the exact name goes first, so typing "blog" and pressing Enter opens it; the rest are a group
  // after the tabs. A name opens as hyper://<name>/, which the tab resolves in this Space. A Space's
  // name that one of the user's own hides doesn't work, so it isn't offered.
  const typedName = q.toLowerCase().replace(/^hyper:\/\//, '').replace(/\/$/, '');
  const nameRows = matchNames(q, names.filter((r) => !r.hidden)).map((r) => ({
    ...nameRow(r),
    exact: r.name === typedName,
  }));
  // the exact name sits at the top on its own, like Go to
  const exactName = nameRows.filter((r) => r.exact).map((r) => ({ ...r, group: undefined }));
  const otherNames = nameRows.filter((r) => !r.exact);

  const matches = [...exactName, ...tabRows, ...otherNames, ...pageRows, ...recentRows];
  // "hyper://blog/" for a name is already its row
  const gotoIsName = exactName.some((r) => normalizeUrl(r.url) === normalizeUrl(goto.url));
  if (isProbablyUrl && !gotoIsName) return [goto, ...matches, search];
  return [...matches, search];
}

// "#" first searches only the user's names: "#" alone lists them all, A to Z, and "#bl" the ones
// that match, the exact name first. No Go to and no search, so Enter always opens a name.
export const NAMES_ONLY = '#';
export const NAMES_LIMIT = 50;

export function isNamesOnly(query = '') {
  return String(query || '').trim().startsWith(NAMES_ONLY);
}

function nameRow(r) {
  return {
    kind: 'name',
    group: GROUPS.name,
    title: r.name,
    url: `hyper://${r.name}/`,
    subtitle: r.title ? `${r.title} · ${r.url}` : r.url,
  };
}

function nameResults(q, names = []) {
  const usable = names.filter((r) => r && r.name && !r.hidden);
  const found = q
    ? matchNames(q, usable, NAMES_LIMIT)
    : [...usable].sort((a, b) => a.name.localeCompare(b.name)).slice(0, NAMES_LIMIT);
  return found.map(nameRow);
}

// Is a page open in one of these tabs? Its own address or one under it (nomad://notes/<id>).
export function findOpenTab(tabs: PaletteTab[], url: string) {
  const base = normalizeUrl(url);
  // An app's own sub-pages (nomad://notes/<id>) count as the app, except where the palette lists
  // the sub-pages themselves (My Library's and the AI page's).
  const coversSubpages =
    /^nomad:\/\/[^/]+$/.test(base) && base !== 'nomad://library' && base !== 'nomad://ai';
  return tabs.find((t) => {
    const u = String(t.url || '').replace(/#.*$/, '');
    const n = normalizeUrl(u);
    return n === base || u.startsWith(base + '?') || u.startsWith(base + '/?') || (coversSubpages && u.startsWith(base + '/'));
  });
}

// Best matches first: a title that starts with the first word, then one with a word that does,
// then the rest, each kept in the order it came.
function rank(rows, words) {
  if (!words.length) return rows;
  const first = words[0];
  const score = (r) => {
    const t = foldText(r.title);
    if (t.startsWith(first)) return 0;
    if (new RegExp(`(^|[\\s·/.:-])${escapeRe(first)}`).test(t)) return 1;
    return 2;
  };
  return rows
    .map((r, i) => ({ r, i, s: score(r) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.r);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Keyboard: which row is selected after an arrow key, wrapping at the ends.
export function moveSelection(current, delta, count) {
  if (!count) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}
