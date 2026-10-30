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
import * as mods from '../../ui/mods';
import * as openTabs from '../../ui/open-tabs';
import * as jobs from '../../ai/jobs';
import { readJobSource } from './job-source';
import { PRESETS } from '../../../../shared/mods.mjs';
import { describeSchedule, nextRunAt, normalizeSchedule } from '../../../../shared/jobs.mjs';

function thisPlatform() {
  return 'desktop';
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
    return res;
  },

  async renameDevice(deviceKey, name) {
    return vault.renameDevice(deviceKey, name);
  },

  async removeDevice(deviceKey) {
    return vault.removeDevice(deviceKey);
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

  async listNotes() {
    return vaultApps.listNotes();
  },

  async saveNote(note) {
    return vaultApps.saveNote(this, note);
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

  // Names (hyper/names.js): short words for drives, apps in a private drive, and any URL.
  async listNames() {
    return names.list();
  },

  // The names that point to the page at `url`.
  async namesForUrl(url) {
    return names.forUrl(url);
  },

  // ({ name, url, title, previous? }) -> record. `previous` renames. A name saved here is the
  // user's, so it drops the AI's `auto` mark.
  async setName(rec) {
    const { name, url, title, previous } = rec || {};
    return names.set({ name, url, title, previous });
  },

  async removeName(name) {
    return names.remove(name);
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
