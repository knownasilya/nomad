// nomad/shared/vouches.mjs
//
// Vouches (ADR-0045): one Persona says "I've had this person over at my home". A Vouch is a
// `walled.garden/vouch` record from one Profile Drive (the host) about another (the guest). The
// guest accepts it before it shows anywhere, and picks who sees it. The host stands behind it by
// listing its hash in their own Profile Drive; taking the hash out withdraws it. Anyone can check a
// Vouch with the record and the host's drive alone.
//
//   Profile Drives (public)
//     /.data/walled.garden/vouches-given.json  { type: 'walled.garden/vouch-index', v: 1, hashes }
//                                              the host's: hashes of the Vouches it stands behind
//     /.data/walled.garden/vouches.json        { type: 'walled.garden/vouches', v: 1, items }
//                                              the guest's: the Vouches it shows on its profile
//   The Vault (private)
//     /.vault/vouches-given/<personaId>/<id>.json
//         { type: 'nomad/vouch-given', vouch, createdAt, updatedAt, withdrawnAt? }
//     /.vault/vouches-held/<personaId>/<id>.json
//         { type: 'nomad/vouch-held', vouch, state: 'new' | 'accepted', shown: 'me' | 'sites' |
//           'profile', receivedAt, acceptedAt? }
//
// A Vouch travels to the guest inside a Persona Inbox Message (`message.vouch`, shared/inbox.mjs).
//
// Pure: no imports, so desktop (bg/ui/vouches.js), the phone (mobile/backend/lib/vouches.mjs) and
// shared/inbox.mjs share it. Hashing and random bytes come from the caller: the hash is
// `sha256hex(canonicalJSON(vouch))`, the hex sha256 of the UTF-8 bytes. tests/unit/vouches.test.js
// keeps a golden hash so desktop, the phone and third parties agree on the bytes.

export const VOUCH_TYPE = 'walled.garden/vouch';
export const INDEX_TYPE = 'walled.garden/vouch-index';
export const SHOWN_TYPE = 'walled.garden/vouches';
export const GIVEN_TYPE = 'nomad/vouch-given';
export const HELD_TYPE = 'nomad/vouch-held';

export const GIVEN_PREFIX = '/.vault/vouches-given/';
export const HELD_PREFIX = '/.vault/vouches-held/';
export const INDEX_PATH = '/.data/walled.garden/vouches-given.json';
export const PROFILE_PATH = '/.data/walled.garden/vouches.json';

export const KINDS = ['hosted'];
export const MAX_NOTE = 280;
export const DAY_MS = 24 * 60 * 60 * 1000;
// A Vouch lasts a year (§7); the host can renew it in the last month.
export const VALID_MS = 365 * DAY_MS;
export const RENEW_MS = 30 * DAY_MS;
// The most hashes an index or items a profile list is read with: a drive can't make a reader
// do unbounded work.
export const MAX_LIST = 1000;

// Where a guest shows an accepted Vouch (§5).
export const SHOWN = ['me', 'sites', 'profile'];
export const SHOWN_LABELS = {
  me: 'Only me',
  sites: 'To sites I log into',
  profile: 'On my profile',
};

// What a check says (§4). 'unreachable' is shown as "Couldn't check", never as valid.
export const STATES = ['valid', 'withdrawn', 'expired', 'unreachable', 'invalid'];

const HEX64 = /^[0-9a-f]{64}$/;
const PERSONA_ID = /^[a-z0-9]{8,40}$/;
const VOUCH_ID = /^[a-z2-7]{16,40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const FIELDS = new Set(['type', 'v', 'id', 'kind', 'host', 'guest', 'note', 'issuedAt', 'expiresAt']);

// Profile Drives
// =

// The key of a hyper:// URL, or null.
export function profileKeyOf(url) {
  const m = /^hyper:\/\/([0-9a-f]{64})(?:[/?#]|$)/i.exec(String(url || '').trim());
  return m ? m[1].toLowerCase() : null;
}

// "hyper://<key>/", or throws.
export function profileUrlOf(url) {
  const key = profileKeyOf(url);
  if (!key) throw new Error('A vouch is between two profile drives, like hyper://…/');
  return `hyper://${key}/`;
}

// Records
// =

// 16 random bytes, base32: 26 characters.
export function newVouchId(bytes) {
  if (!bytes || bytes.length < 16) throw new Error('A vouch id needs 16 random bytes');
  return base32(bytes.slice(0, 16));
}

// Plain text, one paragraph or a few lines, at most MAX_NOTE characters. Every Vouch has one: the
// host says in their own words why they vouch. Empty comes back undefined, which makeVouch refuses.
export function normalizeNote(note) {
  const s = String(note ?? '')
    .replace(/\r\n?/g, '\n')
    // Control characters other than newline.
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (s.length > MAX_NOTE) throw new Error(`A note can be at most ${MAX_NOTE} characters`);
  return s || undefined;
}

const iso = (t) => new Date(t).toISOString();
const ms = (t) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t));

/** @param {{ id: string, host: string, guest: string, note: string }} f @param {Date | string | number} [now] */
export function makeVouch({ id, host, guest, note }, now = new Date()) {
  const t = ms(now);
  const v = {
    type: VOUCH_TYPE,
    v: 1,
    id,
    kind: 'hosted',
    host: profileUrlOf(host),
    guest: profileUrlOf(guest),
    issuedAt: iso(t),
    expiresAt: iso(t + VALID_MS),
  };
  const n = normalizeNote(note);
  if (!n) throw new Error('Write a few words about them');
  v.note = n;
  const err = vouchError(v);
  if (err) throw new Error(err === 'to self' ? 'You can’t vouch for your own profile' : `Not a vouch: ${err}`);
  return v;
}

// Why a `walled.garden/vouch` isn't valid, or null. The same rules as its Zod schema
// (app/lib/schemas/walled.garden/vouch.ts), so a Device never keeps one another app would refuse.
export function vouchError(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'not an object';
  if (v.type !== VOUCH_TYPE) return 'wrong type';
  if (v.v !== 1) return 'wrong version';
  if (!VOUCH_ID.test(String(v.id || ''))) return 'bad id';
  if (!KINDS.includes(v.kind)) return 'bad kind';
  if (!profileKeyOf(v.host) || v.host !== `hyper://${profileKeyOf(v.host)}/`) return 'bad host';
  if (!profileKeyOf(v.guest) || v.guest !== `hyper://${profileKeyOf(v.guest)}/`) return 'bad guest';
  if (v.host === v.guest) return 'to self';
  if (typeof v.note !== 'string' || !v.note.trim() || v.note.length > MAX_NOTE) return 'bad note';
  if (!ISO.test(String(v.issuedAt || ''))) return 'bad issuedAt';
  if (!ISO.test(String(v.expiresAt || ''))) return 'bad expiresAt';
  const span = Date.parse(v.expiresAt) - Date.parse(v.issuedAt);
  if (!(span > 0) || span > VALID_MS) return 'bad expiresAt';
  for (const k of Object.keys(v)) if (!FIELDS.has(k)) return `unknown field ${k}`;
  return null;
}

export function isVouch(v) {
  return vouchError(v) === null;
}

// JSON with object keys sorted at every level: the bytes the hash covers.
export function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
}

// The hex sha256 of canonicalJSON(vouch), with the caller's `sha256hex(string)`.
export function vouchHash(vouch, sha256hex) {
  return String(sha256hex(canonicalJSON(vouch))).toLowerCase();
}

// Renewing (§7): the same id, new dates.
export function renewVouch(vouch, now = new Date()) {
  const t = ms(now);
  return { ...vouch, issuedAt: iso(t), expiresAt: iso(t + VALID_MS) };
}

export function isExpired(vouch, now = Date.now()) {
  return Date.parse(vouch?.expiresAt) <= ms(now);
}

// The host sees Renew in the last month.
export function renewDue(vouch, now = Date.now()) {
  return Date.parse(vouch?.expiresAt) - ms(now) <= RENEW_MS;
}

// The host's list (§4)
// =

export function makeIndex(hashes) {
  const list = [...new Set((hashes || []).map((h) => String(h).toLowerCase()).filter((h) => HEX64.test(h)))].sort();
  return { type: INDEX_TYPE, v: 1, hashes: list };
}

// The hashes an index lists, or null when it isn't one. A drive with no file has an empty list
// (pass `missing: true`); a drive nobody can read has no list at all (null).
export function indexHashes(index) {
  if (!index || index.type !== INDEX_TYPE || !Array.isArray(index.hashes)) return null;
  return index.hashes
    .slice(0, MAX_LIST)
    .map((h) => String(h).toLowerCase())
    .filter((h) => HEX64.test(h));
}

// Is this Vouch valid now? `index` is the host's `vouches-given.json` as read, `{ hashes: [] }` for
// a host drive that has none, and null when the host's drive couldn't be read.
//   'invalid'      not a vouch
//   'expired'      past expiresAt
//   'unreachable'  the host's drive couldn't be read: "Couldn't check"
//   'withdrawn'    the host no longer lists it
//   'valid'
export function verifyVouch(vouch, index, now, sha256hex) {
  if (!isVouch(vouch)) return 'invalid';
  if (isExpired(vouch, now ?? Date.now())) return 'expired';
  if (index == null) return 'unreachable';
  const hashes = Array.isArray(index) ? index : indexHashes(index);
  if (!hashes) return 'unreachable';
  return hashes.includes(vouchHash(vouch, sha256hex)) ? 'valid' : 'withdrawn';
}

// Vault records (§7)
// =

function personaId(id) {
  if (!PERSONA_ID.test(String(id || ''))) throw new Error('A vouch record needs a Persona');
  return id;
}

function vouchId(id) {
  if (!VOUCH_ID.test(String(id || ''))) throw new Error('A vouch record needs a vouch id');
  return id;
}

export const givenPrefix = (pid = null) => `${GIVEN_PREFIX}${pid ? `${personaId(pid)}/` : ''}`;
export const heldPrefix = (pid = null) => `${HELD_PREFIX}${pid ? `${personaId(pid)}/` : ''}`;
export const givenPath = (pid, id) => `${givenPrefix(pid)}${vouchId(id)}.json`;
export const heldPath = (pid, id) => `${heldPrefix(pid)}${vouchId(id)}.json`;

// { kind: 'given' | 'held', personaId, id } from a record path, or null.
export function parseRecordPath(path) {
  const m = /^\/\.vault\/vouches-(given|held)\/([a-z0-9]{8,40})\/([a-z2-7]{16,40})\.json$/.exec(String(path || ''));
  return m ? { kind: m[1], personaId: m[2], id: m[3] } : null;
}

export function makeGiven(vouch, prev = null, now = new Date()) {
  const t = iso(ms(now));
  return { type: GIVEN_TYPE, vouch, createdAt: prev?.createdAt || t, updatedAt: t };
}

export function isGiven(rec) {
  return !!(rec && rec.type === GIVEN_TYPE && isVouch(rec.vouch));
}

export function withdrawGiven(rec, now = new Date()) {
  const t = iso(ms(now));
  return { ...rec, updatedAt: t, withdrawnAt: t };
}

export function normalizeShown(shown) {
  if (!SHOWN.includes(shown)) throw new Error(`Show a vouch to ${SHOWN.join(', ')}`);
  return shown;
}

export function makeHeld(vouch, now = new Date()) {
  return { type: HELD_TYPE, vouch, state: 'new', shown: 'me', receivedAt: iso(ms(now)) };
}

export function isHeld(rec) {
  return !!(
    rec &&
    rec.type === HELD_TYPE &&
    isVouch(rec.vouch) &&
    (rec.state === 'new' || rec.state === 'accepted') &&
    SHOWN.includes(rec.shown)
  );
}

export function acceptHeld(rec, now = new Date()) {
  return { ...rec, state: 'accepted', acceptedAt: iso(ms(now)) };
}

// Only an accepted Vouch can be shown anywhere but to the guest.
export function setShown(rec, shown) {
  const s = normalizeShown(shown);
  if (rec.state !== 'accepted' && s !== 'me') throw new Error('Accept the vouch first');
  return { ...rec, shown: s };
}

// Taking Vouches in from Messages (§3.4)
// =

// What a Message record of the Inbox (shared/inbox.mjs `nomad/message-record`) delivers: the Vouch
// and the Persona it is for, or null. Only a received Message the Inbox has checked against its
// sender's profile counts, from the Vouch's own host, to the Persona the Vouch names.
// `personas`: [{ id, profileUrl }].
export function vouchFromMessage(record, personas = []) {
  if (!record || record.direction !== 'in' || record.verified === false) return null;
  const m = record.message;
  const v = m?.vouch;
  if (!v || !isVouch(v)) return null;
  const p = personas.find((x) => x.id === record.personaId);
  if (!p || profileKeyOf(p.profileUrl) !== profileKeyOf(v.guest)) return null;
  if (profileKeyOf(m.from) !== profileKeyOf(v.host) || profileKeyOf(m.to) !== profileKeyOf(v.guest)) return null;
  return { personaId: p.id, vouch: v };
}

// The mark a Message record gets once its Vouch was taken in, so declining or removing the Vouch
// doesn't bring it back the next time the Vault is read.
export function intakeMark(vouch) {
  return `${vouch.id}@${vouch.issuedAt}`;
}

// The held record to write for a Vouch that arrived, or null for no change:
//   none held           a new one ('new', shown only to the guest)
//   same id, same host  a renewal (§7): the newer record replaces it, keeping its state and where
//                       it's shown, without asking again
//   same id, other host ignored
export function mergeIncoming(prev, vouch, now = new Date()) {
  if (!isVouch(vouch)) return null;
  if (!isHeld(prev)) return makeHeld(vouch, now);
  if (prev.vouch.host !== vouch.host || prev.vouch.guest !== vouch.guest) return null;
  if (Date.parse(vouch.issuedAt) <= Date.parse(prev.vouch.issuedAt)) return null;
  return { ...prev, vouch };
}

// The guest's profile list (§5)
// =

export function makeShownList(vouches) {
  return { type: SHOWN_TYPE, v: 1, items: [...vouches].sort((a, b) => a.id.localeCompare(b.id)) };
}

// The Vouches a profile's `vouches.json` lists that are about that profile. Anything else (not a
// vouch, about someone else) is left out: a profile can't show a Vouch for another person.
export function shownItems(list, profileUrl) {
  if (!list || list.type !== SHOWN_TYPE || !Array.isArray(list.items)) return [];
  const key = profileKeyOf(profileUrl);
  const seen = new Set();
  return list.items.slice(0, MAX_LIST).filter((v) => {
    if (!isVouch(v) || profileKeyOf(v.guest) !== key || seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
}

// What a guest's held records put on their profile: the accepted ones shown there, not expired.
export function profileVouches(held, now = Date.now()) {
  return held
    .filter((r) => isHeld(r) && r.state === 'accepted' && r.shown === 'profile' && !isExpired(r.vouch, now))
    .map((r) => r.vouch);
}

// What the host's list should hold: every Vouch it gave and still stands behind.
export function standingHashes(given, sha256hex, now = Date.now()) {
  return given
    .filter((r) => isGiven(r) && !r.withdrawnAt && !isExpired(r.vouch, now))
    .map((r) => vouchHash(r.vouch, sha256hex));
}

// The guard (§4): hashes in the host's drive that none of its Devices wrote. Every Vouch this
// Persona ever gave counts as its own, withdrawn or not (a withdrawn hash still listed is put
// right, not reported).
export function foreignHashes(listed, given, sha256hex) {
  const own = new Set(given.filter(isGiven).map((r) => vouchHash(r.vouch, sha256hex)));
  return (listed || []).filter((h) => !own.has(h));
}

// Weight comes from the viewer (§6)
// =

// Split checked Vouches into those from people the viewer knows and the rest. `items`:
// [{ vouch, state, ... }]; `known`: profile keys or URLs the viewer knows (their Contacts, their
// Names that point at a Profile Drive, the Profile Drives they follow, their own Personas).
// Withdrawn, expired and invalid ones are dropped; 'unreachable' stays, to be shown as "Couldn't
// check". No totals: the caller shows the second group folded into one line.
export function groupForViewer(items, known = []) {
  const keys = new Set([...known].map((k) => profileKeyOf(k) || String(k).toLowerCase()));
  const out = { known: [], others: [] };
  for (const it of items || []) {
    if (it.state !== 'valid' && it.state !== 'unreachable') continue;
    (keys.has(profileKeyOf(it.vouch?.host)) ? out.known : out.others).push(it);
  }
  const order = (a, b) =>
    (a.state === 'valid' ? 0 : 1) - (b.state === 'valid' ? 0 : 1) ||
    String(b.vouch.issuedAt).localeCompare(String(a.vouch.issuedAt));
  out.known.sort(order);
  out.others.sort(order);
  return out;
}

// Sessions (§5)
// =

// The Vouches a Session shows a site: the ids the user ticked at login that it still holds,
// accepted and not expired. The site checks each one itself.
export function sessionVouches(ids, held, now = Date.now()) {
  const want = new Set(ids || []);
  return held
    .filter((r) => isHeld(r) && r.state === 'accepted' && want.has(r.vouch.id) && !isExpired(r.vouch, now))
    .map((r) => r.vouch);
}

// Lists
// =

export function sortHeld(list) {
  const rank = (r) => (r.state === 'new' ? 0 : 1);
  return [...list].sort(
    (a, b) => rank(a) - rank(b) || String(b.vouch.issuedAt).localeCompare(String(a.vouch.issuedAt))
  );
}

export function sortGiven(list) {
  return [...list].sort(
    (a, b) =>
      (a.withdrawnAt ? 1 : 0) - (b.withdrawnAt ? 1 : 0) ||
      String(b.vouch.issuedAt).localeCompare(String(a.vouch.issuedAt))
  );
}

// "hyper://abcdef…wxyz/": enough of the key to tell drives apart.
export function shortKey(url) {
  const key = profileKeyOf(url);
  return key ? `hyper://${key.slice(0, 6)}…${key.slice(-4)}/` : String(url || '');
}

// base32
// =

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

// RFC 4648 base32, lowercase, no padding.
export function base32(bytes) {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | (b & 0xff);
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
