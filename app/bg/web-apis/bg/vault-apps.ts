// Reader subscriptions and Notes, for nomad://reader and nomad://notes (ADR-0017). Exposed on the
// internal nomad.vault API (vault.ts).
//
// Both live in the Vault (record layout: shared/vault-apps.mjs), so every linked Device, the phone
// too, reads and writes the same data. The first write makes a Vault if this Device has none. The
// Device can still join another Vault later, and brings this data along (hyper/vault.js adoptVault).
//
// Subscriptions belong to a Space. `ctx` is the RPC event: it names the calling page, and so its
// Space. The first read of a Space's subscriptions copies in the file the Reader kept in that
// Space's private drive before, once; a marker stops a feed the user then drops from coming back.

import { EventEmitter } from 'events';
import * as vault from '../../hyper/vault';
import * as filesystem from '../../filesystem/index';
import * as drives from '../../hyper/drives';
import * as spacesDb from '../../dbs/spaces';
import * as logLib from '../../logger';
import fsAPI from './fs';
import * as apps from '../../../../shared/vault-apps.mjs';
import * as nt from '../../../../shared/note-topics.mjs';
import { findWebContentsParentWindow } from '../../lib/electron';
import * as tabManager from '../../ui/tabs/manager';
import * as spaceLibrary from '../../hyper/space-library';
import * as readerArticles from './reader-articles';
import * as webFeeds from './web-feeds';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'vault-apps' });

// Where the Reader kept a Space's data before ADR-0017.
const LEGACY_FOLLOWS = 'hyper://private/.data/walled.garden/follows.json';
const LEGACY_READ = 'hyper://private/.data/reader/read-state.json';

// The caller's Space, by its Root Drive key. A page in a tab names its tab's Space; the shell window
// (its URL bar, the AI Sidebar) names the Space its window shows.
export async function spaceKey(ctx): Promise<string> {
  let spaceId = ctx?.sender ? filesystem.getSpaceIdForWebContents(ctx.sender.id) : null;
  if (!spaceId && ctx?.sender) {
    const win = findWebContentsParentWindow(ctx.sender);
    if (win) spaceId = tabManager.getWindowActiveSpaceId(win);
  }
  const url = spaceId ? filesystem.getSpaceRootDriveUrl(spaceId) : null;
  const key = url ? await drives.fromURLToKey(url, true) : null;
  if (!apps.isSpaceKey(key)) throw new Error('This page has no Space');
  return key;
}

async function readLegacy(ctx, url) {
  try {
    // The Space drive's Draft Mode must not hide the published file.
    return JSON.parse(await fsAPI.readFile.call(ctx, url, { draft: false }));
  } catch {
    return null;
  }
}

const imported = new Map<string, Promise<void>>(); // Space key -> the copy, this run

function importLegacy(ctx, space) {
  if (!imported.has(space)) {
    const run = copyLegacy(ctx, space);
    imported.set(space, run);
    run.catch((err) => {
      imported.delete(space); // try again on the next read
      logger.warn('Could not copy the Reader’s old data into the Vault', { space, error: err?.message });
    });
  }
  return imported.get(space).catch(() => {});
}

async function copyLegacy(ctx, space) {
  if (await vault.readAppRecord(apps.importedPath(space))) return;
  const urls = (await readLegacy(ctx, LEGACY_FOLLOWS))?.urls || [];
  const read = (await readLegacy(ctx, LEGACY_READ))?.read || [];
  if (!urls.length && !read.length) return; // nothing to bring; don't make a Vault for it
  const store = await spaceLibrary.records(space, 'follows');
  const have = apps.followUrls(await store.list());
  const follows = apps.followUrls(urls.map((url) => ({ url })));
  if (store.writable) {
    for (const url of follows) {
      if (!have.includes(url)) await store.put(followFile(space, url), apps.followRecord(url));
    }
  }
  if (read.length) {
    const current = (await vault.readAppRecord(apps.readPath(space)))?.read || [];
    const all = [...new Set([...have, ...follows])];
    await vault.putAppRecord(apps.readPath(space), { read: apps.mergeReadState(current, read, all) });
  }
  await vault.putAppRecord(apps.importedPath(space), { importedAt: new Date().toISOString() });
  logger.info('Copied the Reader’s old data into the Vault', { space, follows: follows.length });
}

// What both apps show about where the data is: `writable` is false while a Device that just joined
// waits for the Vault (no Vault at all is writable: the first write makes one); `linked` is true
// once another Device shares the Vault.
export async function vaultInfo() {
  const sess = await vault.getVault();
  return { writable: !sess || !!sess.writable, linked: (await vault.otherDeviceCount()) > 0 };
}

// Reader
// =

// { follows: [feedUrl], read: [postUrl], articles, ai, writable, linked }, for the caller's Space.
// `articles` are the pages saved to Reader (reader-articles.ts), `ai` what the AI is doing with them.
export async function readerState(ctx) {
  const space = await spaceKey(ctx);
  await importLegacy(ctx, space);
  return {
    ...(await readerOf(space)),
    articles: await readerArticles.list(space),
    postTopics: await readerArticles.listPostTopics(space),
    ai: await readerArticles.aiState(space),
    ...(await vaultInfo()),
  };
}

// Saved articles (ADR-0033), in the caller's Space. Each returns the Reader's state, except
// readerArticle, which returns { article, text } for the reading view.
export async function saveArticle(ctx, url, { read = true }: { read?: boolean } = {}) {
  const space = await spaceKey(ctx);
  const article = await readerArticles.saveUrl(space, url, { session: ctx?.sender?.session, read });
  return { article, state: await readerState(ctx) };
}

export async function updateArticle(ctx, id, changes = {}) {
  await readerArticles.update(await spaceKey(ctx), id, changes);
  return readerState(ctx);
}

export async function deleteArticle(ctx, id) {
  await readerArticles.remove(await spaceKey(ctx), id);
  return readerState(ctx);
}

export async function suggestTopics(ctx, ids = null) {
  await readerArticles.suggestTopics(await spaceKey(ctx), ids);
  return readerState(ctx);
}

export async function readArticle(ctx, id) {
  const space = await spaceKey(ctx);
  const article = await readerArticles.get(space, id);
  if (!article) throw new Error('That article isn’t in Reader any more');
  return { article, text: await readerArticles.getText(space, id) };
}

// What the box in Reader does with a link (ADR-0033): a drive's address or an RSS/Atom feed is
// followed; a web page is saved as an article, with the feeds it links to so Reader can offer them.
// Returns { followed?, article?, feeds?, state }.
export async function addLink(ctx, url) {
  const space = await spaceKey(ctx);
  if (apps.driveRoot(url)) {
    await followIn(space, url);
    return { followed: apps.driveRoot(url), state: await readerState(ctx) };
  }
  const page = apps.webFeedUrl(url);
  if (!page) throw new Error('Enter a web address, an RSS feed, or a hyper:// drive');
  const session = ctx?.sender?.session;
  const found = await webFeeds.probe(page, session);
  // A feed, or a site's home page that links to one: follow it. Any other page is saved.
  const home = /^https?:\/\/[^/]+\/?$/i.test(page);
  const follow = found.kind === 'feed' ? found.url : home && found.kind === 'html' ? found.feeds[0]?.url : null;
  if (follow) {
    if (found.kind !== 'feed') await webFeeds.loadWebFeed(follow, { session }); // check it reads
    await followIn(space, follow);
    return { followed: apps.webFeedUrl(follow), state: await readerState(ctx) };
  }
  const article = await readerArticles.saveUrl(space, page, {
    session,
    fetched: { html: found.kind === 'html' ? found.html : '', finalUrl: found.finalUrl },
  });
  return { article, feeds: found.kind === 'html' ? found.feeds : [], state: await readerState(ctx) };
}

// An RSS or Atom feed the caller's Space follows: { url, title, siteUrl, posts }.
export async function webFeed(ctx, url, { fresh = false } = {}) {
  const { follows } = await readerOf(await spaceKey(ctx));
  const key = apps.webFeedUrl(url);
  if (!key || !follows.includes(key)) throw new Error('This Space doesn’t follow that feed');
  return webFeeds.loadWebFeed(key, { session: ctx?.sender?.session, fresh });
}

// Feed posts the Reader loaded, for the AI to sort into topics; `urls` asks again for those.
export async function tagPosts(ctx, posts = [], urls = null) {
  await readerArticles.tagPosts(await spaceKey(ctx), posts, { urls });
  return readerState(ctx);
}

export async function setPostTopics(ctx, url, topics) {
  await readerArticles.setPostTopics(await spaceKey(ctx), url, topics);
  return readerState(ctx);
}

// Load the page again and keep its readable text, for an article saved without any.
export async function refetchArticle(ctx, id) {
  const space = await spaceKey(ctx);
  const article = await readerArticles.get(space, id);
  if (!article) throw new Error('That article isn’t in Reader any more');
  await readerArticles.saveUrl(space, article.url, {
    session: ctx?.sender?.session,
    read: !!article.readAt,
  });
  return readArticle(ctx, id);
}

export async function follow(ctx, url) {
  await followIn(await spaceKey(ctx), url);
  return readerState(ctx);
}

export async function unfollow(ctx, url) {
  await unfollowIn(await spaceKey(ctx), url);
  return readerState(ctx);
}

// Mark posts read. `loaded` maps each feed that just loaded to its post URLs, so marks for deleted
// posts are dropped (mergeReadState). Merges with what other Devices marked; never replaces it.
export async function saveRead(ctx, add = [], loaded = {}) {
  await saveReadIn(await spaceKey(ctx), add, loaded);
}

// The same, for a Space named by its key: the AI (ai-vault.ts) may run a turn for another Device,
// with no page here to name the Space.

// A follow record's file name under the Space's feeds. Throws for an address that isn't a feed.
function followFile(space, url) {
  const path = apps.followPath(space, url);
  return path.slice(apps.followsPrefix(space).length);
}

// { follows: [feedUrl], read: [postUrl], webRead, shared, canFollow }. A shared Space's feeds are
// in its Space Library (ADR-0029), so `canFollow` is false for a person who can only view it. Read
// marks are always the user's own, in the Vault: `read` for hyper:// posts, `webRead` ({ feedUrl:
// [itemUrl] }) for RSS and Atom items.
export async function readerOf(space) {
  const store = await spaceLibrary.records(space, 'follows');
  return {
    follows: apps.followUrls(await store.list()),
    read: (await vault.readAppRecord(apps.readPath(space)))?.read || [],
    webRead: (await vault.readAppRecord(apps.webReadPath(space)))?.read || {},
    shared: store.shared,
    canFollow: store.writable,
  };
}

export async function followIn(space, url) {
  const name = followFile(space, url); // throws for a non-hyper address
  const store = await spaceLibrary.records(space, 'follows');
  if (!(await store.get(name))) await store.put(name, apps.followRecord(url));
}

export async function unfollowIn(space, url) {
  if (!apps.feedUrl(url)) return;
  await (await spaceLibrary.records(space, 'follows')).del(followFile(space, url));
}

// Marks for hyper:// posts go to read.json; RSS and Atom items to web-read.json, under the feed in
// `loaded` that lists them.
export async function saveReadIn(space, add = [], loaded = {}) {
  const { follows, read, webRead } = await readerOf(space);
  const next = apps.mergeReadState(read, add, follows, loaded);
  if (!(next.length === read.length && next.every((u, i) => u === read[i]))) {
    await vault.putAppRecord(apps.readPath(space), { read: next });
  }
  if (!follows.some(apps.isWebFeed)) return;
  const web = apps.mergeWebRead(webRead, add, follows, loaded);
  if (JSON.stringify(web) !== JSON.stringify(webRead)) await vault.putAppRecord(apps.webReadPath(space), { read: web });
}

// Notes
// =
// A Note is the user's (every Space) or one Space's (ADR-0029). Each Note we hand out carries
// `space`: the Space's key, or null for the user's. It isn't stored: the path says where it is.

const withSpace = (space) => (note) => ({ ...note, space: space || null });
const stored = ({ space, ...note }: any) => note;

// A Space's Notes are in its Space Library when it is shared (ADR-0029), else in the Vault. The
// user's own are always in the Vault.
function noteFile(id) {
  apps.notePath(id); // validates the id
  return id + '.json';
}

export async function notesIn(space = null) {
  const list = space ? await (await spaceLibrary.records(space, 'notes')).list() : await vault.listAppRecords(apps.notesPrefix());
  return list.filter(apps.isNote).map(withSpace(space));
}

export async function getNote(space, id) {
  return space ? (await spaceLibrary.records(space, 'notes')).get(noteFile(id)) : vault.readAppRecord(apps.notePath(id));
}

export async function putNote(space, note) {
  if (space) return (await spaceLibrary.records(space, 'notes')).put(noteFile(note.id), note);
  return vault.putAppRecord(apps.notePath(note.id), note);
}

async function delNote(space, id) {
  if (space) return (await spaceLibrary.records(space, 'notes')).del(noteFile(id));
  return vault.delAppRecord(apps.notePath(id));
}

// The Notes a Space sees, newest first: the user's, and the Space's own when `space` is given.
export async function allNotes(space = null) {
  return apps.sortNotes([...(await notesIn(null)), ...(space ? await notesIn(space) : [])]);
}

// Every Space this Device knows, by Root Drive key: where Space-only Notes can be.
export async function knownSpaceKeys(): Promise<string[]> {
  const out = [];
  for (const sp of spacesDb.getCachedAll()) {
    if (!sp.root_drive_url) continue;
    const key = await Promise.resolve()
      .then(() => drives.fromURLToKey(sp.root_drive_url, true))
      .catch(() => null);
    if (apps.isSpaceKey(key) && !out.includes(key)) out.push(key);
  }
  return out;
}

// The caller's Space key, or null when it has none (a page outside any tab).
async function spaceOrNull(ctx) {
  return spaceKey(ctx).catch(() => null);
}

// Where the Note `id` is stored: { space, prev }, looking in the user's Notes, then the Space's.
async function findStored(id, space) {
  const own = await vault.readAppRecord(apps.notePath(id));
  if (own) return { space: null, prev: own };
  if (space) {
    const theirs = await getNote(space, id);
    if (theirs) return { space, prev: theirs };
  }
  return { space: null, prev: null };
}

// { notes: [note], space, spaceName, writable, linked }, newest first. `space` is the caller's
// Space key (null outside a Space), and `spaceName` its name, for the Notes page's sections.
// In a shared Space, `shared` is true, `canWriteSpace` says whether this person can write its Notes,
// and `members` how many people see them.
export async function listNotes(ctx = null) {
  const space = await spaceOrNull(ctx);
  const share = space ? await spaceLibrary.info(space).catch(() => ({ shared: false })) : { shared: false };
  const store = share.shared ? await spaceLibrary.records(space, 'notes') : null;
  const members = share.shared ? (await spaceLibrary.members(space).catch(() => [])).length : 0;
  return {
    notes: await allNotes(space),
    space,
    spaceName: spaceNameOf(space),
    shared: !!share.shared,
    canWriteSpace: store ? store.writable : true,
    members,
    ...(await vaultInfo()),
  };
}

export function spaceNameOf(space) {
  if (!space) return null;
  const s = spacesDb.getCachedAll().find((sp) => {
    try {
      return sp.root_drive_url && drives.fromURLToKey(sp.root_drive_url) === space;
    } catch {
      return false;
    }
  });
  return s?.name || null;
}

// A viewer of a shared Space can't add to its Notes (ADR-0029).
export async function canWriteNotesIn(space) {
  return (await spaceLibrary.records(space, 'notes').catch(() => ({ writable: false }))).writable;
}

// Create (no id) or update a Note, and return the stored Note. `baseUpdatedAt` is the updatedAt of
// the version the editor started from. If another Device saved the Note since then, this edit is
// kept as a new Note, a conflict copy, and that copy is returned (its id differs, conflictOf names
// the original). A new Note is the caller's Space's when `inSpace` is true and the user can write
// the Space's Notes (not a viewer of a shared Space), else the user's; an existing one stays where
// it is, and so does its conflict copy. `space` names the Space for a caller with no page (the AI
// on another Device's turn).
export async function saveNote(
  ctx,
  { id, body, baseUpdatedAt, inSpace = false, space = undefined }: { id?: string; body?: string; baseUpdatedAt?: string; inSpace?: boolean; space?: string | null } = {}
) {
  const callerSpace = space === undefined ? await spaceOrNull(ctx) : apps.isSpaceKey(space) ? space : null;
  const found = id ? await findStored(id, callerSpace) : { space: null, prev: null };
  const where = found.prev ? found.space : inSpace && callerSpace && (await canWriteNotesIn(callerSpace)) ? callerSpace : null;
  const { note, write } = apps.planNoteSave({ id, body, baseUpdatedAt }, found.prev);
  if (write) await putNote(where, note);
  if (note.conflictOf && note.conflictOf === id) logger.info('Saved a note conflict copy', { id, copy: note.id });
  return withSpace(where)(note);
}

export async function deleteNote(ctx, id) {
  const { space, prev } = await findStored(id, await spaceOrNull(ctx)); // notePath validates the id
  if (prev) await delNote(space, id);
}

// Move a Note into the caller's Space (`inSpace` true) or out to the user's Notes. Returns it.
export async function moveNote(ctx, { id, inSpace }: { id?: string; inSpace?: boolean } = {}) {
  const callerSpace = await spaceOrNull(ctx);
  const { space, prev } = await findStored(id, callerSpace);
  if (!prev) throw new Error('No note with that id');
  const to = inSpace ? callerSpace : null;
  if (inSpace && !to) throw new Error('This page has no Space');
  if (to === space) return withSpace(space)(prev);
  await putNote(to, prev);
  await delNote(space, id);
  logger.info('Moved a note', { id, toSpace: !!to });
  return withSpace(to)(prev);
}

// Set a Note's topics by hand (ADR-0035): the AI leaves them alone after this. Doesn't change its
// updatedAt, so an edit on another Device isn't taken for a conflict. Returns the Note.
// `space` names the Space for a caller with no page (the AI on another Device's turn).
export async function setNoteTopics(
  ctx,
  { id, topics, space: given = undefined }: { id?: string; topics?: string[] | string; space?: string | null } = {}
) {
  const space = given === undefined ? await spaceOrNull(ctx) : apps.isSpaceKey(given) ? given : null;
  const found = await findStored(id, space); // notePath validates the id
  if (!found.prev) throw new Error('No note with that id');
  if (found.space && !(await canWriteNotesIn(found.space))) throw new Error('You can only view this Space’s notes');
  const note = nt.withNoteTopics(found.prev, topics, 'user', nt.knownNoteTopics(await allNotes(space)));
  await putNote(found.space, note);
  return withSpace(found.space)(note);
}

// A Note's title changed from `from` to `to` (the editor tells us when the user leaves the Note).
// Point every other Note's links at the new title, as Obsidian does on a rename. Returns how many
// Notes changed. Covers the Notes the caller's Space sees: the user's and the Space's.
export async function renameNoteLinks(ctx, { id, from, to }: { id?: string; from?: string; to?: string } = {}) {
  const changes = apps.linkRenames(await allNotes(await spaceOrNull(ctx)), id, from, to);
  for (const { note, body } of changes) {
    await putNote(note.space, apps.makeNote({ id: note.id, body }, stored(note)));
  }
  if (changes.length) logger.info('Renamed note links', { id, notes: changes.length });
  return changes.length;
}

// Emits 'changed' when the Vault changes, on this Device or another, so an open Reader or Notes
// page can reload. Follows this Device onto another Vault, and onto the first one it makes.
export function watch() {
  const emitter: any = new EventEmitter();
  let base = null;
  let timer = null;
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(() => emitter.emit('changed', {}), 400); // one event for a burst of updates
  };
  const attach = () => {
    vault
      .getVault()
      .then((sess) => {
        if (!sess || emitter.closed || sess.base === base) return;
        if (base) base.removeListener('update', changed);
        base = sess.base;
        base.on('update', changed);
      })
      .catch(() => {});
  };
  const onSwitch = () => {
    attach();
    changed();
  };
  vault.events.on('changed', onSwitch);
  // A shared Space's Notes and feeds are in its Space Library (ADR-0029).
  spaceLibrary.events.on('changed', changed);
  // The AI started or finished picking a saved article's topics.
  readerArticles.events.on('changed', changed);
  attach();
  emitter.close = () => {
    emitter.closed = true;
    clearTimeout(timer);
    vault.events.removeListener('changed', onSwitch);
    spaceLibrary.events.removeListener('changed', changed);
    readerArticles.events.removeListener('changed', changed);
    if (base) base.removeListener('update', changed);
  };
  return emitter;
}
