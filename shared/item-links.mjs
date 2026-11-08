// Links to the user's things in Nomad: a Note, a Job, a Mod, an Asset, the AI's memory, Reader. The AI's tools
// return these as `url` (bg/ai/vault-tools.mjs, bg/web-apis/bg/ai-vault.ts), the AI puts them in its
// answer as Markdown links, and the AI Sidebar (fg/shell-window/ai-sidebar.js) and the phone's AI
// panel (mobile/components/AiPanel.tsx, through mobile/lib/itemLinks.ts) open them.
//
// A link in an answer is text the model wrote, and a page or a tool result can put words in its
// mouth. So a nomad:// link opens only when it is one of the pages below, and it opens as the URL
// this file builds, never as written: a query such as nomad://reader/?subscribe=… changes something
// when the page loads, and that must never be one click on an AI's answer. Web and hyper:// pages
// open as they are. Anything else is not a link.
//
// mobile/lib/itemLinks.ts is a copy of parseItemLink for the phone's bundle; tests/unit/item-links.test.js
// checks that the two agree.
//
// No Electron imports.

// Note, Job, Mod and memory ids (shared/vault-apps.mjs isNoteId, shared/jobs.mjs, shared/mods.mjs,
// shared/ai-memory.mjs): all are lowercase letters, digits and dashes.
const ID = /^[a-z0-9-]{1,40}$/;

export const noteLink = (id) => `nomad://notes/${id}`;
export const jobLink = (id) => `nomad://library/jobs?id=${id}`;
export const modLink = (id) => `nomad://library/mods?id=${id}`;
export const MEMORY_LINK = 'nomad://ai/memory';
export const READER_LINK = 'nomad://reader/';
export const CALENDAR_LINK = 'nomad://calendar/';
export const calendarLink = (day) => `${CALENDAR_LINK}?day=${day}`;
export const CONTACTS_LINK = 'nomad://library/contacts';
export const ASSETS_LINK = 'nomad://assets/';
export const assetLink = (id) => `${ASSETS_LINK}?id=${id}`;
// shared/assets.mjs isAssetId
const ASSET_ID = /^[ap][a-z0-9]{6,14}-[a-z0-9]{4,10}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The nomad:// pages a link may open, with where they are in words (for a device that can't open them).
const AI_VIEWS = { chats: 'Chats', memory: 'Memory', skills: 'Skills', setup: 'Setup' };
const LIBRARY_VIEWS = {
  drives: 'Drives',
  bookmarks: 'Bookmarks',
  contacts: 'Contacts',
  names: 'Names',
  mods: 'Mods',
  jobs: 'Jobs',
  secrets: 'Secrets',
  sharing: 'Sharing',
};

/**
 * What a link in an AI answer opens, or null when it isn't one to open.
 *   { kind: 'page', url }                         a web or hyper:// page
 *   { kind: 'note', id?, url, place }             nomad://notes, or one Note
 *   { kind: 'job', id?, url, place }              My Library → Jobs, or one Job
 *   { kind: 'mod', id?, url, place }              My Library → Mods, or one Mod
 *   { kind: 'library', view, url, place }         another My Library view
 *   { kind: 'ai', view, url, place }              the AI page: chats, memory, skills, setup
 *   { kind: 'reader', url, place }                nomad://reader
 *   { kind: 'calendar', day?, url, place }        nomad://calendar, or one day of it
 *   { kind: 'asset', id?, url, place }            nomad://assets, or one file there
 * `url` is the one to open. `place` says where it is, e.g. "My Library → Mods".
 * @param {string} href
 * @returns {null | { kind: string, url: string, id?: string, view?: string, day?: string, place?: string }}
 */
export function parseItemLink(href) {
  const s = String(href || '').trim();
  // No URL class: the phone's copy runs where URL is only partly there.
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#\s]*)([^?#\s]*)(\?[^#\s]*)?(#\S*)?$/i.exec(s);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const host = m[2].toLowerCase();
  if (!host || host.includes('@')) return null;
  if (scheme === 'http' || scheme === 'https' || scheme === 'hyper')
    return { kind: 'page', url: s };
  if (scheme !== 'nomad') return null;
  // nomad://notes/<id>: the host names the app, the path the item.
  let seg;
  try {
    seg = m[3]
      .split('/')
      .filter(Boolean)
      .map((p) => decodeURIComponent(p));
  } catch {
    return null;
  }
  const idMatch = /[?&]id=([^&]*)/.exec(m[4] || '');
  const id = idMatch ? idMatch[1] : null;
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  if (host === 'notes') {
    if (!seg.length) return { kind: 'note', url: 'nomad://notes/', place: 'Notes' };
    if (seg.length === 1 && ID.test(seg[0]))
      return { kind: 'note', id: seg[0], url: noteLink(seg[0]), place: 'Notes' };
    return null;
  }
  if (host === 'reader') {
    return seg.length ? null : { kind: 'reader', url: READER_LINK, place: 'Reader' };
  }
  if (host === 'calendar') {
    if (seg.length) return null;
    const day = /[?&]day=([^&]*)/.exec(m[4] || '')?.[1];
    if (day && DAY.test(day)) return { kind: 'calendar', day, url: calendarLink(day), place: 'Calendar' };
    return { kind: 'calendar', url: CALENDAR_LINK, place: 'Calendar' };
  }
  if (host === 'assets') {
    if (seg.length) return null;
    if (id && ASSET_ID.test(id)) return { kind: 'asset', id, url: assetLink(id), place: 'Assets' };
    return { kind: 'asset', url: ASSETS_LINK, place: 'Assets' };
  }
  if (host === 'ai') {
    const view = seg[0] || 'chats';
    if (seg.length > 1 || !has(AI_VIEWS, view)) return null;
    return {
      kind: 'ai',
      view,
      url: `nomad://ai/${view}`,
      place: `the AI page → ${AI_VIEWS[view]}`,
    };
  }
  if (host === 'library') {
    const view = seg[0] || 'drives';
    if (seg.length > 1 || !has(LIBRARY_VIEWS, view)) return null;
    const place = `My Library → ${LIBRARY_VIEWS[view]}`;
    if (view === 'jobs' || view === 'mods') {
      const kind = view === 'jobs' ? 'job' : 'mod';
      if (id && ID.test(id))
        return { kind, id, url: kind === 'job' ? jobLink(id) : modLink(id), place };
      return { kind, url: `nomad://library/${view}`, place };
    }
    return { kind: 'library', view, url: `nomad://library/${view}`, place };
  }
  return null;
}
