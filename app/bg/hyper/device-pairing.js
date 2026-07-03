// @ts-nocheck
//
// Device pairing via Holepunch blind-pairing — the root-of-trust handshake for adding a Device
// to a user's Vault (ADR-0006, grill decisions Q3/Q8). Integration pattern follows autopass:
// the candidate mints its own local Autobase writer key up front (Autobase.getLocalCore) and
// sends it as userData; the member (an existing trusted Device) opens the request, surfaces it
// for EXPLICIT user approval, and only on approval addWriters the key + confirms (handing back
// the Vault key). A leaked invite alone cannot add a writer — approval is a separate human step.
//
// See docs/multi-device-protocol.md §2.

import BlindPairing from 'blind-pairing';
import Autobase from 'autobase';
import z32 from 'z32';
import b4a from 'b4a';
import { EventEmitter } from 'events';
import * as logLib from '../logger';
import * as daemon from './daemon';
import * as autobases from './autobases';
import * as vault from './vault';
import * as settingsDb from '../dbs/settings';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'device-pairing' });

// Invite public keys are persisted (they are public, not secret) so codes minted in a previous
// session can still be opened after a restart — the Vault key, and therefore the invite discovery
// topic, survives restarts, so a stale code would otherwise reach us but fail to open.
const INVITE_KEYS_SETTING = 'vault_invite_pubkeys';
let _inviteKeysLoaded = false;

async function _loadInviteKeys() {
  if (_inviteKeysLoaded) return;
  _inviteKeysLoaded = true;
  try {
    const raw = await settingsDb.get(INVITE_KEYS_SETTING);
    if (raw) {
      const seen = new Set(invitePublicKeys.map((k) => b4a.toString(k, 'hex')));
      for (const hex of JSON.parse(raw)) {
        if (!seen.has(hex)) invitePublicKeys.push(b4a.from(hex, 'hex'));
      }
    }
  } catch {}
}

async function _saveInviteKeys() {
  try {
    await settingsDb.set(
      INVITE_KEYS_SETTING,
      JSON.stringify(invitePublicKeys.map((k) => b4a.toString(k, 'hex')))
    );
  } catch {}
}

// 'request' { deviceKey, name, platform } — a candidate is awaiting approval
// 'request-resolved' { deviceKey, approved } — approved or denied
export const events = new EventEmitter();

let bp = null;
let member = null;
// All invite public keys minted this session. createInvite doesn't reliably return an invite id we
// can map a candidate to, so on a candidate we try each known key until open() succeeds. This also
// handles multiple outstanding invites (each candidate used a specific one).
const invitePublicKeys = [];
const pending = {}; // deviceKey(hex) -> { candidate, resolve, name, platform, ... }
const approved = {}; // deviceKey(hex) -> true, so a re-request after approval auto-confirms

function _bp() {
  if (!bp) {
    const swarm = daemon.getSwarm();
    if (!swarm) throw new Error('Cannot pair: swarm is not ready');
    bp = new BlindPairing(swarm, { poll: 5000 });
  }
  return bp;
}

// Member side (existing trusted Device) — mint an invite + listen for candidates
// =

// Returns a z32 invite code (also rendered as a QR by the UI). Single-use per blind-pairing default.
export async function createInvite() {
  await _loadInviteKeys();
  const sess = await vault.ensureVault();
  const { invite, publicKey } = BlindPairing.createInvite(sess.base.key);
  invitePublicKeys.push(publicKey);
  await _saveInviteKeys();
  _ensureMember(sess);
  return z32.encode(invite);
}

// Try to decrypt the candidate's request with each invite key we've minted. open() throws on the
// wrong key, so we attempt them in turn and stop at the first that works.
function _openCandidate(candidate) {
  for (const pk of invitePublicKeys) {
    try {
      candidate.open(pk);
      return true;
    } catch {}
  }
  return false;
}

// blind-pairing only sends a response to the candidate if request.response is set BY THE TIME the
// onadd promise resolves (see blind-pairing/index.js _addRequest: it awaits onadd, then bails if
// !request.response). confirm() sets that response. Since we gate confirm behind manual approval,
// onadd must NOT resolve until the user approves (or denies) — otherwise the response is never sent
// and the candidate waits forever. So onadd returns a promise held open via pending[key].resolve.
function _ensureMember(sess) {
  if (member) return;
  member = _bp().addMember({
    discoveryKey: sess.base.discoveryKey,
    onadd: (candidate) =>
      new Promise((resolve) => {
        _processCandidate(candidate, resolve).catch((e) => {
          logger.error('Failed to process pairing candidate', { error: e.toString() });
          resolve();
        });
      }),
  });
}

async function _processCandidate(candidate, resolve) {
  await _loadInviteKeys();
  if (!_openCandidate(candidate)) {
    logger.error('Could not open pairing candidate with any known invite key', {
      invites: invitePublicKeys.length,
    });
    return resolve();
  }
  const data = JSON.parse(b4a.toString(candidate.userData));

  // Already approved in a prior request (e.g. the candidate re-broadcast): auto-confirm so we don't
  // ask the user twice and the response is sent immediately.
  if (approved[data.key]) {
    const sess = await vault.getVault();
    if (sess) {
      try {
        candidate.confirm({ key: sess.base.key, encryptionKey: sess.base.encryptionKey });
      } catch (e) {
        logger.error('candidate.confirm threw (auto)', { error: e.toString() });
      }
    }
    return resolve();
  }

  pending[data.key] = {
    candidate,
    resolve,
    name: data.name || 'Unnamed device',
    platform: data.platform || 'unknown',
    requestedAt: new Date().toISOString(),
  };
  logger.info('Device pairing request received', { deviceKey: data.key, platform: data.platform });
  events.emit('request', {
    deviceKey: data.key,
    name: pending[data.key].name,
    platform: pending[data.key].platform,
  });
}

export function listPendingRequests() {
  return Object.entries(pending).map(([deviceKey, v]) => ({
    deviceKey,
    name: v.name,
    platform: v.platform,
    requestedAt: v.requestedAt,
  }));
}

// Approve: add the Device as a Writer (Vault + fan-out to all Root Drives), THEN confirm so the
// candidate receives the Vault key. Order matters — the writer must exist before the candidate boots.
export async function approveDevice(deviceKey) {
  const req = pending[deviceKey];
  if (!req) throw new Error('No pending request for that device');
  const sess = await vault.getVault();
  if (!sess) throw new Error('No vault on this device');

  await vault.addDevice(deviceKey, {
    name: req.name,
    platform: req.platform,
  });
  logger.info('Confirming device', { deviceKey, hasEncryptionKey: !!sess.base.encryptionKey });
  try {
    req.candidate.confirm({ key: sess.base.key, encryptionKey: sess.base.encryptionKey });
  } catch (e) {
    logger.error('candidate.confirm threw', { deviceKey, error: e.toString() });
    if (req.resolve) req.resolve();
    throw e;
  }

  approved[deviceKey] = true;
  // Resolve the held onadd promise — NOW blind-pairing sees request.response and delivers it.
  if (req.resolve) req.resolve();
  delete pending[deviceKey];
  logger.info('Approved device', { deviceKey });
  events.emit('request-resolved', { deviceKey, approved: true });
}

// Deny: resolve the held onadd promise without confirming, so request.response stays unset and
// blind-pairing sends nothing — the candidate never pairs.
export function denyDevice(deviceKey) {
  const req = pending[deviceKey];
  if (!req) return;
  if (req.resolve) req.resolve();
  delete pending[deviceKey];
  logger.info('Denied device', { deviceKey });
  events.emit('request-resolved', { deviceKey, approved: false });
}

// Candidate side (this Device joining an existing identity)
// =

// Enter an invite code to request joining the inviter's Vault. Resolves once approved (the member
// confirms and hands back the Vault key); rejects if pairing fails. The caller then syncs Spaces.
export async function submitInvite(code, { name, platform = 'desktop' } = {}) {
  const store = daemon.getCorestore();

  // Mint our local Autobase writer key up front (we don't have the Vault yet) — sent as userData
  // so the member can addWriter it. Same store the Vault will load into, so the 'local' core matches.
  const core = Autobase.getLocalCore(store);
  await core.ready();
  const localKey = b4a.toString(core.key, 'hex');
  await core.close();

  return await new Promise((resolve, reject) => {
    let candidate;
    try {
      candidate = _bp().addCandidate({
        invite: z32.decode(code),
        userData: b4a.from(JSON.stringify({ key: localKey, name, platform })),
        onadd: async (result) => {
          try {
            const vaultKey = b4a.toString(result.key, 'hex');
            const sess = await vault.adoptVault(vaultKey);
            logger.info('Paired into vault', { vaultKey, writable: sess?.writable });
            resolve({ vaultKey, writable: !!sess?.writable, deviceKey: localKey });
          } catch (e) {
            reject(e);
          }
        },
      });
    } catch (e) {
      return reject(e);
    }
    candidate.pairing.catch(reject);
  });
}
