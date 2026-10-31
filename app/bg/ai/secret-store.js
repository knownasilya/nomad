// Secrets (ADR-0032): the user's API keys and tokens, kept on this computer only, each value
// encrypted with the OS keychain (Electron safeStorage: Keychain on macOS, DPAPI on Windows,
// libsecret/kwallet on Linux). Not in the Vault, not in a drive, not in hyper://private/: those
// replicate to the user's other Devices and into shared Spaces as plain data.
//
//   <userData>/ai-secrets.json   { version: 1, secrets: [{ ...record, value: <base64 ciphertext> | null }] }
//
// A value goes in once and never comes back out through any API: list() gives records with
// `hasValue`, and only the request path (resolve, from ai.ts httpRequest) reads values. Values are
// decrypted into this process's memory when the file loads, for that and for redacting tool output.
// The rules (names, hosts, injection) are secrets.mjs.

import { app, safeStorage } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import * as rules from './secrets.mjs';

const FILE = 'ai-secrets.json';

// Emits 'changed' when a secret is added, changed, used or removed.
export const events = new EventEmitter();

/** @type {Map<string, { rec: any, value: string | null }>} */
let secrets = new Map();
/** @type {Promise<void> | null} */
let loading = null;
/** @type {Promise<any>} */
let writes = Promise.resolve();

function filePath() {
  return path.join(app.getPath('userData'), FILE);
}

// Whether values can be kept encrypted here. Linux's 'basic_text' backend is a fixed key, not a
// keychain, so it counts as no.
export function encryptionStatus() {
  let available = false;
  let backend = null;
  try {
    available = safeStorage.isEncryptionAvailable();
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
      backend = safeStorage.getSelectedStorageBackend();
    }
  } catch {}
  const ok = available && backend !== 'basic_text' && backend !== 'unknown';
  return {
    ok,
    reason: ok
      ? null
      : 'This computer has no keychain Nomad can use, so secrets can’t be saved here. On Linux, install and unlock a keyring (GNOME Keyring or KWallet).',
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
      for (const s of Array.isArray(data?.secrets) ? data.secrets : []) {
        if (!rules.isSecretName(s?.name)) continue;
        const { value, ...rec } = s;
        let plain = null;
        if (value) {
          try {
            plain = safeStorage.decryptString(Buffer.from(value, 'base64'));
          } catch {
            plain = null; // a keychain that changed; the user sets it again
          }
        }
        next.set(rec.name, { rec, value: plain });
      }
      secrets = next;
    })();
  }
  return loading;
}

async function persist() {
  const list = [...secrets.values()].map(({ rec, value }) => ({
    ...rec,
    value: value ? safeStorage.encryptString(value).toString('base64') : null,
  }));
  const file = filePath();
  const tmp = file + '.tmp';
  await fs.promises.writeFile(tmp, JSON.stringify({ version: 1, secrets: list }, null, 2), { mode: 0o600 });
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

function view({ rec, value }) {
  return { ...rec, hasValue: !!value };
}

// Every secret, A to Z, without values.
export async function list() {
  await load();
  return [...secrets.values()].map(view).sort((a, b) => a.name.localeCompare(b.name));
}

export async function get(name) {
  await load();
  const s = secrets.get(name);
  return s ? view(s) : null;
}

// Add a secret or change one. `value`: a new value (replaces the old), or undefined/'' to keep it.
// A URL secret with no hosts takes its URL's host.
export function save(fields) {
  return serial(async () => {
    const { value, ...rest } = fields || {};
    const name = String(rest.name || '').trim().toUpperCase();
    const prev = secrets.get(name) || null;
    if (rest.create && prev) throw new Error(`There’s already a secret called ${name}`);
    const hasNew = typeof value === 'string' && value.trim() !== '';
    if (hasNew && !encryptionStatus().ok) throw new Error(encryptionStatus().reason);
    const fields2 = { ...rest };
    delete fields2.create;
    if (!prev && fields2.hosts === undefined && rules.normalizeInject(fields2.inject).in === 'url' && hasNew) {
      try {
        fields2.hosts = [new URL(value.trim()).hostname];
      } catch {}
    }
    const rec = rules.makeSecret(fields2, prev?.rec || null);
    let plain = prev?.value || null;
    if (hasNew) {
      plain = rules.checkValue(rec, value);
      rec.valueSetAt = new Date().toISOString();
      rec.valueSetBy = 'user';
    } else if (plain && rec.inject.in === 'url') {
      rules.checkValue(rec, plain); // new hosts must still cover the URL
    }
    secrets.set(rec.name, { rec, value: plain });
    await persist();
    events.emit('changed');
    return view({ rec, value: plain });
  });
}

export function remove(name) {
  return serial(async () => {
    if (!secrets.delete(name)) throw new Error(`No secret called ${name}`);
    await persist();
    events.emit('changed');
  });
}

// Let a Job use a secret on this computer, or stop it.
export function setJobGrant(name, jobId, allowed) {
  return serial(async () => {
    const s = secrets.get(name);
    if (!s) throw new Error(`No secret called ${name}`);
    const jobs = new Set(s.rec.jobs || []);
    if (allowed) jobs.add(jobId);
    else jobs.delete(jobId);
    s.rec = { ...s.rec, jobs: [...jobs] };
    await persist();
    events.emit('changed');
  });
}

// A deleted Job's grants go with it.
export function dropJob(jobId) {
  return serial(async () => {
    let changed = false;
    for (const s of secrets.values()) {
      if ((s.rec.jobs || []).includes(jobId)) {
        s.rec = { ...s.rec, jobs: s.rec.jobs.filter((id) => id !== jobId) };
        changed = true;
      }
    }
    if (changed) {
      await persist();
      events.emit('changed');
    }
  });
}

// The names a Job may use here.
export async function jobGrants(jobId) {
  await load();
  return [...secrets.values()].filter((s) => (s.rec.jobs || []).includes(jobId)).map((s) => s.rec.name);
}

// For the request path only (ai.ts httpRequest), after the turn's permission: the records with
// their values. Marks them used.
export async function resolve(names) {
  await load();
  const out = names.map((n) => {
    const s = secrets.get(n);
    if (!s) throw new Error(`No secret called ${n}. listSecrets lists them; the user adds one in My Library → Secrets.`);
    return { ...s.rec, value: s.value };
  });
  touch(names);
  return out;
}

function touch(names) {
  writes = writes
    .then(async () => {
      const at = new Date().toISOString();
      for (const n of names) {
        const s = secrets.get(n);
        if (s) s.rec = { ...s.rec, lastUsedAt: at };
      }
      await persist();
      events.emit('changed');
    })
    .catch(() => {});
}

// A value a response gave (httpRequest saveToSecret): a refreshed token. `by` is 'job' or 'ai'.
export function setValue(name, value, by) {
  return serial(async () => {
    const s = secrets.get(name);
    if (!s) throw new Error(`No secret called ${name}`);
    if (!encryptionStatus().ok) throw new Error(encryptionStatus().reason);
    const plain = rules.checkValue(s.rec, value);
    s.value = plain;
    s.rec = { ...s.rec, valueSetAt: new Date().toISOString(), valueSetBy: by };
    await persist();
    events.emit('changed');
  });
}

// Every value held here, for redacting tool output. Empty until the file has loaded.
export function knownValues() {
  return [...secrets.values()].filter((s) => s.value).map((s) => ({ name: s.rec.name, value: s.value }));
}
