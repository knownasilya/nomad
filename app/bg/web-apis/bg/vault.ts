//
// Internal web API: nomad.vault — backs the Devices settings subpage. Available only to nomad://
// pages (internalOnly). Delegates to hyper/vault.js (the Vault primitive) and
// hyper/device-pairing.js (the blind-pairing handshake). See docs/multi-device-protocol.md.

import os from 'os';
import { app } from 'electron';
import b4a from 'b4a';
import { EventEmitter } from 'events';
import * as vault from '../../hyper/vault';
import * as pairing from '../../hyper/device-pairing';
import * as devicePresence from '../../hyper/device-presence';
import * as vaultApps from './vault-apps';
import * as noteTopics from './note-topics';
import * as calendar from './calendar';
import * as householdContacts from './household-contacts';
import * as assets from './assets';
import * as liveNotes from '../../notes/live-notes';
import * as names from '../../hyper/names';
import * as driveWriters from '../../hyper/drive-writers';
import * as spaceLibrary from '../../hyper/space-library';
import * as invites from '../../hyper/invites';
import * as filesystem from '../../filesystem/index';
import * as spacesDb from '../../dbs/spaces';
import { BrowserWindow } from 'electron';
import { findWebContentsParentWindow } from '../../lib/electron';
import * as tabManager from '../../ui/tabs/manager';
import * as spacePins from '../../ui/space-pins';
import * as homeLayout from '../../ui/home-layout';
import * as drives from '../../hyper/drives';
import * as home from '../../../../shared/home-setup.mjs';
import * as peerRules from '../../../../shared/peers.mjs';
import { isShared } from '../../../../shared/space-library.mjs';
import * as homeDash from '../../../../shared/home-dashboard.mjs';
import * as hl from '../../../../shared/home-layout.mjs';
import { localWallTime, isDateTime } from '../../../../shared/calendar.mjs';
import * as inbox from '../../hyper/inbox';
import * as autobases from '../../hyper/autobases';
import * as permissions from '../../ui/permissions';
import * as personas from '../../ui/personas';

// The Vault's Spaces a Peer can keep: not moved, not removed.
function liveSpaces(spaces) {
  return (spaces || []).filter((s) => s && !s.movedTo && !s.removed && peerRules.isKey(s.rootDriveKey));
}

// The user's shared Spaces on this Device other than `exceptId`, in Space switcher order, for the
// Sharing page's list: [{ id, name, color, icon, role, removed }]. Two Spaces can share a name (two
// "Home"s), so the page tells them apart by color and role, and opens one by id.
async function sharedSpacesExcept(exceptId) {
  const recs = await vault.listSpaces().catch(() => []);
  const byKey = new Map();
  for (const r of recs || []) if (r && !r.movedTo && isShared(r)) byKey.set(r.rootDriveKey, r);
  const out = [];
  for (const s of await spacesDb.list()) {
    if (s.id === exceptId || s.id === 1 || !s.root_drive_url) continue;
    let key = null;
    try {
      key = drives.fromURLToKey(s.root_drive_url);
    } catch {}
    const rec = key ? byKey.get(key) : null;
    if (!rec) continue;
    out.push({ id: s.id, name: s.name, color: s.color, icon: s.icon, role: rec.role || 'viewer', removed: !!rec.removed });
  }
  return out;
}

// The caller's Space key, or null.
const callerSpace = (ctx) => vaultApps.spaceKey(ctx).catch(() => null);
// A promise's value, or null when it fails or takes longer than `ms`.
// Requests to write to the user's drives (autobases.allPendingRequests), with each drive's title and
// the name on the asker's profile, when it can be read in time.
async function waitingDriveRequests() {
  return Promise.all(
    autobases.allPendingRequests().map(async (r) => {
      const sess = autobases.getCollaborativeDrive(r.drive);
      const [meta, profile]: any[] = await Promise.all([
        sess ? autobases.readJson(sess, '/index.json').catch(() => null) : null,
        r.profileUrl ? settle(personas.readProfileManifest(r.profileUrl), 2000) : null,
      ]);
      return { ...r, title: meta?.title || '', name: typeof profile?.title === 'string' ? profile.title : '' };
    })
  );
}

const settle = <T>(p: Promise<T>, ms = 4000): Promise<T | null> =>
  Promise.race([
    Promise.resolve(p).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
import * as mods from '../../ui/mods';
import * as openTabs from '../../ui/open-tabs';
import * as jobs from '../../ai/jobs';
import * as jobChat from '../../ai/job-chat';
import { driveTitle, readJobSource, resolveJobWrites } from './job-source';
import { PRESETS } from '../../../../shared/mods.mjs';
import { searchMemories, MAX_MEMORIES } from '../../../../shared/ai-memory.mjs';
import * as aiMemory from '../../ai/memory';
import {
  searchSkills,
  parseSkillMd,
  skillMd,
  MAX_SKILLS,
  MAX_SKILL_NAME,
  MAX_SKILL_DESCRIPTION,
  MAX_SKILL_INSTRUCTIONS,
} from '../../../../shared/ai-skills.mjs';
import * as aiSkills from '../../ai/skills';
import {
  describeSchedule,
  nextRunAt,
  normalizeSchedule,
  runDuration,
  runPreview,
  runSearchText,
  timeLimitOf,
} from '../../../../shared/jobs.mjs';

// The Drive key of a hyper://<key>/ URL, or null.
function driveKeyOf(url) {
  const m = /^hyper:\/\/([0-9a-f]{64})(?:[/?#]|$)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : null;
}

// The caller's local Space id: its tab's Space, or the Space its window shows.
function spaceIdOf(ctx) {
  let id = ctx?.sender ? filesystem.getSpaceIdForWebContents(ctx.sender.id) : null;
  if (!id && ctx?.sender) {
    const win = findWebContentsParentWindow(ctx.sender);
    if (win) id = tabManager.getWindowActiveSpaceId(win);
  }
  return Number(id) || 1;
}

function thisPlatform() {
  return 'desktop';
}

// The name a person goes by in a Space they share or join, until they type another.
function defaultOwnName() {
  try {
    const u = os.userInfo().username || '';
    return u ? u.charAt(0).toUpperCase() + u.slice(1) : 'Me';
  } catch {
    return 'Me';
  }
}

function defaultDeviceName() {
  try {
    return `${os.hostname()} (${os.type()})`;
  } catch {
    return 'This device';
  }
}

// Identity of the current Device: its writer key in the Vault (null until a Vault exists here).
// Module-level so it can be reused without relying on `this` — pauls-electron-rpc invokes each
// exported method unbound, so `this` is not the API object.
async function getThisDeviceInfo() {
  const sess = await vault.getVault();
  const key = sess?.base?.local?.key ? b4a.toString(sess.base.local.key, 'hex') : null;
  return { key, name: defaultDeviceName(), platform: thisPlatform(), version: app.getVersion() };
}

export default {
  async getStatus() {
    const sess = await vault.getVault();
    // Backfill the owner's own device record into the Vault index so it replicates to other
    // Devices (the creating Device never went through addDevice). Self-heals existing Vaults the
    // first time this page is opened.
    if (sess) {
      try {
        await vault.registerOwnDevice({ name: defaultDeviceName(), platform: thisPlatform() });
      } catch {}
      // Backfill local Spaces into the Vault so they replicate to paired Devices (any a Space's
      // creation didn't publish, e.g. one made before this Device had a Vault).
      try {
        await vault.syncSpacesToVault();
      } catch {}
      // This Device's own Space list, so the phone can show which Spaces each Device has.
      try {
        await vault.publishOwnSpaces();
      } catch {}
      // And the version it runs, so the other Devices can flag one that's out of date.
      try {
        await vault.publishOwnVersion(app.getVersion());
      } catch {}
      // A Vault made after startup (first invite) needs the presence channel on live connections.
      devicePresence.install();
      liveNotes.install();
    }
    const devices = sess ? await vault.listDevices() : [];
    return {
      hasVault: !!sess,
      // A solo Vault (no other Device joined it) can be left to join another Vault; its notes and
      // subscriptions come along (hyper/vault.js adoptVault).
      canJoin: await vault.isSolo(sess),
      thisDevice: await getThisDeviceInfo(),
      deviceCount: devices.length,
    };
  },

  async getThisDevice() {
    return getThisDeviceInfo();
  },

  async listDevices() {
    return vault.listDevices();
  },

  async listSpaces() {
    // A `movedTo` record only points paired Devices at a Space's new Root Drive; it isn't a Space.
    return (await vault.listSpaces()).filter((s) => !s.movedTo);
  },

  // Replication state of the Vault and each Space, for the Devices page's sync panel.
  async getSyncStatus() {
    return { ...(await vault.getSyncStatus()), connectedDevices: devicePresence.connectedDevices() };
  },

  // Member side: ensure a Vault exists, then mint an invite code.
  async createInvite() {
    const code = await pairing.createInvite();
    // createInvite ensures the Vault exists; record the owner now so the device you're about to
    // pair sees this Device in its list (not just itself), and publish this Device's Spaces so the
    // joining Device sees them once it syncs the Vault.
    try {
      await vault.registerOwnDevice({ name: defaultDeviceName(), platform: thisPlatform() });
    } catch {}
    try {
      await vault.syncSpacesToVault();
    } catch {}
    return { code };
  },

  async listPendingRequests() {
    return pairing.listPendingRequests();
  },

  watchPendingRequests() {
    const emitter: any = new EventEmitter();
    const onChange = () => emitter.emit('changed', {});
    pairing.events.on('request', onChange);
    pairing.events.on('request-resolved', onChange);
    emitter.close = () => {
      pairing.events.removeListener('request', onChange);
      pairing.events.removeListener('request-resolved', onChange);
    };
    return emitter;
  },

  async approveDevice(deviceKey) {
    return pairing.approveDevice(deviceKey);
  },

  async denyDevice(deviceKey) {
    return pairing.denyDevice(deviceKey);
  },

  // Candidate side: join an existing identity by entering an invite code from a trusted Device.
  // Once paired, mirror the Vault's Spaces into the local spaces DB so they appear on this Device.
  async submitInvite(code, opts: any = {}) {
    const res = await pairing.submitInvite(code, {
      name: opts.name || defaultDeviceName(),
      platform: thisPlatform(),
    } as any);
    try {
      await vault.syncSpacesFromVault();
    } catch {}
    driveWriters.watch();
    return res;
  },

  async renameDevice(deviceKey, name) {
    return vault.renameDevice(deviceKey, name);
  },

  async removeDevice(deviceKey) {
    await vault.removeDevice(deviceKey);
    // Take its writer keys off the Drives this Device writes (bg/hyper/drive-writers.js).
    driveWriters.sync().catch(() => {});
  },

  // Always-on Peers (ADR-0038): each with whether it is connected now, the status it last sent, a
  // line for its row, and every Space with whether this Peer keeps it online.
  async listPeers() {
    const [list, spaces] = await Promise.all([vault.listPeers(), vault.listSpaces()]);
    const connected = new Set(devicePresence.connectedDevices());
    const statuses = devicePresence.peerStatuses();
    const live = liveSpaces(spaces);
    return list.map((p) => {
      const online = connected.has(p.key);
      const status = peerRules.readStatus(statuses[p.key]);
      return {
        ...p,
        online,
        status,
        summary: peerRules.describePeer(p, status, { online }),
        spaces: live.map((s) => ({ rootDriveKey: s.rootDriveKey, name: s.name || 'Space', kept: peerRules.holdsSpace(p, s.rootDriveKey) })),
      };
    });
  },

  // Keep Space `rootDriveKey` online on Peer `peerKey`, or stop.
  async setPeerSpace(peerKey, rootDriveKey, on) {
    const peer = (await vault.listPeers()).find((p) => p.key === peerKey);
    if (!peer) throw new Error('That Peer was removed');
    const all = liveSpaces(await vault.listSpaces()).map((s) => s.rootDriveKey);
    return vault.updatePeer(peerKey, { hold: peerRules.withSpace(peer, rootDriveKey, !!on, all) });
  },

  async renamePeer(peerKey, name) {
    return vault.updatePeer(peerKey, { name: String(name || '') });
  },

  async removePeer(peerKey) {
    return vault.removePeer(peerKey);
  },

  // Editing a Drive one of the user's other Devices can write (ADR-0026 §2, ADR-0029 step 2).
  async driveEditStatus(url) {
    return driveWriters.status(driveKeyOf(url));
  },

  async requestDriveEdit(url, opts: any = {}) {
    return driveWriters.request(driveKeyOf(url), { note: typeof opts?.note === 'string' ? opts.note : '' });
  },

  // Shared Spaces (bg/hyper/space-library.js, ADR-0029). Each acts on the caller's Space.
  async getSpaceShare() {
    const spaceId = spaceIdOf(this);
    const space = await spacesDb.get(spaceId);
    const others = await sharedSpacesExcept(spaceId).catch(() => []);
    const base = {
      spaceId,
      name: space?.name || 'Space',
      color: space?.color || null,
      icon: space?.icon || null,
      personal: spaceId === 1,
      others,
    };
    if (spaceId === 1) return { ...base, shared: false, ownName: defaultOwnName() }; // ownName: for Set up a home and Join
    const key = await vaultApps.spaceKey(this).catch(() => null);
    const st = key ? await spaceLibrary.status(key) : { shared: false };
    if (st.shared) return { ...base, ...st };
    const preview = await filesystem.shareSpacePreview(spaceId).catch(() => null);
    return { ...base, ...st, preview: preview?.summary || null, ownName: defaultOwnName() };
  },

  // Switch the caller's window to another of the user's Spaces (the Sharing page's Open).
  async openSpace(id) {
    const space = await spacesDb.get(Number(id));
    if (!space) throw new Error('That Space isn’t on this device');
    const win = this?.sender ? findWebContentsParentWindow(this.sender) : null;
    if (!win) throw new Error('No window to open it in');
    await tabManager.setActiveSpace(win, space.id);
    return { spaceId: space.id, name: space.name };
  },

  async shareSpace(opts: any = {}) {
    const spaceId = spaceIdOf(this);
    return filesystem.shareSpace(spaceId, { name: String(opts?.name || defaultOwnName()).slice(0, 100) });
  },

  // Set up a home (shared/home-setup.mjs): make a Space for the people the user lives with, share
  // it, put a Groceries list and House info in it, pin both, and switch the caller's window to it
  // with its Sharing page open, to invite them. ({ name?, ownName? }) -> { spaceId, name }.
  async setUpHome(opts: any = {}) {
    const { name, ownName } = home.homeNames(opts || {}, defaultOwnName());
    const space = await tabManager.createSpace(
      { name, icon: home.HOME_ICON, color: home.HOME_COLOR },
      { waitForDrive: true }
    );
    await filesystem.shareSpace(space.id, { name: ownName });
    const rootKey = await drives.fromURLToKey(filesystem.getSpaceRootDriveUrl(space.id), true);
    const ids = {};
    for (const n of home.starterNotes()) {
      const note = await vaultApps.saveNote(null, { body: n.body, inSpace: true, space: rootKey });
      ids[n.key] = note.id;
    }
    await spacePins.pinAll(space.id, home.starterPins(ids)).catch(() => {});
    const win = this?.sender ? findWebContentsParentWindow(this.sender) : null;
    if (win) {
      tabManager.create(win, 'nomad://library/sharing?home=1', { spaceId: space.id, setActive: false } as any);
      await tabManager.setActiveSpace(win, space.id).catch(() => {});
    }
    return { spaceId: space.id, name };
  },

  async createSpaceInvite(role) {
    const { code } = await spaceLibrary.createInvite(await vaultApps.spaceKey(this), role);
    return { code, role };
  },

  // Invite links (ADR-0040, bg/hyper/invites.js): one https link a friend opens anywhere.
  async createSpaceInviteLink(role, opts: any = {}) {
    return invites.makeSpaceLink(await vaultApps.spaceKey(this), role, { days: opts?.days });
  },

  async listSpaceInvites() {
    const key = await vaultApps.spaceKey(this).catch(() => null);
    return key ? spaceLibrary.listInvites(key) : [];
  },

  async revokeSpaceInvite(id) {
    return spaceLibrary.revokeInvite(await vaultApps.spaceKey(this), String(id || ''));
  },

  // What an invite link says, after checking it, for the Sharing page's join card.
  async readInvite(link) {
    return invites.read(String(link || ''));
  },

  async approveSpaceJoin(memberId) {
    return spaceLibrary.approveJoin(await vaultApps.spaceKey(this), memberId);
  },

  async denySpaceJoin(memberId) {
    return spaceLibrary.denyJoin(await vaultApps.spaceKey(this), memberId);
  },

  async setSpaceRole(memberId, role) {
    return spaceLibrary.setRole(await vaultApps.spaceKey(this), memberId, role);
  },

  async removeSpaceMember(memberId) {
    return spaceLibrary.removeMember(await vaultApps.spaceKey(this), memberId);
  },

  async answerSpaceRequest(opts: any = {}) {
    return spaceLibrary.answerRequest(await vaultApps.spaceKey(this), opts.drive, opts.writerKey, !!opts.approve);
  },

  // Leave the caller's shared Space: close its tabs, drop it here and from the Vault.
  async leaveSpace() {
    const spaceId = spaceIdOf(this);
    if (spaceId === 1) throw new Error('You can’t leave your Personal Space');
    await filesystem.leaveSpace(spaceId);
    // Its tabs and the Sessions sites held in it (ADR-0031 §4) go with it.
    await tabManager.dropSpace(spaceId);
  },

  // Join a shared Space with a code. Resolves once an owner approves; switches the caller's window
  // to the new Space.
  async joinSpace(code, opts: any = {}) {
    // A code, or an invite link around one (checked first: expiry, signature).
    code = await invites.codeFor(code);
    const space = await filesystem.joinSpace(code, { name: String(opts?.name || defaultOwnName()).slice(0, 100) });
    const win = this?.sender ? findWebContentsParentWindow(this.sender) : null;
    if (win) await tabManager.setActiveSpace(win, space.id).catch(() => {});
    return { spaceId: space.id, name: space.name };
  },

  // 'changed' when a shared Space's members, requests or library change.
  watchSpaceShare() {
    const emitter: any = new EventEmitter();
    const onChange = () => emitter.emit('changed', {});
    for (const ev of ['changed', 'join-request', 'join-resolved', 'removed']) spaceLibrary.events.on(ev, onChange);
    emitter.close = () => {
      for (const ev of ['changed', 'join-request', 'join-resolved', 'removed']) spaceLibrary.events.removeListener(ev, onChange);
    };
    return emitter;
  },

  // Reader and Notes data (vault-apps.ts), in the Vault. `this` is the RPC event, which carries the
  // calling page and so its Space.
  async readerState() {
    return vaultApps.readerState(this);
  },

  async readerFollow(url) {
    return vaultApps.follow(this, url);
  },

  async readerUnfollow(url) {
    return vaultApps.unfollow(this, url);
  },

  async readerSaveRead(add, loaded) {
    return vaultApps.saveRead(this, add, loaded);
  },

  // Saved articles (reader-articles.ts, ADR-0033)
  async readerSaveArticle(url, opts) {
    return vaultApps.saveArticle(this, url, opts);
  },

  async readerUpdateArticle(id, changes) {
    return vaultApps.updateArticle(this, id, changes);
  },

  async readerDeleteArticle(id) {
    return vaultApps.deleteArticle(this, id);
  },

  async readerSuggestTopics(ids) {
    return vaultApps.suggestTopics(this, ids);
  },

  async readerArticle(id) {
    return vaultApps.readArticle(this, id);
  },

  async readerRefetchArticle(id) {
    return vaultApps.refetchArticle(this, id);
  },

  // RSS and Atom feeds (web-feeds.ts), and topics for feed posts
  async readerAddLink(url) {
    return vaultApps.addLink(this, url);
  },

  async readerWebFeed(url, opts) {
    return vaultApps.webFeed(this, url, opts);
  },

  async readerTagPosts(posts, urls) {
    return vaultApps.tagPosts(this, posts, urls);
  },

  async readerSetPostTopics(url, topics) {
    return vaultApps.setPostTopics(this, url, topics);
  },

  // `ai` is what the AI is doing with the Notes' topics (note-topics.ts, ADR-0035).
  async listNotes() {
    return { ...(await vaultApps.listNotes(this)), ai: await noteTopics.aiState() };
  },

  // ({ id?, body, baseUpdatedAt?, inSpace? }). `space` is only for the AI's turns from other Devices.
  async saveNote(note) {
    const { space, ...rest } = note || {};
    return vaultApps.saveNote(this, rest);
  },

  async moveNote(change) {
    return vaultApps.moveNote(this, change);
  },

  async deleteNote(id) {
    return vaultApps.deleteNote(this, id);
  },

  async renameNoteLinks(change) {
    return vaultApps.renameNoteLinks(this, change);
  },

  // A Note's topics, by hand (ADR-0035): ({ id, topics }) -> note.
  async setNoteTopics(change) {
    return vaultApps.setNoteTopics(this, change);
  },

  // Who ticked an item of a shared Space's Note: ({ id, text, checked }) -> note.
  async setNoteTick(change) {
    return vaultApps.setNoteTick(this, change);
  },

  // Household contacts (My Library → Contacts, shared/household-contacts.mjs): the caller's Space's.
  async listHouseholdContacts() {
    return householdContacts.listContacts(this);
  },
  async saveHouseholdContact(fields: any = {}) {
    return householdContacts.saveContact(this, fields || {});
  },
  async deleteHouseholdContact(id) {
    return householdContacts.deleteContact(this, id);
  },

  // The Calendar (nomad://calendar, shared/calendar.mjs): the caller's Space's events and feeds.
  async listCalendar(range: any = {}) {
    return calendar.listCalendar(this, range || {});
  },
  async saveCalendarEvent(fields: any = {}) {
    return calendar.saveEvent(this, fields || {});
  },
  async deleteCalendarEvent(id) {
    return calendar.deleteEvent(this, id);
  },
  async saveCalendarFeed(fields: any = {}) {
    return calendar.saveFeed(this, fields || {});
  },
  async deleteCalendarFeed(id) {
    return calendar.deleteFeed(this, id);
  },
  async refreshCalendarFeeds(opts: any = {}) {
    return calendar.refreshFeeds(this, { force: !!opts?.force });
  },
  // Calendar drives (walled.garden/calendar) in the caller's Space that the calendar doesn't follow.
  async listCalendarDrives() {
    return calendar.listCalendarDrives(this);
  },

  // Assets (nomad://assets, shared/assets.mjs): the caller's Space's files. A shared Space's are
  // everyone's in it; any other Space's are the user's own, in the Vault.
  async listAssets() {
    return assets.listAssets(this);
  },
  async assetData(id, opts: any = {}) {
    return assets.assetData(this, id, { thumb: !!opts?.thumb });
  },
  async addAsset(fields: any = {}) {
    return assets.addAsset(this, fields || {});
  },
  async assetChunk(id, opts: any = {}) {
    return assets.assetChunk(this, id, { start: opts?.start, length: opts?.length, thumb: !!opts?.thumb });
  },
  async beginAssetUpload(opts: any = {}) {
    return assets.beginAssetUpload(this, opts || {});
  },
  async assetUploadChunk(id, piece: any = {}) {
    return assets.assetUploadChunk(this, id, piece || {});
  },
  async finishAssetUpload(id, fields: any = {}) {
    return assets.finishAssetUpload(this, id, fields || {});
  },
  async abortAssetUpload(id) {
    return assets.abortAssetUpload(this, id);
  },
  async updateAsset(change: any = {}) {
    return assets.updateAsset(this, change || {});
  },
  async updateAssets(change: any = {}) {
    return assets.updateAssets(this, change || {});
  },
  async deleteAsset(id) {
    return assets.deleteAsset(this, id);
  },
  async deleteAssets(ids) {
    return assets.deleteAssets(this, Array.isArray(ids) ? ids : []);
  },
  async addAssetFolder(path) {
    return assets.addFolder(this, String(path || ''));
  },
  async moveAssetFolder(change: any = {}) {
    return assets.moveFolder(this, change || {});
  },
  async deleteAssetFolder(path) {
    return assets.deleteFolder(this, String(path || ''));
  },

  // Ask the AI for topics now: for `ids`, or every Note with none yet. -> how many it will look at.
  async suggestNoteTopics(ids) {
    return noteTopics.suggest(this, Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : null);
  },

  watchAppData() {
    const watcher = vaultApps.watch();
    // The AI started or finished picking a Note's topics.
    const changed = () => watcher.emit('changed', {});
    noteTopics.events.on('changed', changed);
    const close = watcher.close;
    watcher.close = () => {
      noteTopics.events.removeListener('changed', changed);
      close();
    };
    return watcher;
  },

  // Live editing of an open Note (bg/notes/live-notes.js, ADR-0041). `conn` is the page's own id
  // for this connection. The stream's 'message' events are y-protocols messages ({ data: base64 })
  // and 'status' the session's; liveNoteSend sends the page's. Closing the stream leaves the Note.
  openLiveNote(id, conn) {
    return liveNotes.openPage(id, conn);
  },

  async liveNoteSend(id, conn, data) {
    return liveNotes.pageSend(id, conn, data);
  },

  // Names (hyper/names.js): short words for drives, apps in a private drive, and any URL. The
  // caller's Space's names come with the user's own; each record has `space` (a key, or null).
  async listNames() {
    return names.list(await callerSpace(this));
  },

  // { space, spaceName }: the caller's Space, for My Library → Names' sections.
  async getNamesSpace() {
    const space = await callerSpace(this);
    return { space, spaceName: space ? vaultApps.spaceNameOf(space) : null };
  },

  // The names that point to the page at `url`.
  async namesForUrl(url) {
    return names.forUrl(url, await callerSpace(this));
  },

  // ({ name, url, title, inSpace?, previous?, previousInSpace? }) -> record. `previous` renames;
  // `inSpace` keeps the name only in the caller's Space (ADR-0029), and `previousInSpace` says where
  // the renamed or moved one was. A name saved here is the user's, so it drops the AI's `auto` mark.
  async setName(rec) {
    const { name, url, title, previous, inSpace, previousInSpace } = rec || {};
    const space = await callerSpace(this);
    if ((inSpace || previousInSpace) && !space) throw new Error('This page has no Space');
    return names.set({
      name,
      url,
      title,
      previous,
      space: inSpace ? space : null,
      previousSpace: previousInSpace ? space : null,
    });
  },

  // (name, { inSpace? }): remove the user's own name, or with inSpace, the caller's Space's.
  async removeName(name, { inSpace = false } = {}) {
    return names.remove(name, inSpace ? await callerSpace(this) : null);
  },

  // Mods (bg/ui/mods.js): My Library → Mods.
  async listMods() {
    return {
      mods: mods.list(),
      presets: PRESETS.map(({ id, label, description }) => ({ id, label, description })),
    };
  },

  async saveMod(fields) {
    return mods.save(fields || {});
  },

  async deleteMod(id) {
    await mods.remove(id);
  },

  // AI memory (bg/ai/memory.js, ADR-0032): nomad://ai/memory.
  async listMemories({ query = '' } = {}) {
    return {
      memories: searchMemories(aiMemory.list(), query),
      enabled: await aiMemory.isEnabled(),
      max: MAX_MEMORIES,
    };
  },

  async saveMemory(fields) {
    const { id, text } = fields || {};
    return aiMemory.save({ id: id || undefined, text, by: 'user' });
  },

  async deleteMemory(id) {
    await aiMemory.remove(id);
  },

  async clearMemories() {
    return aiMemory.clear();
  },

  // AI skills (bg/ai/skills.js, ADR-0034): nomad://ai/skills. The AI reads them; only the user
  // changes them, here.
  async listSkills({ query = '' } = {}) {
    return {
      skills: searchSkills(aiSkills.list(), query),
      max: MAX_SKILLS,
      limits: { name: MAX_SKILL_NAME, description: MAX_SKILL_DESCRIPTION, instructions: MAX_SKILL_INSTRUCTIONS },
    };
  },

  async saveSkill(fields) {
    const { id, name, description, instructions, enabled } = fields || {};
    return aiSkills.save({
      id: id || undefined,
      name,
      description,
      instructions,
      enabled: typeof enabled === 'boolean' ? enabled : undefined,
    });
  },

  async deleteSkill(id) {
    await aiSkills.remove(id);
  },

  // A SKILL.md's text as { name, description, instructions }, to fill the page's form; nothing is saved.
  async parseSkillMd(text) {
    if (typeof text !== 'string' || text.length > 2 * MAX_SKILL_INSTRUCTIONS) {
      throw new Error('That file is too big to be a skill');
    }
    return parseSkillMd(text);
  },

  // A skill as SKILL.md text, to save as a file.
  async exportSkill(id) {
    const s = aiSkills.get(id);
    if (!s) throw new Error('No skill with that id');
    return skillMd(s);
  },

  // AI Jobs (bg/ai/jobs.js, ADR-0030): My Library → Jobs. Each Job comes with its newest run, when
  // it next runs, whether it is running here now, the name of the Device that runs it, and the
  // title of each drive it may write.
  async listJobs() {
    const [own, devices] = await Promise.all([
      jobs.ownKey().catch(() => null),
      vault.listDevices().catch(() => []),
    ]);
    const names = new Map((devices || []).map((d) => [d.key, d.name]));
    const list = jobs.list();
    const urls = [...new Set(list.flatMap((j) => (j.writes?.drives || []).map((d) => d.url)))];
    const titles = new Map(
      await Promise.all(urls.map(async (u) => [u, await driveTitle(u).catch(() => null)] as const))
    );
    // Which Spaces are shared, so the editor offers "Everyone in <Space>" (shared/jobs.mjs audience).
    let here = null;
    try {
      here = await vaultApps.spaceKey(this);
    } catch {}
    const spaceKeys = [...new Set([here, ...list.map((j) => j.space)].filter(Boolean))];
    const sharedSpaces = new Map(
      await Promise.all(
        spaceKeys.map(async (k) => {
          const i: any = await spaceLibrary.info(k).catch(() => ({ shared: false, role: null }));
          const ok = !!i.shared && !i.removed && (i.role === 'owner' || i.role === 'editor');
          return [k, ok ? vaultApps.spaceNameOf(k) || 'this Space' : null] as const;
        })
      )
    );
    return {
      // The caller's Space, when a Job made here could notify everyone in it.
      sharedSpace: here && sharedSpaces.get(here) ? { space: here, name: sharedSpaces.get(here) } : null,
      jobs: list.map((j) => ({
        sharedSpaceName: (j.space && sharedSpaces.get(j.space)) || null,
        ...j,
        ...(j.writes
          ? {
              writes: {
                ...j.writes,
                drives: (j.writes.drives || []).map((d) => ({ ...d, title: titles.get(d.url) || '' })),
              },
            }
          : {}),
        when: describeSchedule(j.schedule),
        timeLimit: timeLimitOf(j),
        here: !!own && j.device === own,
        deviceName: j.device === own ? 'This computer' : names.get(j.device) || 'Another device',
      })),
    };
  },

  // A Job's history: its saved runs, newest first, each with the name of the Device that ran it and
  // how long it took.
  async listJobRuns(id) {
    const [own, devices] = await Promise.all([
      jobs.ownKey().catch(() => null),
      vault.listDevices().catch(() => []),
    ]);
    const names = new Map((devices || []).map((d) => [d.key, d.name]));
    return jobs.runsOf(id).map((r) => ({
      ...r,
      deviceName: !r.device ? '' : r.device === own ? 'This computer' : names.get(r.device) || 'Another device',
      took: runDuration(r),
      preview: runPreview(r),
      searchText: runSearchText(r),
    }));
  },

  // Clear a Job's history on every Device. Resolves to how many runs went.
  async clearJobRuns(id) {
    return jobs.clearRuns(id);
  },

  // ({ id?, title?, prompt?, source?, writes?, schedule?, notify?, timeLimit?, enabled?, runHere? }) -> record.
  // `timeLimit` is the minutes a run may go on with nobody watching (null for the default). A
  // new Job runs on this Device and reads the Reader of the calling page's Space. `source` is a drive
  // URL to read now (the user's own drive stays live, anyone else's is copied), { url, module, prompt }
  // for a newer version the user looked at (from checkJobSource) and took, or null to drop it.
  // `writes` is what the Job may change ({ drives: [url | { url, draft }], notes, reader, newDrives }, null for
  // nothing); the user sets it here, in their own Library, so it isn't asked again.
  async saveJob(fields) {
    const f = fields || {};
    let space;
    try {
      space = await vaultApps.spaceKey(this);
    } catch {}
    const { id, title, prompt, schedule, notify, timeLimit, enabled, runHere } = f;
    // Notifying the Space is for a Job in a shared Space the user can edit.
    const audience = f.audience === undefined ? undefined : f.audience === 'space' ? 'space' : 'me';
    if (audience === 'space') {
      const jobSpace = id ? jobs.list().find((j) => j.id === id)?.space : space;
      const i: any = jobSpace ? await spaceLibrary.info(jobSpace).catch(() => null) : null;
      if (!i?.shared || i.removed || !(i.role === 'owner' || i.role === 'editor')) {
        throw new Error('Only a Job in a shared Space you can edit can notify everyone in it');
      }
    }
    let source;
    if (f.source === null) source = null;
    else if (typeof f.source === 'string') source = await readJobSource(f.source, space || null);
    else if (f.source && typeof f.source === 'object') {
      const { url, module = null, prompt: text = null } = f.source;
      source = { url, live: false, module, prompt: text };
    }
    const writes = f.writes === undefined ? undefined : await resolveJobWrites(f.writes, space || null);
    return jobs.save({
      id,
      title,
      prompt,
      source,
      writes,
      schedule,
      notify,
      audience,
      timeLimit,
      enabled,
      runHere: !!runHere,
      space: f.id ? undefined : space,
    });
  },

  // A schedule as the Jobs editor has it (an object, a phrase or cron), checked: { schedule, when,
  // next: [ISO, …] } with its next few times from now. Throws with what's wrong.
  async previewSchedule(input) {
    const now = new Date();
    const schedule = normalizeSchedule(input, now);
    const next = [];
    let after = now;
    while (schedule && next.length < 3) {
      const at = nextRunAt(schedule, after);
      if (!at) break;
      next.push(at.toISOString());
      after = at;
    }
    return { schedule, when: describeSchedule(schedule), next };
  },

  // A Job's source as its drive has it now: { url, live, module, prompt, title, hash }, so the user
  // can look at a newer version before taking it.
  async checkJobSource(id) {
    const job = jobs.get(id);
    if (!job?.source) throw new Error('This Job doesn’t come from a drive');
    return readJobSource(job.source.url);
  },

  async deleteJob(id) {
    await jobs.remove(id);
  },

  // Run a Job now, on this Device. `{ watch: true }` is Run with me (ADR-0038): its page opens in a
  // tab of this page's window, and each site it reaches asks the user, whose yes is kept on the Job.
  async runJob(id, opts: any = {}) {
    let watch = null;
    if (opts?.watch) {
      watch = tabManager.findContainingWindow(this.sender) || BrowserWindow.getFocusedWindow();
      if (!watch) throw new Error('Open a Nomad window to watch the Job run');
    }
    jobs.runNow(id, { watch });
  },

  // Watch a Job's run from this page's window (ADR-0038): while it runs, the AI Sidebar opens to its
  // chat and its page comes to the front (a hidden page shows in a window of its own). After it
  // ran, `{ chat }` (a run's `chat`) or its last watched run's chat opens. { running, chat, page }.
  async viewJob(id, opts: any = {}) {
    if (!jobs.get(id)) throw new Error('No Job with that id');
    const win = tabManager.findContainingWindow(this.sender) || BrowserWindow.getFocusedWindow();
    if (!win) throw new Error('Open a Nomad window to watch the Job');
    const chat = typeof opts?.chat === 'string' && /^[a-z0-9]{1,40}$/.test(opts.chat) ? opts.chat : null;
    return jobChat.view(id, win, { chat });
  },

  // Stop a Job's run on this Device: the one going on now, or one waiting to start. false when
  // neither.
  async stopJob(id) {
    if (!jobs.get(id)) throw new Error('No Job with that id');
    return jobs.stop(id);
  },

  // A Job's run on this Device as it goes on, for the Jobs page: 'progress' with { progress } at
  // once and as the run goes (a quarter second apart at most), where progress is job-chat.js
  // progress() or null when nothing is running.
  watchJobProgress(id) {
    const emitter: any = new EventEmitter();
    const jobId = String(id || '');
    let timer = null;
    let closed = false;
    const send = () => {
      timer = null;
      if (!closed) emitter.emit('progress', { progress: jobChat.progress(jobId) });
    };
    const changed = (changedId) => {
      if (changedId === jobId && !timer) timer = setTimeout(send, 250);
    };
    jobChat.progressEvents.on('progress', changed);
    // The first one once the page is listening.
    timer = setTimeout(send, 0);
    emitter.close = () => {
      closed = true;
      clearTimeout(timer);
      jobChat.progressEvents.removeListener('progress', changed);
    };
    return emitter;
  },

  // 'changed' when a Job or a run changes, here or on another Device, and when a run starts.
  watchJobs() {
    const emitter: any = new EventEmitter();
    const changed = () => emitter.emit('changed', {});
    jobs.events.on('changed', changed);
    emitter.close = () => jobs.events.removeListener('changed', changed);
    return emitter;
  },

  // Open tabs on the user's other Devices, the calling page's Space first (nomad://history).
  // The home page's dashboard (nomad://desktop; the rules are shared/home-dashboard.mjs): the
  // caller's Space's newest Notes and Assets, its calendar from now on, the Jobs running and up next,
  // and recent notifications. `now` is the page's wall time; `limits` the rows its layout asks for
  // in a section ({ notes: 10 }). A source that fails or is slow (a shared
  // Space's Library still opening) leaves its section empty rather than holding up the rest.
  async homeDashboard(opts: any = {}) {
    const now = isDateTime(opts?.now) ? String(opts.now).slice(0, 16) : localWallTime();
    const today = now.slice(0, 10);
    const space = await callerSpace(this);
    const [notes, assetList, cal, notices, share, mail, devices, driveRequests, dismissed, page]: any[] = await Promise.all([
      settle(vaultApps.listNotes(this)),
      settle(assets.listAssets(this)),
      settle(calendar.listCalendar(this, { from: today, to: homeDash.addDays(today, homeDash.EVENT_DAYS) })),
      space ? settle(spaceLibrary.notices(space)) : null,
      space ? settle(spaceLibrary.status(space)) : null,
      settle(inbox.summary()),
      settle(vault.listDevices()),
      settle(waitingDriveRequests()),
      settle(vault.readAppRecord(homeDash.DISMISSED_PATH)),
      settle(homeLayout.get(space)),
    ]);
    const names = new Map((devices || []).map((d) => [d.key, d.name]));
    const own = await jobs.ownKey().catch(() => null);
    return {
      ...homeDash.dashboard(
        {
          jobs: jobs.list().map((j) => ({
            ...j,
            when: describeSchedule(j.schedule),
            deviceName: j.device && j.device !== own ? names.get(j.device) || 'another Device' : '',
          })),
          runs: jobs.allRuns(),
          notes: notes?.notes || [],
          assets: assetList?.assets || [],
          occurrences: cal?.occurrences || [],
          notices: notices?.list || [],
          memberId: notices?.memberId || null,
          spaceName: notices?.name || '',
          conversations: mail?.conversations || [],
          prompts: permissions.waitingPrompts(),
          driveRequests: driveRequests || [],
          spaceRequests: share?.shared ? share.requests || [] : [],
          joins: share?.shared ? share.joins || [] : [],
          devices: pairing.listPendingRequests(),
          dismissed,
        },
        { now, limits: opts?.limits }
      ),
      spaceName: vaultApps.spaceNameOf(space),
      linked: !!(await vault.getVault().catch(() => null)),
      // The page as a document (ADR-0048, shared/home-layout.mjs): the layout's program and the
      // cards pinned to it. With no Vault to read, the default layout and no cards.
      layout: page?.layout || hl.layoutView(null),
      cards: page?.cards || [],
    };
  },

  // A card pinned to the home page: `change` is { wide: boolean } or { move: -1 | 1 } (one place
  // earlier or later). Cards are made by the user's AI and the AI Sidebar's Pin to Home, never here.
  async updateHomeCard(id, change: any = {}) {
    const space = await callerSpace(this);
    if (change?.move === -1 || change?.move === 1) return homeLayout.moveCard(space, String(id), change.move);
    if (typeof change?.wide !== 'boolean') throw new Error('Nothing to change');
    await homeLayout.pinCard(space, { id: String(id), wide: change.wide });
    return true;
  },

  async removeHomeCard(id) {
    await homeLayout.removeCard(await callerSpace(this), String(id));
  },

  // Back to the dashboard every Space starts with. The layout it replaces is kept, one step back.
  async resetHomeLayout() {
    await homeLayout.setLayout(await callerSpace(this), null);
  },

  // The layout before the last change. False when there is none.
  async restoreHomeLayout() {
    return homeLayout.restoreLayout(await callerSpace(this));
  },

  // Clear notifications from the home page, on every Device: `items` are [{ id, at }] from the
  // dashboard's `notifications` (one) or `notificationKeys` (Clear all).
  async dismissHomeNotifications(items) {
    const rec = await vault.readAppRecord(homeDash.DISMISSED_PATH);
    await vault.putAppRecord(homeDash.DISMISSED_PATH, homeDash.dismiss(rec, Array.isArray(items) ? items.slice(0, 200) : []));
  },

  // Bring a prompt the home page lists under Needs you to the front (its window and tab).
  async showWaitingPrompt(id) {
    return permissions.showPrompt(id);
  },

  // 'changed' when something the home page shows under Needs you comes or goes and no Vault record
  // says so: a prompt, a request to write to a drive, a new Device, a shared Space's asks.
  watchHome() {
    const emitter: any = new EventEmitter();
    const changed = () => emitter.emit('changed', {});
    const subs: [any, string][] = [
      [permissions.events, 'changed'],
      [autobases.events, 'request'],
      [autobases.events, 'request-resolved'],
      [pairing.events, 'request'],
      [pairing.events, 'request-resolved'],
      [spaceLibrary.events, 'changed'],
      [spaceLibrary.events, 'join-request'],
      [spaceLibrary.events, 'join-resolved'],
    ];
    for (const [ev, name] of subs) ev.on(name, changed);
    emitter.close = () => {
      for (const [ev, name] of subs) ev.removeListener(name, changed);
    };
    return emitter;
  },

  async listDeviceTabs() {
    let currentSpace = null;
    try {
      currentSpace = await vaultApps.spaceKey(this);
    } catch {}
    return { ...(await openTabs.listOtherDevices(currentSpace)), currentSpace };
  },
};
