// Passkeys (ADR-0049): the WebAuthn passkeys Nomad keeps for websites, on this computer only. Each
// private key is a P-256 key encrypted with the OS keychain (Electron safeStorage), like Secrets
// (ADR-0033): not in the Vault, not in a drive, never synced to the user's other Devices.
//
//   <userData>/passkeys.json   { version: 1, passkeys: [{ ...record, key: <base64 ciphertext> }] }
//
// The record (shared/passkeys.mjs makePasskey) says whose passkey it is. The key is decrypted only to
// sign (sign()), and no API returns it. bg/ui/passkeys.js is the only caller that signs.

import { app, safeStorage } from 'electron';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as rules from '../../../shared/passkeys.mjs';

const FILE = 'passkeys.json';

// Emits 'changed' when a passkey is made, used or removed.
export const events = new EventEmitter();

/** @type {Map<string, { rec: any, key: string }>} id -> record and its encrypted key (base64) */
let passkeys = new Map();
/** @type {Promise<void> | null} */
let loading = null;
/** @type {Promise<any>} */
let writes = Promise.resolve();

function filePath() {
  return path.join(app.getPath('userData'), FILE);
}

// Whether keys can be kept encrypted here. Linux's 'basic_text' backend is a fixed key, not a
// keychain, so it counts as no (as for Secrets).
export async function encryptionStatus() {
  let available = false;
  let backend = null;
  try {
    available = await safeStorage.isAsyncEncryptionAvailable();
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
      backend = safeStorage.getSelectedStorageBackend();
    }
  } catch {}
  const ok = available && backend !== 'basic_text' && backend !== 'unknown';
  return {
    ok,
    reason: ok
      ? null
      : 'This computer has no keychain Nomad can use, so it can’t keep passkeys here. On Linux, install and unlock a keyring (GNOME Keyring or KWallet).',
  };
}

export function load() {
  if (!loading) {
    loading = (async () => {
      let data = null;
      try {
        data = JSON.parse(await fs.promises.readFile(filePath(), 'utf8'));
      } catch {}
      const next = new Map();
      for (const p of Array.isArray(data?.passkeys) ? data.passkeys : []) {
        const { key, ...rec } = p || {};
        if (!rules.isPasskey(rec) || typeof key !== 'string') continue;
        next.set(rec.id, { rec: rules.makePasskey(rec), key });
      }
      passkeys = next;
    })();
  }
  return loading;
}

async function persist() {
  const list = [...passkeys.values()].map(({ rec, key }) => ({ ...rec, key }));
  const file = filePath();
  const tmp = file + '.tmp';
  await fs.promises.writeFile(tmp, JSON.stringify({ version: 1, passkeys: list }, null, 2), { mode: 0o600 });
  await fs.promises.rename(tmp, file);
}

function serial(fn) {
  const run = writes.then(async () => {
    await load();
    return fn();
  });
  writes = run.catch(() => {});
  return run;
}

// Every passkey, by site then account, without keys.
export async function list() {
  await load();
  return [...passkeys.values()]
    .map((p) => p.rec)
    .sort((a, b) => a.rpId.localeCompare(b.rpId) || a.userName.localeCompare(b.userName));
}

export async function get(id) {
  await load();
  return passkeys.get(id)?.rec || null;
}

// Make a passkey: a new P-256 key, encrypted at once. One per account on a site, so a passkey for an
// account Nomad already has one for replaces it. Returns the record and the public key (x, y and the
// SPKI DER bytes) for the attestation.
export function create({ rpId, rpName, userId, userName, displayName, origin }) {
  return serial(async () => {
    const status = await encryptionStatus();
    if (!status.ok) throw new rules.PasskeyError('NotAllowedError', status.reason);
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    const key = (await safeStorage.encryptStringAsync(pkcs8)).toString('base64');
    const id = rules.toB64url(crypto.randomBytes(16));
    const rec = rules.makePasskey({ id, rpId, rpName, userId, userName, displayName, origin });
    for (const old of rules.replacedBy([...passkeys.values()].map((p) => p.rec), rpId, userId))
      passkeys.delete(old.id);
    passkeys.set(id, { rec, key });
    await persist();
    events.emit('changed');
    return {
      rec,
      x: new Uint8Array(Buffer.from(jwk.x, 'base64url')),
      y: new Uint8Array(Buffer.from(jwk.y, 'base64url')),
      spki: new Uint8Array(publicKey.export({ format: 'der', type: 'spki' })),
    };
  });
}

// Sign `data` with a passkey's key (ES256, a DER signature, as WebAuthn wants), and mark it used.
export async function sign(id, data) {
  await load();
  const p = passkeys.get(id);
  if (!p) throw new rules.PasskeyError('NotAllowedError', 'That passkey is gone');
  let pkcs8;
  try {
    pkcs8 = (await safeStorage.decryptStringAsync(Buffer.from(p.key, 'base64'))).result;
  } catch {
    throw new rules.PasskeyError('NotAllowedError', 'This computer’s keychain can’t open that passkey anymore');
  }
  const key = crypto.createPrivateKey({ key: Buffer.from(pkcs8, 'base64'), format: 'der', type: 'pkcs8' });
  const sig = crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'der' });
  touch(id);
  return new Uint8Array(sig);
}

function touch(id) {
  writes = writes
    .then(async () => {
      const p = passkeys.get(id);
      if (!p) return;
      p.rec = { ...p.rec, lastUsedAt: new Date().toISOString() };
      await persist();
      events.emit('changed');
    })
    .catch(() => {});
}

export function remove(id) {
  return serial(async () => {
    if (!passkeys.delete(id)) throw new Error('No such passkey');
    await persist();
    events.emit('changed');
  });
}
