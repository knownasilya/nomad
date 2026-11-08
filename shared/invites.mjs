// nomad/shared/invites.mjs
//
// Invite links (ADR-0040): an ordinary https link that brings a friend into one of the user's
// shared Spaces, even before they have Nomad. Everything the invite carries is in the URL fragment,
// so the site that serves the page (nomad.pages.dev, on Cloudflare Pages) never sees it.
//
//   https://nomad.pages.dev/invite/#<base64url(payload)>      opens anywhere
//   nomad-invite:<base64url(payload)>                          opens Nomad (desktop and Android)
//
// The payload (version 1), bytes in order:
//   0      version, 1
//   1      kind: 1 invite, 2 profile link
//   2      flags: 1 from (a Persona), 2 messaging, 4 space, 8 signed
//   3..18  id, 16 random bytes
//   4 B    expiresAt, Unix seconds (big-endian); 0 for none
//   from:  32 B Profile Drive key, then the Persona's title (1 B length, UTF-8, at most 64 characters)
//   messaging: 32 B box key, 1 B count, 32 B per mailbox key (ADR-0036 §3.1)
//   space: the blind-pairing code (2 B length, ASCII z32), the Space's name (1 B length, UTF-8),
//          its role (1 editor, 2 viewer)
//   sig:   64 B Ed25519 by the Persona's `sign` key over 'nomad/invite/v1' ‖ every byte above
//
// Pure and self-contained (no imports), because the invite page on nomad.pages.dev uses a copy of this file to
// read the fragment (static/invite/invites.mjs there). Runs on the phone's Bare worklet too, which
// has no TextEncoder, atob or Buffer, so the UTF-8 and base64 here are by hand when those are missing.
//
// Invite records, so every one of the user's Devices knows an invite and can answer its join:
//   /.vault/invites/<id>.json
//     { type: 'nomad/invite', id, kind: 'invite', personaId?, space: { space, library, publicKey,
//       role, name }, device?, createdAt, expiresAt, usedAt?, usedBy?, revokedAt? }
// `publicKey` is the blind-pairing invite's public key (hex), which isn't secret: it lets a Device
// that manages the Space Library match a join to this invite. The code itself is only in the link.

export const VERSION = 1;
export const LINK_BASE = 'https://nomad.pages.dev/invite/';
export const SCHEME = 'nomad-invite:';
export const SIG_CONTEXT = 'nomad/invite/v1';
export const RECORD_TYPE = 'nomad/invite';
export const INVITES_PREFIX = '/.vault/invites/';
export const EXPIRY_DAYS = [1, 7, 14, 30];
export const DEFAULT_EXPIRY_DAYS = 14;
export const MAX_NAME = 64;
export const MAX_SPACE_NAME = 80;
export const MAX_MAILBOXES = 8;

const KINDS = { 1: 'invite', 2: 'profile' };
const KIND_BYTE = { invite: 1, profile: 2 };
const ROLES = { 1: 'editor', 2: 'viewer' };
const ROLE_BYTE = { editor: 1, viewer: 2 };
const F_FROM = 1;
const F_MESSAGING = 2;
const F_SPACE = 4;
const F_SIGNED = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

// Bytes and text
// =

const te = typeof TextEncoder === 'function' ? new TextEncoder() : null;
const td = typeof TextDecoder === 'function' ? new TextDecoder() : null;

export function utf8(s) {
  s = String(s);
  if (te) return te.encode(s);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

export function fromUtf8(b) {
  if (td) return td.decode(b);
  let s = '';
  for (let i = 0; i < b.length; ) {
    const x = b[i];
    let c;
    let n;
    if (x < 0x80) [c, n] = [x, 0];
    else if (x >= 0xc2 && x <= 0xdf) [c, n] = [x & 31, 1];
    else if (x >= 0xe0 && x <= 0xef) [c, n] = [x & 15, 2];
    else if (x >= 0xf0 && x <= 0xf4) [c, n] = [x & 7, 3];
    else {
      s += '�';
      i++;
      continue;
    }
    let ok = true;
    for (let k = 1; ok && k <= n; k++) {
      const y = b[i + k];
      if (y === undefined || (y & 0xc0) !== 0x80) ok = false;
      else c = (c << 6) | (y & 63);
    }
    if (!ok) {
      s += '�';
      i++;
      continue;
    }
    s += String.fromCodePoint(c);
    i += n + 1;
  }
  return s;
}

export function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex) {
  const s = String(hex || '');
  if (!/^([0-9a-f]{2})*$/i.test(s)) throw new Error('Not hex');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const isKey = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) s += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) s += B64[n & 63];
  }
  return s;
}

export function fromBase64Url(text) {
  const s = String(text || '')
    .trim()
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error('Not base64');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let at = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n =
      (B64.indexOf(s[i]) << 18) |
      (B64.indexOf(s[i + 1]) << 12) |
      ((s[i + 2] ? B64.indexOf(s[i + 2]) : 0) << 6) |
      (s[i + 3] ? B64.indexOf(s[i + 3]) : 0);
    out[at++] = (n >> 16) & 255;
    if (s[i + 2]) out[at++] = (n >> 8) & 255;
    if (s[i + 3]) out[at++] = n & 255;
  }
  return out;
}

// Writing and reading the payload
// =

function shortText(s, max) {
  // Cut on characters, then make sure the bytes fit one length byte.
  let t = [...String(s ?? '').trim()].slice(0, max).join('');
  let b = utf8(t);
  while (b.length > 255) {
    t = [...t].slice(0, -1).join('');
    b = utf8(t);
  }
  return b;
}

// The bytes a signature covers, and the unsigned payload. `invite`:
//   { kind?: 'invite' | 'profile', id: hex (32 chars), expiresAt?: ISO, from?: hex key, name?,
//     messaging?: { box: hex, mailboxes: hex[] }, space?: { code, name, role } }
export function encodeBody(invite) {
  const kind = invite.kind || 'invite';
  if (!KIND_BYTE[kind]) throw new Error('An invite is an invite or a profile link');
  const id = fromHex(invite.id);
  if (id.length !== 16) throw new Error('An invite id is 16 bytes');
  let flags = 0;
  const parts = [];
  if (invite.from) {
    if (!isKey(invite.from)) throw new Error('An invite comes from a Profile Drive key');
    flags |= F_FROM;
    const name = shortText(invite.name, MAX_NAME);
    parts.push(fromHex(invite.from), Uint8Array.of(name.length), name);
  }
  if (invite.messaging) {
    const { box, mailboxes = [] } = invite.messaging;
    if (!isKey(box) || !mailboxes.every(isKey)) throw new Error('Not message-link keys');
    const list = mailboxes.slice(0, MAX_MAILBOXES);
    flags |= F_MESSAGING;
    parts.push(fromHex(box), Uint8Array.of(list.length), ...list.map(fromHex));
  }
  if (invite.space) {
    const code = String(invite.space.code || '').trim();
    if (!/^[a-z0-9]{8,2000}$/.test(code)) throw new Error('A Space invite needs its code');
    if (!ROLE_BYTE[invite.space.role]) throw new Error('A Space invite is Can edit or Can view');
    flags |= F_SPACE;
    const codeBytes = utf8(code);
    const name = shortText(invite.space.name || 'Space', MAX_SPACE_NAME);
    parts.push(
      Uint8Array.of(codeBytes.length >> 8, codeBytes.length & 255),
      codeBytes,
      Uint8Array.of(name.length),
      name,
      Uint8Array.of(ROLE_BYTE[invite.space.role])
    );
  }
  if (kind === 'invite' && !invite.space && !invite.messaging) throw new Error('An invite offers a Space or messages');
  const secs = invite.expiresAt ? Math.floor(Date.parse(invite.expiresAt) / 1000) : 0;
  if (!Number.isFinite(secs) || secs < 0 || secs > 0xffffffff) throw new Error('Not an expiry: ' + invite.expiresAt);
  const exp = Uint8Array.of((secs >>> 24) & 255, (secs >>> 16) & 255, (secs >>> 8) & 255, secs & 255);
  return concat(Uint8Array.of(VERSION, KIND_BYTE[kind], flags | (invite.signed ? F_SIGNED : 0)), id, exp, ...parts);
}

// What a signature is over: the context and the payload's body (which says it is signed).
export function signedBytes(body) {
  return concat(utf8(SIG_CONTEXT), body);
}

// The whole payload. `sign(bytes) -> 64-byte signature` when the invite is from a Persona; without
// it the invite isn't signed (and carries no `from`, ADR-0040 §2).
export function encodeInvite(invite, sign = null) {
  if (!sign) {
    const { from: _f, name: _n, ...rest } = invite;
    return encodeBody({ ...rest, signed: false });
  }
  if (!invite.from) throw new Error('A signed invite names the Profile Drive it comes from');
  const body = encodeBody({ ...invite, signed: true });
  const sig = sign(signedBytes(body));
  if (!sig || sig.length !== 64) throw new Error('A signature is 64 bytes');
  return concat(body, sig);
}

// Read a payload. Throws a sentence for anything that isn't one.
export function decodeInvite(bytes) {
  const bad = () => new Error('This isn’t a whole invite link. Copy it again, all of it.');
  let at = 0;
  const take = (n) => {
    if (at + n > bytes.length) throw bad();
    const out = bytes.subarray(at, at + n);
    at += n;
    return out;
  };
  const byte = () => take(1)[0];
  const v = byte();
  if (v !== VERSION) throw new Error('This invite is from a newer Nomad. Update Nomad, then open it again.');
  const kind = KINDS[byte()];
  if (!kind) throw bad();
  const flags = byte();
  const id = toHex(take(16));
  const e = take(4);
  const secs = ((e[0] << 24) >>> 0) + (e[1] << 16) + (e[2] << 8) + e[3];
  const out = { v, kind, id, expiresAt: secs ? new Date(secs * 1000).toISOString() : null, signed: !!(flags & F_SIGNED) };
  if (flags & F_FROM) {
    out.from = toHex(take(32));
    out.name = fromUtf8(take(byte()));
  }
  if (flags & F_MESSAGING) {
    const box = toHex(take(32));
    const n = byte();
    const mailboxes = [];
    for (let i = 0; i < n; i++) mailboxes.push(toHex(take(32)));
    out.messaging = { box, mailboxes };
  }
  if (flags & F_SPACE) {
    const len = (byte() << 8) | byte();
    const code = fromUtf8(take(len));
    const name = fromUtf8(take(byte()));
    const role = ROLES[byte()];
    if (!role || !/^[a-z0-9]+$/.test(code)) throw bad();
    out.space = { code, name, role };
  }
  out.body = bytes.slice(0, at);
  if (out.signed) {
    if (!out.from) throw bad();
    out.sig = bytes.slice(at, at + 64);
    if (out.sig.length !== 64) throw bad();
    at += 64;
  }
  if (at !== bytes.length) throw bad();
  if (kind === 'invite' && !out.space && !out.messaging) throw bad();
  return out;
}

// Links
// =

export function linkOf(payload) {
  return LINK_BASE + '#' + toBase64Url(payload);
}

export function schemeLinkOf(payload) {
  return SCHEME + toBase64Url(payload);
}

// The base64url payload in anything a person might paste or tap: the https link (with or without
// `www.` or a trailing slash), the nomad-invite: link, or the payload alone. Null for other text.
export function payloadText(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith(SCHEME)) return s.slice(SCHEME.length).replace(/^\/+/, '');
  const m = s.match(/^https?:\/\/(?:www\.)?nomad\.pages\.dev\/invite\/?(?:index\.html)?\/?#(.+)$/i);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{40,}$/.test(s)) return s;
  return null;
}

// Is this text an invite link (not a bare code)?
export function isInviteLink(input) {
  const s = String(input || '').trim().toLowerCase();
  return s.startsWith(SCHEME) || /^https?:\/\/(?:www\.)?nomad\.pages\.dev\/invite\b/.test(s);
}

// Read an invite from a link. Throws a sentence when it isn't one.
export function parseInviteLink(input) {
  const text = payloadText(input);
  if (!text) throw new Error('That isn’t an invite link');
  let bytes;
  try {
    bytes = fromBase64Url(text);
  } catch {
    throw new Error('This isn’t a whole invite link. Copy it again, all of it.');
  }
  return decodeInvite(bytes);
}

// Checks
// =

export function isExpired(invite, now = Date.now()) {
  return !!invite?.expiresAt && Date.parse(invite.expiresAt) <= now;
}

// Check a signed invite against the `sign` key its Profile Drive publishes (hex), with the caller's
// `verify(sig, msg, publicKey) -> bool`. 'ok', 'bad' (changed since it was signed), 'unknown' (no
// key to check against yet) or 'unsigned'.
export function signatureState(invite, publishedSign, verify) {
  if (!invite?.signed) return 'unsigned';
  if (!isKey(publishedSign)) return 'unknown';
  try {
    return verify(invite.sig, signedBytes(invite.body), fromHex(publishedSign)) ? 'ok' : 'bad';
  } catch {
    return 'bad';
  }
}

// When a new invite runs out: `days` from now, one of EXPIRY_DAYS.
export function expiryOf(days, now = Date.now()) {
  const d = EXPIRY_DAYS.includes(Number(days)) ? Number(days) : DEFAULT_EXPIRY_DAYS;
  // Whole seconds, as the link carries them.
  return new Date(Math.floor((now + d * DAY_MS) / 1000) * 1000).toISOString();
}

// What the friend sees: "Ilya invited you to join Home. You'll be able to edit."
export function describeInvite(invite) {
  const who = invite.from && invite.name ? invite.name : 'Someone';
  if (invite.space) {
    const can = invite.space.role === 'editor' ? 'edit' : 'view';
    return {
      title: `${who} invited you to join ${invite.space.name || 'a Space'}`,
      role: `You’ll be able to ${can} everything in it.`,
    };
  }
  return { title: `${who} invited you to Nomad`, role: '' };
}

// Records
// =

const ID_RE = /^[0-9a-f]{32}$/;
export const isInviteId = (id) => typeof id === 'string' && ID_RE.test(id);

export function invitePath(id) {
  if (!isInviteId(id)) throw new Error('Not an invite id: ' + id);
  return INVITES_PREFIX + id + '.json';
}

// A Space invite's record. `space`: { space (Root Drive key), library, publicKey, role, name }.
export function makeInviteRecord({ id, personaId, space, device, expiresAt, signed }, now = new Date().toISOString()) {
  if (!isInviteId(id)) throw new Error('Not an invite id: ' + id);
  if (!space || !isKey(space.space) || !isKey(space.library) || !isKey(space.publicKey))
    throw new Error('A Space invite names its Space, Library and invite key');
  if (!ROLE_BYTE[space.role]) throw new Error('A Space invite is Can edit or Can view');
  const rec = {
    type: RECORD_TYPE,
    id,
    kind: 'invite',
    space: {
      space: space.space,
      library: space.library,
      publicKey: space.publicKey,
      role: space.role,
      name: [...String(space.name || 'Space')].slice(0, MAX_SPACE_NAME).join(''),
    },
    createdAt: now,
    expiresAt: expiresAt || null,
    signed: !!signed,
  };
  if (personaId) rec.personaId = String(personaId);
  if (isKey(device)) rec.device = device;
  return rec;
}

export function isInviteRecord(rec) {
  return (
    !!rec &&
    rec.type === RECORD_TYPE &&
    isInviteId(rec.id) &&
    !!rec.space &&
    isKey(rec.space.library) &&
    isKey(rec.space.publicKey) &&
    !!ROLE_BYTE[rec.space.role]
  );
}

// 'open' | 'used' | 'expired' | 'revoked'
export function recordState(rec, now = Date.now()) {
  if (rec.revokedAt) return 'revoked';
  if (rec.usedAt) return 'used';
  if (rec.expiresAt && Date.parse(rec.expiresAt) <= now) return 'expired';
  return 'open';
}

// The open invites a join to Space Library `library` can match.
export function openInvitesFor(records, library, now = Date.now()) {
  return (records || []).filter(
    (r) => isInviteRecord(r) && r.space.library === library && recordState(r, now) === 'open'
  );
}

// Used up by the first person an owner approves. The earlier `usedAt` wins when two Devices race.
/** @param {any} rec @param {{ name?: string, profileUrl?: string }} [by] */
export function markUsed(rec, { name, profileUrl } = {}, now = new Date().toISOString()) {
  if (rec.usedAt && rec.usedAt <= now) return rec;
  const out = { ...rec, usedAt: now };
  const by = {};
  if (name) by.name = [...String(name)].slice(0, 60).join('');
  if (profileUrl) by.profileUrl = String(profileUrl).slice(0, 200);
  if (Object.keys(by).length) out.usedBy = by;
  return out;
}

export function markRevoked(rec, now = new Date().toISOString()) {
  return rec.revokedAt ? rec : { ...rec, revokedAt: now };
}

// Records older than this after they stop being open are dropped from the list.
export const KEEP_CLOSED_MS = 30 * DAY_MS;

// What the invites list shows for one Space, newest first, and which records can go.
export function listFor(records, space, now = Date.now()) {
  const shown = [];
  const stale = [];
  for (const r of records || []) {
    if (!isInviteRecord(r) || (space && r.space.space !== space)) continue;
    const state = recordState(r, now);
    const closedAt = r.revokedAt || r.usedAt || (state === 'expired' ? r.expiresAt : null);
    if (state !== 'open' && closedAt && now - Date.parse(closedAt) > KEEP_CLOSED_MS) stale.push(r.id);
    else shown.push({ ...r, state });
  }
  shown.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { shown, stale };
}
