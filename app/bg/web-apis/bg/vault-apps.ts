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
import * as logLib from '../../logger';
import fsAPI from './fs';
import * as apps from '../../../../shared/vault-apps.mjs';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'vault-apps' });

// Where the Reader kept a Space's data before ADR-0017.
const LEGACY_FOLLOWS = 'hyper://private/.data/walled.garden/follows.json';
const LEGACY_READ = 'hyper://private/.data/reader/read-state.json';

async function spaceKey(ctx): Promise<string> {
  const spaceId = ctx?.sender ? filesystem.getSpaceIdForWebContents(ctx.sender.id) : null;
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
  const have = apps.followUrls(await vault.listAppRecords(apps.followsPrefix(space)));
  const follows = apps.followUrls(urls.map((url) => ({ url })));
  for (const url of follows) {
    if (!have.includes(url)) await vault.putAppRecord(apps.followPath(space, url), apps.followRecord(url));
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
async function vaultInfo() {
  const sess = await vault.getVault();
  return { writable: !sess || !!sess.writable, linked: (await vault.otherDeviceCount()) > 0 };
}

// Reader
// =

// { follows: [feedUrl], read: [postUrl], writable, linked }, for the caller's Space.
export async function readerState(ctx) {
  const space = await spaceKey(ctx);
  await importLegacy(ctx, space);
  return {
    follows: apps.followUrls(await vault.listAppRecords(apps.followsPrefix(space))),
    read: (await vault.readAppRecord(apps.readPath(space)))?.read || [],
    ...(await vaultInfo()),
  };
}

export async function follow(ctx, url) {
  const space = await spaceKey(ctx);
  const path = apps.followPath(space, url); // throws for a non-hyper address
  if (!(await vault.readAppRecord(path))) await vault.putAppRecord(path, apps.followRecord(url));
  return readerState(ctx);
}

export async function unfollow(ctx, url) {
  const space = await spaceKey(ctx);
  if (apps.driveRoot(url)) await vault.delAppRecord(apps.followPath(space, url));
  return readerState(ctx);
}

// Mark posts read. `loaded` maps each feed that just loaded to its post URLs, so marks for deleted
// posts are dropped (mergeReadState). Merges with what other Devices marked; never replaces it.
export async function saveRead(ctx, add = [], loaded = {}) {
  const space = await spaceKey(ctx);
  const { follows, read } = await readerState(ctx);
  const next = apps.mergeReadState(read, add, follows, loaded);
  if (next.length === read.length && next.every((u, i) => u === read[i])) return;
  await vault.putAppRecord(apps.readPath(space), { read: next });
}

// Notes
// =

async function allNotes() {
  return apps.sortNotes((await vault.listAppRecords(apps.NOTES_PREFIX)).filter(apps.isNote));
}

// { notes: [note], writable, linked }, newest first.
export async function listNotes() {
  return { notes: await allNotes(), ...(await vaultInfo()) };
}

// Create (no id) or update a Note, and return the stored Note. `baseUpdatedAt` is the updatedAt of
// the version the editor started from. If another Device saved the Note since then, this edit is
// kept as a new Note, a conflict copy, and that copy is returned (its id differs, conflictOf names
// the original).
export async function saveNote(_ctx, { id, body, baseUpdatedAt }: { id?: string; body?: string; baseUpdatedAt?: string } = {}) {
  const prev = id ? await vault.readAppRecord(apps.notePath(id)) : null;
  const { note, write } = apps.planNoteSave({ id, body, baseUpdatedAt }, prev);
  if (write) await vault.putAppRecord(apps.notePath(note.id), note);
  if (note.conflictOf && note.conflictOf === id) logger.info('Saved a note conflict copy', { id, copy: note.id });
  return note;
}

export async function deleteNote(_ctx, id) {
  await vault.delAppRecord(apps.notePath(id)); // notePath validates the id
}

// A Note's title changed from `from` to `to` (the editor tells us when the user leaves the Note).
// Point every other Note's links at the new title, as Obsidian does on a rename. Returns how many
// Notes changed.
export async function renameNoteLinks(_ctx, { id, from, to }: { id?: string; from?: string; to?: string } = {}) {
  const changes = apps.linkRenames(await allNotes(), id, from, to);
  for (const { note, body } of changes) {
    await vault.putAppRecord(apps.notePath(note.id), apps.makeNote({ id: note.id, body }, note));
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
  attach();
  emitter.close = () => {
    emitter.closed = true;
    clearTimeout(timer);
    vault.events.removeListener('changed', onSwitch);
    if (base) base.removeListener('update', changed);
  };
  return emitter;
}
