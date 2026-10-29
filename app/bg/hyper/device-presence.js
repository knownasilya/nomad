// @ts-nocheck
//
// Which of the user's other Devices this Device is connected to right now: the desktop side of
// shared/device-presence.mjs. The Devices page (and the phone) show it as "Connected".

import Protomux from 'protomux';
import c from 'compact-encoding';
import b4a from 'b4a';
import * as logLib from '../logger';
import * as daemon from './daemon';
import * as vault from './vault';
import { createDevicePresence } from '../../../shared/device-presence.mjs';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'device-presence' });

let presence = null;

// Idempotent: re-scans live connections, so call it again once a Vault opens or after a resume.
export function install() {
  const swarm = daemon.getSwarm();
  if (!swarm) return;
  if (!presence) {
    presence = createDevicePresence({
      swarm,
      Protomux,
      c,
      b4a,
      getVaultKey: () => vault.getVaultKey(),
      getDeviceKey: async () => {
        const sess = await vault.getVault();
        return sess?.base?.local?.key ? b4a.toString(sess.base.local.key, 'hex') : null;
      },
      log: (...args) => logger.info(args.join(' ')),
    });
    // Joined another Vault: channels keyed on the old one go, and live connections get new ones.
    vault.events.on('changed', () => {
      presence.reset();
      presence.install();
    });
  }
  presence.install();
}

// Vault writer keys of the Devices connected right now.
export function connectedDevices() {
  return presence ? [...presence.connectedDevices()] : [];
}

// This Device left its Vault (or joined another): drop channels keyed on the old one.
export function reset() {
  if (presence) presence.reset();
}
