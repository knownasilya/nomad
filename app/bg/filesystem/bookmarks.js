// @ts-nocheck
import b4a from 'b4a';
import { joinPath } from '../../lib/strings';
import { normalizeUrl, createResourceSlug } from '../../lib/urls';
import * as autobases from '../hyper/autobases';
import * as filesystem from './index';
import * as pinsAPI from './pins';
import { URL } from 'url';
import * as profileDb from '../dbs/profile-data-db';

// Bookmarks live in the private drive (an Autobase; ADR-0010) as JSON file BODIES —
// `/bookmarks/<slug>.goto` (or `.json`) with `{ href, title }` — NOT Hyperdrive entry metadata
// (which no longer round-trips). We read both `.goto` and `.json` so mobile-written bookmarks
// (`/bookmarks/<hash>.json`) are visible here too (see docs/multi-device-protocol.md §5).

// exported
// =

export async function list() {
  var sess = filesystem.get();
  var pins = await pinsAPI.getCurrent();
  var out = [];
  for (const { path, record } of await autobases.listRecords(sess, '/bookmarks/')) {
    if (!(path.endsWith('.goto') || path.endsWith('.json'))) continue;
    let data;
    try {
      const buf = await autobases.resolveRecordContent(record);
      data = buf ? JSON.parse(b4a.toString(buf)) : null;
    } catch { data = null; }
    if (!data || !data.href) continue;
    out.push(massageBookmark({ url: joinPath(sess.url, path), href: data.href, title: data.title }, pins));
  }
  return out;
}

export async function get(href) {
  href = normalizeUrl(href);
  var bookmarks = await list();
  return bookmarks.find((b) => b.href === href);
}

export async function add({ href, title, pinned }) {
  href = normalizeUrl(href);
  var sess = filesystem.get();

  let existing = await get(href);
  if (existing) {
    if (typeof title === 'undefined') title = existing.title;
    if (typeof pinned === 'undefined') pinned = existing.pinned;

    let urlp = new URL(existing.bookmarkUrl);
    await autobases.putInline(sess, urlp.pathname, JSON.stringify({ href, title }));
    if (pinned !== existing.pinned) {
      if (pinned) await pinsAPI.add(href);
      else await pinsAPI.remove(href);
    }
    return;
  }

  // new bookmark — data in the JSON body
  var slug = createResourceSlug(href, title);
  var filename = await filesystem.getAvailableName('/bookmarks', slug, 'goto', sess);
  var path = joinPath('/bookmarks', filename);
  await autobases.putInline(sess, path, JSON.stringify({ href, title }));
  if (pinned) await pinsAPI.add(href);
  return path;
}

export async function remove(href) {
  let existing = await get(href);
  if (!existing) return;
  let urlp = new URL(existing.bookmarkUrl);
  await autobases.deletePath(filesystem.get(), urlp.pathname);
  if (existing.pinned) await pinsAPI.remove(existing.href);
}

export async function migrateBookmarksFromSqlite() {
  var bookmarks = await profileDb.all(`SELECT * FROM bookmarks`);
  for (let bookmark of bookmarks) {
    await add({ href: bookmark.url, title: bookmark.title, pinned: false });
  }
}

// internal
// =

function massageBookmark(result, pins) {
  let href = normalizeUrl(result.href) || '';
  return {
    bookmarkUrl: result.url,
    href,
    title: result.title || href || '',
    pinned: pins.includes(href),
  };
}
