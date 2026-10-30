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

// The caller's Space key, or null.
const callerSpace = (ctx) => vaultApps.spaceKey(ctx).catch(() => null);
import * as mods from '../../ui/mods';
import * as openTabs from '../../ui/open-tabs';
import { PRESETS } from '../../../../shared/mods.mjs';

// The Drive key of a hyper://<key>/ URL, or null.
function driveKeyOf(url) {
  const m = /^hyper:\/\/([0-9a-f]{64})(?:[/?#]|$)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : null;
}

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

  async requestDriveEdit(url) {
    return driveWriters.request(driveKeyOf(url));
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

  // Open tabs on the user's other Devices, the calling page's Space first (nomad://history).
  async listDeviceTabs() {
    let currentSpace = null;
    try {
      currentSpace = await vaultApps.spaceKey(this);
    } catch {}
    return { ...(await openTabs.listOtherDevices(currentSpace)), currentSpace };
  },
};
