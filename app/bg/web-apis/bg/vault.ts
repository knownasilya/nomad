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
import * as names from '../../hyper/names';
import * as driveWriters from '../../hyper/drive-writers';
import * as spaceLibrary from '../../hyper/space-library';
import * as filesystem from '../../filesystem/index';
import * as spacesDb from '../../dbs/spaces';
import { BrowserWindow } from 'electron';
import { findWebContentsParentWindow } from '../../lib/electron';
import * as tabManager from '../../ui/tabs/manager';

// The caller's Space key, or null.
const callerSpace = (ctx) => vaultApps.spaceKey(ctx).catch(() => null);
import * as mods from '../../ui/mods';
import * as openTabs from '../../ui/open-tabs';
import * as jobs from '../../ai/jobs';
import { readJobSource } from './job-source';
import { PRESETS } from '../../../../shared/mods.mjs';
import { searchMemories, MAX_MEMORIES } from '../../../../shared/ai-memory.mjs';
import * as aiMemory from '../../ai/memory';
import { describeSchedule, nextRunAt, normalizeSchedule } from '../../../../shared/jobs.mjs';

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
    const base = { spaceId, name: space?.name || 'Space', personal: spaceId === 1 };
    if (spaceId === 1) return { ...base, shared: false };
    const key = await vaultApps.spaceKey(this).catch(() => null);
    const st = key ? await spaceLibrary.status(key) : { shared: false };
    if (st.shared) return { ...base, ...st };
    const preview = await filesystem.shareSpacePreview(spaceId).catch(() => null);
    return { ...base, ...st, preview: preview?.summary || null, ownName: defaultOwnName() };
  },

  async shareSpace(opts: any = {}) {
    const spaceId = spaceIdOf(this);
    return filesystem.shareSpace(spaceId, { name: String(opts?.name || defaultOwnName()).slice(0, 100) });
  },

  async createSpaceInvite(role) {
    return spaceLibrary.createInvite(await vaultApps.spaceKey(this), role);
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
    for (const win of BrowserWindow.getAllWindows()) {
      if (tabManager.getWindowActiveSpaceId(win) === spaceId) await tabManager.setActiveSpace(win, 1).catch(() => {});
      for (const tab of tabManager.getAll(win).filter((t) => t.spaceId === spaceId)) await tabManager.remove(win, tab);
    }
    await spacesDb.remove(spaceId);
    vault.events.emit('spaces-synced', { removed: 1 });
  },

  // Join a shared Space with a code. Resolves once an owner approves; switches the caller's window
  // to the new Space.
  async joinSpace(code, opts: any = {}) {
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

  async listNotes() {
    return vaultApps.listNotes(this);
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

  watchAppData() {
    return vaultApps.watch();
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

  // AI Jobs (bg/ai/jobs.js, ADR-0030): My Library → Jobs. Each Job comes with its newest run, when
  // it next runs, whether it is running here now, and the name of the Device that runs it.
  async listJobs() {
    const [own, devices] = await Promise.all([
      jobs.ownKey().catch(() => null),
      vault.listDevices().catch(() => []),
    ]);
    const names = new Map((devices || []).map((d) => [d.key, d.name]));
    return {
      jobs: jobs.list().map((j) => ({
        ...j,
        when: describeSchedule(j.schedule),
        here: !!own && j.device === own,
        deviceName: j.device === own ? 'This computer' : names.get(j.device) || 'Another device',
      })),
    };
  },

  // A Job's saved runs, newest first.
  async listJobRuns(id) {
    return jobs.runsOf(id);
  },

  // ({ id?, title?, prompt?, source?, schedule?, notify?, enabled?, runHere? }) -> record. A new Job
  // runs on this Device and reads the Reader of the calling page's Space. `source` is a drive URL
  // to read now (the user's own drive stays live, anyone else's is copied), { url, module, prompt }
  // for a newer version the user looked at (from checkJobSource) and took, or null to drop it.
  async saveJob(fields) {
    const f = fields || {};
    let space;
    if (!f.id) {
      try {
        space = await vaultApps.spaceKey(this);
      } catch {}
    }
    const { id, title, prompt, schedule, notify, enabled, runHere } = f;
    let source;
    if (f.source === null) source = null;
    else if (typeof f.source === 'string') source = await readJobSource(f.source);
    else if (f.source && typeof f.source === 'object') {
      const { url, module = null, prompt: text = null } = f.source;
      source = { url, live: false, module, prompt: text };
    }
    return jobs.save({ id, title, prompt, source, schedule, notify, enabled, runHere: !!runHere, space });
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

  // Run a Job now, on this Device.
  async runJob(id) {
    jobs.runNow(id);
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
  async listDeviceTabs() {
    let currentSpace = null;
    try {
      currentSpace = await vaultApps.spaceKey(this);
    } catch {}
    return { ...(await openTabs.listOtherDevices(currentSpace)), currentSpace };
  },
};
