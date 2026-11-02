// @ts-nocheck
//
// Personas and Sessions (ADR-0031). A Persona is one of the user's identities: a private label that
// points at a Profile Drive (`walled.garden/person`). A Session is the login a site holds after the
// user said yes in the login prompt. Records live in the Vault (shared/personas.mjs), so the user's
// other Devices have them; this module keeps them in memory, as mods.js does, so the permission
// engine and the shell can ask without waiting.
//
// Who calls in:
//   - nomad.personas (web-apis/bg/personas.ts): My Library → Personas, site-info. nomad:// only.
//   - nomad.session (web-apis/bg/session.ts): a page's requestLogin/getCurrent/revoke.
//   - the permission engine (ui/permissions.js): a live Session's tokens count as granted.
//   - the shell: the Persona on the Spaces button, the location-bar icon (tabs/manager.js, pane.js).

import crypto from 'crypto';
import { dialog, BrowserWindow } from 'electron';
import { findWebContentsParentWindow } from '../lib/electron';
import { UserDeniedError } from 'beaker-error-constants';
import { EventEmitter } from 'events';
import b4a from 'b4a';
import * as vault from '../hyper/vault';
import * as autobases from '../hyper/autobases';
import * as filesystem from '../filesystem/index';
import * as spacesDb from '../dbs/spaces';
import * as archivesDb from '../dbs/archives';
import * as logLib from '../logger';
import * as P from '../../../shared/personas.mjs';
import { WRITERS_PREFIX } from '../../../shared/fs-core.mjs';

const logger = logLib.get().child({ category: 'browser', subcategory: 'personas' });

const LOAD_TIMEOUT = 8000;
const THUMB_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MAX_THUMB = 2 * 1024 * 1024;

// Emits 'changed' when a Persona, the default, a Space's Persona or a Session changes, here or on
// another Device, and when a Profile Drive's check finishes.
export const events = new EventEmitter();

let personas = new Map(); // id -> record
let defaultId = null;
let overrides = new Map(); // Space key -> Persona id
let sessions = new Map(); // path -> record
let profiles = new Map(); // Persona id -> { title, description, thumb, writable, state, reason, foreign? }
let hasVault = false;
let vaultReady = false;
let deviceKeys = [];
let watchedBase = null;
let timer = null;
let lastStamp = '';
/** @type {Promise<any>} */
let writes = Promise.resolve();

export function setup() {
  refresh();
  vault.events.on('changed', () => refresh());
  // Sessions the page asked to expire: drop them from the Vault once they have.
  setInterval(() => sweepExpired().catch(() => {}), 60 * 1000).unref?.();
}

function scheduleRefresh() {
  clearTimeout(timer);
  timer = setTimeout(refresh, 300);
}

export async function refresh() {
  let sess = null;
  try {
    sess = await vault.getVault();
  } catch {
    sess = null;
  }
  if (sess && sess.base !== watchedBase) {
    if (watchedBase) watchedBase.removeListener('update', scheduleRefresh);
    watchedBase = sess.base;
    watchedBase.on('update', scheduleRefresh);
  }
  hasVault = !!sess;
  vaultReady = !!sess?.writable;
  if (!sess) {
    apply([], null, [], [], []);
    return;
  }
  const [recs, def, spaces, sess2, devices] = await Promise.all([
    vault.listAppRecords(P.PERSONAS_PREFIX),
    vault.readAppRecord(P.DEFAULT_PATH),
    vault.listSpaces(),
    vault.listAppRecords(P.SESSIONS_PREFIX),
    vault.listDevices(),
  ]).catch(() => [[], null, [], [], []]);
  apply(recs, def, spaces, sess2, devices);
}

function apply(recs, def, spaces, sessRecs, devices) {
  const nextPersonas = new Map(recs.filter(P.isPersona).map((r) => [r.id, r]));
  const nextDefault = def && def.type === P.DEFAULT_TYPE ? def.personaId || null : null;
  const nextOverrides = new Map(
    spaces
      .filter((s) => s && s.rootDriveKey && !s.movedTo && s.persona)
      .map((s) => [s.rootDriveKey, s.persona])
  );
  const nextSessions = new Map(
    sessRecs
      .filter(P.isSession)
      .map((r) => [P.sessionPath(r.space, r.personaId, hashOrigin(r.origin)), r])
  );
  deviceKeys = devices.map((d) => d && d.key).filter(Boolean);
  const stamp = JSON.stringify([
    [...nextPersonas.values()].map((p) => [p.id, p.updatedAt]),
    nextDefault,
    [...nextOverrides],
    [...nextSessions.values()].map((s) => [s.space, s.personaId, s.origin, s.id, s.perms]),
    vaultReady,
    deviceKeys,
  ]);
  if (stamp === lastStamp) return;
  lastStamp = stamp;
  personas = nextPersonas;
  defaultId = nextDefault;
  overrides = nextOverrides;
  sessions = nextSessions;
  for (const id of profiles.keys()) if (!personas.has(id)) profiles.delete(id);
  events.emit('changed');
  // Check each Profile Drive again: a writer may have been added since.
  checkAll().catch(() => {});
}

// The Profile Drive check (ADR-0031 §5)
// =

async function withTimeout(p, ms) {
  let t;
  try {
    return await Promise.race([
      p,
      new Promise((resolve) => (t = setTimeout(() => resolve(null), ms))),
    ]);
  } finally {
    clearTimeout(t);
  }
}

async function writerKeys(sess) {
  await sess.base.update().catch(() => {});
  const out = [];
  for await (const node of sess.drive.createReadStream({
    gte: WRITERS_PREFIX,
    lt: WRITERS_PREFIX + '\xff',
  })) {
    const rec = node.value;
    if (!rec || rec.value == null) continue;
    try {
      const w = JSON.parse(b4a.toString(b4a.from(rec.value, 'base64')));
      if (w?.writerKey) out.push(w.writerKey);
    } catch {}
  }
  return out;
}

async function openProfile(url) {
  const key = P.driveKeyOf(url);
  if (!key) return null;
  return withTimeout(
    autobases.getOrLoadCollaborativeDrive(key).catch(() => null),
    LOAD_TIMEOUT
  );
}

// Read a Persona's Profile Drive and check its writers. Never throws.
export async function checkProfile(persona) {
  const prev = profiles.get(persona.id) || {};
  let info;
  try {
    const sess = await openProfile(persona.profileUrl);
    if (!sess) {
      info = { ...prev, ...P.profileState({ persona, vaultReady, loaded: false }) };
    } else {
      const manifest = await autobases.readJson(sess, '/index.json').catch(() => null);
      const writers = await writerKeys(sess).catch(() => null);
      info = {
        title: String(manifest?.title || ''),
        description: String(manifest?.description || ''),
        thumb: typeof manifest?.thumb === 'string' ? manifest.thumb : '',
        writable: !!sess.writable,
        ...P.profileState({ persona, vaultReady, deviceKeys, writers }),
      };
    }
  } catch (e) {
    info = {
      ...prev,
      state: 'not-ready',
      reason: 'This device couldn’t read the Persona’s profile drive.',
    };
  }
  const same = JSON.stringify(prev) === JSON.stringify(info);
  profiles.set(persona.id, info);
  if (!same) events.emit('changed');
  return info;
}

async function checkAll() {
  for (const p of personas.values()) await checkProfile(p);
}

function usable(p) {
  return profiles.get(p.id)?.state === 'usable';
}

// Spaces
// =

// A local Space id's Root Drive key, or null (a Space whose Root Drive isn't set up yet).
export function spaceKeyOf(spaceId) {
  const space = spacesDb.getCachedAll().find((s) => s.id === Number(spaceId));
  return space?.root_drive_url ? P.driveKeyOf(space.root_drive_url) : null;
}

function spaceIdOfKey(key) {
  const space = spacesDb
    .getCachedAll()
    .find((s) => s.root_drive_url && P.driveKeyOf(s.root_drive_url) === key);
  return space ? space.id : null;
}

// The Persona a Space uses now (§4), without the usable check: what the UI shows as picked, and whose
// Sessions a page in that Space sees.
export function personaForSpaceKey(key) {
  return P.resolvePersona({
    spaceOverride: key ? overrides.get(key) : null,
    defaultId,
    personas: [...personas.values()],
  });
}

export function personaForSpaceId(spaceId) {
  return personaForSpaceKey(spaceKeyOf(spaceId));
}

// For the Spaces button: the Space's Persona, with its picture, or null.
export function shellPersona(spaceId) {
  const key = spaceKeyOf(spaceId);
  const p = personaForSpaceKey(key);
  if (!p) return null;
  return { ...view(p), from: overrides.get(key) === p.id ? 'space' : 'default' };
}

// Records for the UI
// =

function thumbUrl(p, info) {
  if (!info?.thumb) return '';
  const path = info.thumb.startsWith('/') ? info.thumb : `/${info.thumb}`;
  return `${p.profileUrl.replace(/\/$/, '')}${path}`;
}

function view(p) {
  const info = profiles.get(p.id) || { state: 'not-ready', reason: 'Checking its profile drive…' };
  return {
    id: p.id,
    label: p.label,
    profileUrl: p.profileUrl,
    title: info.title || '',
    description: info.description || '',
    thumbUrl: thumbUrl(p, info),
    writable: !!info.writable,
    state: info.state,
    reason: info.reason || '',
    isDefault: p.id === defaultId,
    createdAt: p.createdAt,
  };
}

export function get(id) {
  return personas.get(id) || null;
}

// Everything My Library → Personas shows.
export function state() {
  const spaces = spacesDb.getCachedAll().map((s) => {
    const key = s.root_drive_url ? P.driveKeyOf(s.root_drive_url) : null;
    const resolved = personaForSpaceKey(key);
    return {
      id: s.id,
      name: s.name,
      color: s.color,
      key,
      personaId: key ? overrides.get(key) || null : null,
      resolvedId: resolved?.id || null,
    };
  });
  return {
    hasVault,
    vaultReady,
    defaultId,
    personas: P.sortPersonas([...personas.values()]).map((p) => ({
      ...view(p),
      sessions: [...sessions.values()].filter((s) => s.personaId === p.id).length,
    })),
    spaces,
  };
}

export function listSessions() {
  const spaceName = (key) =>
    spacesDb.getCachedAll().find((s) => s.root_drive_url && P.driveKeyOf(s.root_drive_url) === key)
      ?.name || 'A space not on this device';
  return P.sortSessions([...sessions.values()]).map((s) => ({
    path: P.sessionPath(s.space, s.personaId, hashOrigin(s.origin)),
    id: s.id,
    origin: s.origin,
    site: P.shortOrigin(s.origin),
    personaId: s.personaId,
    personaLabel: personas.get(s.personaId)?.label || 'A deleted Persona',
    space: s.space,
    spaceName: spaceName(s.space),
    perms: s.perms,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt || null,
    expired: P.isExpired(s),
  }));
}

// Writes
// =

function serial(fn) {
  const run = writes.then(fn);
  writes = run.catch(() => {});
  return run;
}

function hashOrigin(origin) {
  return crypto.createHash('sha256').update(P.originHashInput(origin)).digest('hex');
}

function parseThumb(dataUrl) {
  const m = /^data:([a-z/+-]+);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m || !THUMB_TYPES[m[1].toLowerCase()])
    throw new Error('Pick a PNG, JPEG, WebP or GIF picture');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_THUMB) throw new Error('Pick a picture under 2 MB');
  return { buf, ext: THUMB_TYPES[m[1].toLowerCase()] };
}

async function writeManifest(sess, patch) {
  const manifest = (await autobases.readJson(sess, '/index.json').catch(() => null)) || {};
  const next = { ...manifest, type: 'walled.garden/person', ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  await autobases.putInline(sess, '/index.json', JSON.stringify(next, null, 2));
  return next;
}

async function writeThumb(sess, dataUrl) {
  const { buf, ext } = parseThumb(dataUrl);
  const path = `/thumb.${ext}`;
  await autobases.writeFile(sess, path, buf);
  return path;
}

// A new Profile Drive with only /index.json (and a picture, when one is given), in the user's
// Hyperdrives list.
async function makeProfileDrive({ title, description, thumb }) {
  const meta = { type: 'walled.garden/person', title: String(title || '').slice(0, 280) };
  if (description) meta.description = String(description).slice(0, 1000);
  const sess = await autobases.createCollaborativeDrive(meta);
  if (thumb) {
    const path = await writeThumb(sess, thumb);
    await writeManifest(sess, { thumb: path });
  }
  await filesystem.configAutobaseDrive(sess.url, { tags: ['profile'] }).catch(() => {});
  await archivesDb
    .setMeta(sess.keyStr, { title: meta.title, type: 'autobase', writable: true })
    .catch(() => {});
  return sess;
}

// Make a Persona: a new Profile Drive, or one of the user's own (this Device made it and it has no
// other writers). The first Persona becomes the default.
export function create({ label, title, description, thumb, profileUrl } = {}) {
  return serial(async () => {
    const name = P.normalizeLabel(label);
    let url;
    let creator = null;
    if (profileUrl) {
      url = P.normalizeProfileUrl(profileUrl);
      const sess = await openProfile(url);
      if (!sess) throw new Error('That drive couldn’t be opened on this device');
      const manifest = await autobases.readJson(sess, '/index.json').catch(() => null);
      if (manifest?.type !== 'walled.garden/person')
        throw new Error(
          'That drive isn’t a profile (its index.json type isn’t walled.garden/person)'
        );
      const own =
        sess.writable &&
        sess.base?.local?.key &&
        b4a.toString(sess.base.local.key, 'hex') === sess.keyStr;
      if (!own) throw new Error('Only a profile drive made on this device can be a Persona');
      creator = sess.keyStr;
      const devices = (await vault.listDevices()).map((d) => d.key);
      const st = P.profileState({
        persona: { profileUrl: url, creator },
        vaultReady: true,
        deviceKeys: devices,
        writers: await writerKeys(sess),
      });
      if (st.state !== 'usable') throw new Error(st.reason);
    } else {
      const sess = await makeProfileDrive({
        title: String(title || name).trim() || name,
        description,
        thumb,
      });
      url = sess.url;
      creator = sess.keyStr;
    }
    const existing = await vault.listAppRecords(P.PERSONAS_PREFIX);
    const id = P.newPersonaId(crypto.randomBytes(10));
    const rec = P.makePersona({ id, label: name, profileUrl: url, creator });
    await vault.putAppRecord(P.personaPath(id), rec);
    if (
      !existing.filter(P.isPersona).length &&
      !(await vault.readAppRecord(P.DEFAULT_PATH))?.personaId
    ) {
      await vault.putAppRecord(P.DEFAULT_PATH, P.makeDefault(id));
    }
    logger.info('Made a Persona', { id });
    await refresh();
    await checkProfile(rec);
    return view(rec);
  });
}

// Rename a Persona, and change its profile (name, description, picture) where this Device can write
// the Profile Drive.
export function update(id, { label, title, description, thumb } = {}) {
  return serial(async () => {
    const prev = await vault.readAppRecord(P.personaPath(id));
    if (!P.isPersona(prev)) throw new Error('That Persona is gone');
    let rec = prev;
    if (label !== undefined && P.normalizeLabel(label) !== prev.label) {
      rec = P.makePersona({ label }, prev);
      await vault.putAppRecord(P.personaPath(id), rec);
    }
    if (title !== undefined || description !== undefined || thumb) {
      const sess = await openProfile(prev.profileUrl);
      if (!sess?.writable)
        throw new Error(
          'This device can’t change that profile. Change it on the device that made it.'
        );
      const patch = {};
      if (title !== undefined) patch.title = String(title).trim().slice(0, 280) || rec.label;
      if (description !== undefined)
        patch.description = String(description).trim().slice(0, 1000) || undefined;
      if (thumb) patch.thumb = await writeThumb(sess, thumb);
      await writeManifest(sess, patch);
      if (patch.title)
        await archivesDb
          .setMeta(sess.keyStr, { title: patch.title, type: 'autobase', writable: true })
          .catch(() => {});
    }
    await refresh();
    await checkProfile(rec);
    return view(rec);
  });
}

// Delete a Persona and its Sessions (each open page gets `change`). Spaces that named it fall back to
// the default; if it was the default there is none until the user picks one. The Profile Drive stays.
export function remove(id) {
  return serial(async () => {
    for (const path of await vault.listAppRecordPaths(P.SESSIONS_PREFIX)) {
      if (P.parseSessionPath(path)?.personaId === id) await vault.delAppRecord(path);
    }
    for (const s of await vault.listSpaces()) {
      if (s?.persona === id && s.rootDriveKey && !s.movedTo)
        await vault.putSpaceShare(s.rootDriveKey, { persona: undefined });
    }
    const def = await vault.readAppRecord(P.DEFAULT_PATH);
    if (def?.personaId === id) await vault.putAppRecord(P.DEFAULT_PATH, P.makeDefault(null));
    await vault.delAppRecord(P.personaPath(id));
    logger.info('Deleted a Persona', { id });
    await refresh();
  });
}

export function setDefault(id) {
  return serial(async () => {
    if (id && !P.isPersona(await vault.readAppRecord(P.personaPath(id))))
      throw new Error('That Persona is gone');
    await vault.putAppRecord(P.DEFAULT_PATH, P.makeDefault(id || null));
    await refresh();
  });
}

// Set a Space's own Persona, or clear it (null) so the Space uses the default. The Space's Vault
// record carries it, so it follows the user to their other Devices (and a Shared Space is bound per
// Member: the record is theirs, not the Space Library's).
export function setSpacePersona(spaceId, id) {
  return serial(async () => {
    const space = await spacesDb.get(Number(spaceId));
    if (!space) throw new Error('That Space is gone');
    if (!space.root_drive_url) await filesystem.getOrSetupSpaceDrive(space);
    const fresh = await spacesDb.get(Number(spaceId));
    const key = P.driveKeyOf(fresh.root_drive_url);
    if (!key) throw new Error('That Space isn’t ready yet');
    if (id && !P.isPersona(await vault.readAppRecord(P.personaPath(id))))
      throw new Error('That Persona is gone');
    // The record must exist: a Space made before the Vault isn't indexed yet.
    await vault.ensureVault();
    if (!(await vault.listSpaces()).some((s) => s.rootDriveKey === key && !s.movedTo))
      await vault.registerSpace(fresh, key);
    await vault.putSpaceShare(key, { persona: id || undefined });
    await refresh();
  });
}

// The Vault forgot a Space (the user left it): its Sessions go too. Its override went with its record.
export function forgetSpace(spaceKey) {
  return serial(async () => {
    for (const path of await vault.listAppRecordPaths(P.sessionsPrefix(spaceKey)))
      await vault.delAppRecord(path);
    await refresh();
  });
}

// Sessions
// =

// The live Session a page at `url` in Space `spaceId` has: the one for its Space's current Persona.
export function sessionFor(url, spaceId) {
  const origin = P.sessionOrigin(url);
  const key = spaceKeyOf(spaceId);
  if (!origin || !key) return null;
  const p = personaForSpaceKey(key);
  if (!p) return null;
  const s = sessions.get(P.sessionPath(key, p.id, hashOrigin(origin)));
  return s && !P.isExpired(s) ? s : null;
}

// Does the page's live Session grant this permission token? The permission engine's only question.
export function sessionGrants(url, spaceId, token) {
  return P.sessionGrants(sessionFor(url, spaceId), token);
}

// What a page sees of its Session (null when it has none).
export function sessionViewFor(url, spaceId) {
  const s = sessionFor(url, spaceId);
  if (!s) return null;
  const p = personas.get(s.personaId);
  const info = p ? profiles.get(p.id) : null;
  const profile = p
    ? { url: p.profileUrl, title: info?.title || p.label, thumb: info?.thumb || '' }
    : null;
  return P.sessionView(s, profile);
}

// For site-info and the location bar: who you are on this site, and what the Session can do.
export function siteSession(url, spaceId) {
  const s = sessionFor(url, spaceId);
  if (!s) return null;
  const p = personas.get(s.personaId);
  return {
    path: P.sessionPath(s.space, s.personaId, hashOrigin(s.origin)),
    origin: s.origin,
    perms: s.perms,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt || null,
    persona: p ? view(p) : null,
  };
}

// Make (or widen) the Session for this origin, Persona and Space. A Session already there keeps its id.
export function grant({ origin, spaceKey, personaId, perms, maxAge }) {
  return serial(async () => {
    const path = P.sessionPath(spaceKey, personaId, hashOrigin(origin));
    const prev = await vault.readAppRecord(path);
    const id =
      P.isSession(prev) && !P.isExpired(prev) ? prev.id : P.newSessionId(crypto.randomBytes(16));
    const rec = P.makeSession({ id, origin, personaId, space: spaceKey, perms, maxAge });
    await vault.putAppRecord(path, rec);
    await refresh();
    return rec;
  });
}

// End a Session by its path (My Library, site-info) or for a page (its revoke()).
export function endSession(path) {
  return serial(async () => {
    if (!P.parseSessionPath(path)) throw new Error('That isn’t a Session');
    if (await vault.readAppRecord(path)) await vault.delAppRecord(path);
    await refresh();
  });
}

export async function endSessionFor(url, spaceId) {
  const s = sessionFor(url, spaceId);
  if (s) await endSession(P.sessionPath(s.space, s.personaId, hashOrigin(s.origin)));
}

async function sweepExpired() {
  if (!vaultReady) return;
  const expired = [...sessions.entries()].filter(([, s]) => P.isExpired(s));
  if (!expired.length) return;
  await serial(async () => {
    for (const [path] of expired)
      if (await vault.readAppRecord(path)) await vault.delAppRecord(path);
  });
  await refresh();
}

// For the login prompt
// =

// The Personas to offer, each checked now (the writer check runs on every requestLogin), and the
// one the Space resolves to among the usable ones.
export async function loginChoices(spaceId) {
  const key = spaceKeyOf(spaceId);
  const list = P.sortPersonas([...personas.values()]);
  await Promise.all(list.map((p) => checkProfile(p)));
  const picked = P.resolvePersona({
    spaceOverride: key ? overrides.get(key) : null,
    defaultId,
    personas: list,
    usable,
  });
  return {
    spaceKey: key,
    personas: list.map(view),
    pickedId: picked?.id || null,
    vaultReady,
    hasVault,
  };
}

export function isUsable(id) {
  const p = personas.get(id);
  return !!p && usable(p);
}

// Adding a writer to a Persona's Profile Drive warns first (ADR-0031 §5): a writer that isn't one
// of the user's Devices stops the Persona logging in. Resolves when the user goes ahead; throws
// UserDeniedError when they don't. Does nothing for any other drive, or for one of their Devices.
export async function confirmProfileWriter(sender, url, writerKey) {
  const key = P.driveKeyOf(url);
  const p = key ? [...personas.values()].find((x) => P.driveKeyOf(x.profileUrl) === key) : null;
  if (!p) return;
  if (writerKey && deviceKeys.includes(String(writerKey).toLowerCase())) return;
  let win = null;
  try {
    win = (sender && findWebContentsParentWindow(sender)) || BrowserWindow.getFocusedWindow();
  } catch {}
  const opts = {
    type: 'warning',
    buttons: ['Cancel', 'Add a writer anyway'],
    defaultId: 0,
    cancelId: 0,
    message: `This is the drive for your Persona “${p.label}”.`,
    detail: 'Adding another writer means you can’t log in with it.',
  };
  const { response } = win
    ? await dialog.showMessageBox(win, opts)
    : await dialog.showMessageBox(opts);
  if (response !== 1) throw new UserDeniedError();
}

export { spaceIdOfKey };
