// Invite links to edit one drive. The owner makes a link, `hyper://<key>/?invite=<token>`; whoever
// opens it in Nomad and accepts sends the token with their writer request (the `nomad/autobase-control`
// channel, app/bg/hyper/autobases.js), and any Device that can write the drive adds them at once.
//
// The drive keeps only the token's SHA-256, as an inline record at INVITES_PREFIX + <hash>.json, so
// every Device that writes the drive can check a token, the record syncs and outlives a restart, and
// the owner can cancel it. A reader of the drive sees the hash, never the token. A link works once
// unless it was made `multiUse`, and stops working after `expiresAt`.
//
// Pure rules (no I/O, no crypto: the caller hashes). Tests: tests/unit/drive-invites.test.js.

export const INVITES_PREFIX = '/.data/nomad/invites/';
export const INVITE_TYPE = 'nomad/drive-invite';
export const INVITE_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export const isInviteToken = (t) => typeof t === 'string' && HEX32.test(t);
export const isInviteId = (h) => typeof h === 'string' && HEX64.test(h);

// Where the record for a token whose SHA-256 is `id` lives.
export function invitePath(id) {
  if (!isInviteId(id)) throw new Error('Bad invite id');
  return `${INVITES_PREFIX}${id}.json`;
}

// The id a record path names, or null.
export function inviteIdOf(path) {
  const m = /\/([0-9a-f]{64})\.json$/.exec(String(path || ''));
  return m && String(path).startsWith(INVITES_PREFIX) ? m[1] : null;
}

/**
 * The record for a new link.
 * @param {{ now?: number, days?: number, multiUse?: boolean, by?: string | null, note?: string }} [opts]
 */
export function makeInvite({ now = Date.now(), days = INVITE_DAYS, multiUse = false, by = null, note = '' } = {}) {
  const d = Math.min(Math.max(Number(days) || INVITE_DAYS, 1), 30);
  const rec = {
    type: INVITE_TYPE,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + d * DAY).toISOString(),
    multiUse: !!multiUse,
  };
  if (typeof by === 'string' && HEX64.test(by)) rec.by = by;
  const n = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (n) rec.note = n;
  return rec;
}

// Whether a record still lets someone in.
export function inviteUsable(rec, now = Date.now()) {
  if (!rec || rec.type !== INVITE_TYPE) return false;
  const exp = Date.parse(rec.expiresAt);
  return Number.isFinite(exp) && exp > now;
}

// The link for `driveUrl` and `token`.
export function inviteUrl(driveUrl, token) {
  const m = /^hyper:\/\/([0-9a-f]{64})/i.exec(String(driveUrl || ''));
  if (!m || !isInviteToken(token)) throw new Error('Bad drive invite');
  return `hyper://${m[1].toLowerCase()}/?invite=${token}`;
}

// { key, token } when `url` is a drive invite link (any path; `invite` in its query), else null.
export function parseInviteUrl(url) {
  let u;
  try {
    u = new URL(String(url || ''));
  } catch {
    return null;
  }
  if (u.protocol !== 'hyper:' || !HEX64.test(u.hostname.toLowerCase())) return null;
  const token = u.searchParams.get('invite');
  return isInviteToken(token) ? { key: u.hostname.toLowerCase(), token } : null;
}

// The open links of a drive from its records ([{ path, value }]), newest first, without the
// expired ones: [{ id, createdAt, expiresAt, multiUse, note? }].
export function openInvites(records, now = Date.now()) {
  const out = [];
  for (const { path, value } of records || []) {
    const id = inviteIdOf(path);
    if (!id || !inviteUsable(value, now)) continue;
    out.push({
      id,
      createdAt: value.createdAt,
      expiresAt: value.expiresAt,
      multiUse: !!value.multiUse,
      ...(value.note ? { note: value.note } : {}),
    });
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * The drive's writers for the Editors list, this Device first, then the user's other Devices, then
 * everyone else: [{ writerKey, profileUrl, you, device? }]. `self` is this Device's writer key for the
 * drive; `grants` are the Vault's writer grants for it (shared/drive-writers.mjs), which name the
 * user's own Devices.
 * @param {{ writerKey: string, profileUrl?: string | null }[]} writers
 * @param {{ self?: string | null, grants?: { drive?: string, writerKey: string, name?: string }[] }} [opts]
 */
export function editorRows(writers, { self = null, grants = [] } = {}) {
  const names = new Map();
  for (const g of grants || []) if (g && HEX64.test(String(g.writerKey))) names.set(g.writerKey, g.name || 'Your device');
  const seen = new Set();
  const rows = [];
  for (const w of writers || []) {
    if (!w || !HEX64.test(String(w.writerKey)) || seen.has(w.writerKey)) continue;
    seen.add(w.writerKey);
    const row = { writerKey: w.writerKey, profileUrl: w.profileUrl || null, you: w.writerKey === self };
    if (names.has(w.writerKey)) row.device = names.get(w.writerKey);
    rows.push(row);
  }
  const rank = (r) => (r.you ? 0 : r.device ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b));
}
