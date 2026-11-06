// Always-on Peers (ADR-0038): a headless Nomad the user runs on a machine that stays on (a NAS, a
// home server, a small VPS). It keeps a full copy of what the Vault says it should hold and serves
// it, so the user's Devices and the people in their shared Spaces sync through it while laptops
// sleep and phones are in pockets. It never writes: it is no drive's Writer and not the Vault's.
//
// The rules here are shared by desktop (app/bg/hyper/vault.js addPeer, the Devices page), the phone
// (mobile/backend, the Devices screen) and the Peer itself (peer/holdings.mjs). Tests:
// tests/unit/peers.test.js.
//
// No bare imports, and nothing touched as the module loads that Bare lacks.

export const PEER_TYPE = 'nomad/peer';
export const PEERS_PREFIX = '/.vault/peers/';
export const PEER_PLATFORM = 'peer';
// The version of these rules a Peer reports, so a Device can say "Update the Peer" (ADR-0038 §9).
export const PEERS_VERSION = 1;
export const KINDS = ['own', 'blind'];

const KEY_RE = /^[0-9a-f]{64}$/;
export const isKey = (k) => typeof k === 'string' && KEY_RE.test(k);

export function peerPath(key) {
  if (!isKey(key)) throw new Error('Not a Peer key: ' + key);
  return PEERS_PREFIX + key + '.json';
}

// What a Peer of `kind` holds by default (ADR-0038 §5). An Own Peer holds everything; a Blind
// Peer only what is public anyway.
export function defaultHold(kind = 'own') {
  if (kind === 'blind') return { vault: false, spaces: [], drives: 'public', profiles: true };
  return { vault: true, spaces: 'all', drives: 'all', profiles: true };
}

// A hold as stored: `spaces` is 'all' or a list of Root Drive keys; `drives` is 'all', 'public' or
// a list of drive keys. A Blind Peer can never hold the Vault or a Space: they aren't encrypted.
export function normalizeHold(hold, kind = 'own') {
  const d = defaultHold(kind);
  const h = hold && typeof hold === 'object' ? hold : {};
  const keys = (v, all) => (v === 'all' && all ? 'all' : Array.isArray(v) ? [...new Set(v.filter(isKey))].slice(0, 500) : null);
  const out = {
    vault: kind === 'blind' ? false : h.vault === undefined ? d.vault : !!h.vault,
    spaces: kind === 'blind' ? [] : keys(h.spaces, true) ?? d.spaces,
    drives: h.drives === 'public' ? 'public' : keys(h.drives, kind !== 'blind') ?? d.drives,
    profiles: h.profiles === undefined ? d.profiles : !!h.profiles,
  };
  return out;
}

/**
 * The Vault record of a Peer. `addedBy` is the Device that approved it; an edit keeps it.
 * @param {{ key: string, name?: string, kind?: string, addedBy?: string | null, hold?: any }} f
 */
export function makePeer(f, prev = null, now = new Date().toISOString()) {
  if (!isKey(f.key)) throw new Error('Not a Peer key: ' + f.key);
  const kind = KINDS.includes(f.kind) ? f.kind : prev?.kind || 'own';
  return {
    type: PEER_TYPE,
    key: f.key,
    name: String(f.name ?? prev?.name ?? 'Always-on Peer').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Always-on Peer',
    kind,
    addedAt: prev?.addedAt || now,
    addedBy: prev ? prev.addedBy || null : isKey(f.addedBy) ? f.addedBy : null,
    hold: normalizeHold(f.hold ?? prev?.hold, kind),
    updatedAt: now,
  };
}

export function isPeer(rec) {
  return !!rec && rec.type === PEER_TYPE && isKey(rec.key) && KINDS.includes(rec.kind);
}

// Whether the Peer keeps Space `rootDriveKey` (its Root Drive, its Library and their drives).
export function holdsSpace(peer, rootDriveKey) {
  const h = normalizeHold(peer?.hold, peer?.kind);
  return h.spaces === 'all' || (Array.isArray(h.spaces) && h.spaces.includes(rootDriveKey));
}

// The same hold with Space `rootDriveKey` kept or not. `allSpaces` lists every Space's key, so
// turning one off out of 'all' keeps the rest.
export function withSpace(peer, rootDriveKey, on, allSpaces = []) {
  const h = normalizeHold(peer?.hold, peer?.kind);
  const now = /** @type {string[]} */ (h.spaces === 'all' ? allSpaces.filter(isKey) : h.spaces);
  /** @type {string[] | 'all'} */
  let next = on ? [...new Set([...now, rootDriveKey])] : now.filter((k) => k !== rootDriveKey);
  if (allSpaces.length && allSpaces.every((k) => next.includes(k))) next = 'all';
  return { ...h, spaces: next };
}

/**
 * What a Peer mirrors in full: [{ key, type: 'autobase' | 'hyperdrive', what, space? }].
 *   what: 'vault' | 'space' (a Root Drive) | 'library' (a Space Library) | 'drive' | 'profile'
 * @param {any} peer the Vault record
 * @param {{ vaultKey: string, spaces?: any[], registries?: Record<string, any[]>, personas?: any[] }} world
 *   spaces: the Vault's Space records ({ rootDriveKey, library?, shared?, movedTo?, removed? });
 *   registries: each Space's Drive Registry entries ({ key, type?, public? }) by Root Drive key;
 *   personas: Persona records ({ profileUrl }).
 */
export function holdingsOf(peer, { vaultKey, spaces = [], registries = {}, personas = [] }) {
  if (!isPeer(peer)) return [];
  const h = normalizeHold(peer.hold, peer.kind);
  const out = new Map();
  const add = (key, type, what, space = null) => {
    if (!isKey(key) || out.has(key)) return;
    out.set(key, space ? { key, type, what, space } : { key, type, what });
  };
  if (h.vault && peer.kind === 'own') add(vaultKey, 'autobase', 'vault');
  for (const s of spaces) {
    const root = s?.rootDriveKey;
    if (!isKey(root) || s.removed || s.movedTo || s.deleted) continue;
    const keep = peer.kind === 'own' && (h.spaces === 'all' || h.spaces.includes(root));
    if (keep) {
      add(root, 'autobase', 'space', root);
      if (isKey(s.library)) add(s.library, 'autobase', 'library', root);
    }
    for (const d of registries[root] || []) {
      if (!d || !isKey(d.key)) continue;
      const wanted = h.drives === 'all' ? keep : h.drives === 'public' ? !!d.public && (keep || peer.kind === 'blind') : h.drives.includes(d.key);
      if (wanted) add(d.key, d.type === 'autobase' ? 'autobase' : 'hyperdrive', 'drive', root);
    }
  }
  if (h.profiles) {
    for (const p of personas) {
      const m = /^hyper:\/\/([0-9a-f]{64})\/?$/.exec(String(p?.profileUrl || ''));
      if (m) add(m[1], 'autobase', 'profile');
    }
  }
  return [...out.values()];
}

// The status a Peer sends in its presence HELLO (shared/device-presence.mjs): a display hint, never
// stored. Anything malformed is dropped, so a bad frame can't break a Device's page.
export function makeStatus({ version = '', startedAt = 0, holding = 0, synced = 0, bytes = 0, freeBytes = null, behind = 0, now = Date.now() } = {}) {
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);
  return {
    kind: PEER_PLATFORM,
    rules: PEERS_VERSION,
    version: String(version).slice(0, 40),
    uptime: startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0,
    holding: n(holding),
    synced: n(synced),
    behind: n(behind),
    bytes: n(bytes),
    freeBytes: freeBytes == null ? null : n(freeBytes),
  };
}

export function readStatus(obj) {
  if (!obj || typeof obj !== 'object' || obj.kind !== PEER_PLATFORM) return null;
  const st = makeStatus(obj);
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);
  return { ...st, uptime: n(obj.uptime), rules: n(obj.rules) };
}

// A size in words: "1.4 GB".
export function bytesText(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x >= 10 ? Math.round(x) : x.toFixed(1)} ${units[i]}`;
}

// What a Peer row says under its name: "Online · 12 of 14 synced · 3.2 GB", or when it was added.
export function describePeer(peer, status, { online = false } = {}) {
  if (!online || !status) return 'Offline';
  const parts = ['Online'];
  if (status.holding) parts.push(status.synced >= status.holding ? `${status.holding} kept in sync` : `${status.synced} of ${status.holding} synced`);
  if (status.bytes) parts.push(bytesText(status.bytes));
  if (status.rules && status.rules < PEERS_VERSION) parts.push('Update the Peer');
  return parts.join(' · ');
}
