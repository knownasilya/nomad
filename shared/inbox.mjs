// nomad/shared/inbox.mjs
//
// The Persona Inbox (ADR-0036): direct messages to a Persona, sealed to keys only the user's own
// Devices hold. This file is the rules: record paths, key derivation, the message link, the wire
// frame, the consent decision and the limits. The mailbox server and the outbox loop that use them
// are shared/inbox-engine.mjs.
//
//   /.vault/inbox/<personaId>.json
//       { type: 'nomad/inbox', personaId, seed, mode, sent?, createdAt, updatedAt,
//         rotatedAt?, previous?: { seed, until } }
//   /.vault/contacts/<personaId>/<sha256(profileKey)>.json
//       { type: 'nomad/contact', personaId, profileUrl, state: 'accepted' | 'blocked',
//         sign?, replyTo?: { box, mailboxes }, createdAt, updatedAt }
//   /.vault/messages/<personaId>/<conversationKey>/<createdAt>-<id>.json
//       { type: 'nomad/message-record', personaId, direction: 'in' | 'out', message,
//         status: 'queued' | 'delivered' | 'failed' | 'received', request?, verified?, sign?,
//         replyTo?, attempts?, nextAttemptAt?, deliveredAt?, readAt?, receivedAt? }
//
// Keys (§2, amended by spike S1). One 32-byte seed per Persona, in the Vault. From it:
//   sign     Ed25519   hash('nomad/inbox/sign/v1' ‖ seed)                 signs what this Persona sends
//   box      X25519    hash('nomad/inbox/box/v1' ‖ seed)                  senders seal to it
//   mailbox  Ed25519   hash('nomad/inbox/mailbox/v1' ‖ seed ‖ deviceKey)  one per Device (S1)
//
// Spike S1 found that several Devices listening on ONE HyperDHT key pair share one announce record
// per DHT node: a Device that closes cleanly unannounces the others, and one that dies leaves the
// key unreachable until another re-announces (about five minutes). So each Device listens on its own
// mailbox key, and the published inbox and every message link carry a short list of them.
//
// Pure: no imports, so desktop (bg/hyper/inbox.js) and the phone (mobile/backend/lib/inbox.mjs)
// share it byte for byte. Hashing, key pairs, signatures and sealed boxes come from the caller as a
// `crypto` object (see inbox-crypto in each runtime):
//   { hash(bytes) -> 32 bytes, signKeyPair(seed32), boxKeyPair(seed32),
//     sign(msg, secretKey) -> 64 bytes, verify(sig, msg, publicKey) -> bool,
//     seal(msg, boxPublicKey) -> bytes, unseal(bytes, boxPublicKey, boxSecretKey) -> bytes | null }

export const INBOX_PREFIX = '/.vault/inbox/';
export const INBOX_TYPE = 'nomad/inbox';
export const CONTACTS_PREFIX = '/.vault/contacts/';
export const CONTACT_TYPE = 'nomad/contact';
export const MESSAGES_PREFIX = '/.vault/messages/';
export const RECORD_TYPE = 'nomad/message-record';
export const MESSAGE_TYPE = 'walled.garden/message';

// The HyperDHT protocol name, and the context the signature binds.
export const PROTOCOL = 'nomad/inbox/1';
export const SIG_CONTEXT = 'nomad/inbox/v1';

export const MODES = ['off', 'link', 'anyone'];
export const MODE_LABELS = {
  off: 'Off',
  link: 'People I give a link to',
  anyone: 'Anyone, as requests',
};

export const MAX_TEXT = 8000;
export const MAX_FRAME = 64 * 1024;
export const MAX_REQUESTS = 200;
export const MAX_MAILBOXES = 8;
export const ADDRESS_PER_HOUR = 30;
export const STRANGERS_PER_MINUTE = 10;
export const REQUEST_CHECK_MS = 7 * 24 * 60 * 60 * 1000;
export const PREVIOUS_KEEP_MS = 14 * 24 * 60 * 60 * 1000;
export const OUTBOX_MS = 30 * 24 * 60 * 60 * 1000;
// Outbox retries: right away, then backing off to every 30 minutes (§4). The short first steps
// cover the five minutes a dead Device's announce can linger (spike S1).
export const RETRY_STEPS_MS = [0, 15e3, 60e3, 2 * 60e3, 5 * 60e3, 10 * 60e3, 30 * 60e3];

const HEX64 = /^[0-9a-f]{64}$/;
const PERSONA_ID = /^[a-z0-9]{8,40}$/;
const MESSAGE_ID = /^[a-z2-7]{16,40}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

// Bytes and text
// =

const te = new TextEncoder();
const td = new TextDecoder();

export function utf8(s) {
  return te.encode(String(s));
}

export function fromUtf8(b) {
  return td.decode(b);
}

export function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex) {
  const s = String(hex || '');
  if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error('Not hex');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function isHex64(s) {
  return HEX64.test(String(s || ''));
}

// JSON with object keys sorted at every level: the bytes a signature covers.
export function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
}

// Keys (§2)
// =

export function deriveLabel(use) {
  return `nomad/inbox/${use}/v1`;
}

// The 32-byte seed for one use of the inbox seed. `extra` is the Device key for a mailbox.
export function deriveSeed(seed, use, crypto, extra = null) {
  const s = typeof seed === 'string' ? fromHex(seed) : seed;
  if (!s || s.length !== 32) throw new Error('An inbox seed is 32 bytes');
  const parts = [utf8(deriveLabel(use)), s];
  if (extra) parts.push(typeof extra === 'string' ? fromHex(extra) : extra);
  return crypto.hash(concat(...parts));
}

// The sign and box key pairs of a seed, and one mailbox key pair per Device key given.
export function inboxKeys(seed, crypto, deviceKeys = []) {
  const sign = crypto.signKeyPair(deriveSeed(seed, 'sign', crypto));
  const box = crypto.boxKeyPair(deriveSeed(seed, 'box', crypto));
  const mailboxes = deviceKeys.filter(isHex64).map((device) => ({
    device,
    keyPair: crypto.signKeyPair(deriveSeed(seed, 'mailbox', crypto, device)),
  }));
  return { sign, box, mailboxes };
}

// The public halves, as hex.
export function publicKeys(keys) {
  return {
    sign: toHex(keys.sign.publicKey),
    box: toHex(keys.box.publicKey),
    mailboxes: keys.mailboxes.map((m) => toHex(m.keyPair.publicKey)),
  };
}

// Records
// =

export function inboxPath(personaId) {
  if (!PERSONA_ID.test(String(personaId || ''))) throw new Error('An inbox needs a Persona');
  return `${INBOX_PREFIX}${personaId}.json`;
}

export function normalizeMode(mode) {
  const m = String(mode || 'off');
  if (!MODES.includes(m)) throw new Error(`An inbox mode is one of ${MODES.join(', ')}`);
  return m;
}

// A new Inbox: a seed (32 random bytes from the caller) and a mode.
export function makeInbox({ personaId, seed, mode = 'off' }, now = new Date().toISOString()) {
  inboxPath(personaId);
  const s = seed instanceof Uint8Array ? toHex(seed) : String(seed || '');
  if (!isHex64(s)) throw new Error('An inbox seed is 32 bytes');
  return {
    type: INBOX_TYPE,
    personaId,
    seed: s,
    mode: normalizeMode(mode),
    createdAt: now,
    updatedAt: now,
  };
}

export function isInbox(rec) {
  return !!(
    rec &&
    rec.type === INBOX_TYPE &&
    PERSONA_ID.test(String(rec.personaId || '')) &&
    isHex64(rec.seed) &&
    MODES.includes(rec.mode)
  );
}

export function setMode(rec, mode, now = new Date().toISOString()) {
  return { ...rec, mode: normalizeMode(mode), updatedAt: now };
}

// The Persona has sent a Message: from now on its `sign` key is published even in Off mode (§3.3).
export function markSent(rec, now = new Date().toISOString()) {
  return rec.sent ? rec : { ...rec, sent: true, updatedAt: now };
}

// Change inbox address (§2): a new seed; the old one opens Messages already on their way for 14 days.
export function rotateInbox(rec, seed, now = new Date().toISOString()) {
  const s = seed instanceof Uint8Array ? toHex(seed) : String(seed || '');
  if (!isHex64(s)) throw new Error('An inbox seed is 32 bytes');
  const until = new Date(Date.parse(now) + PREVIOUS_KEEP_MS).toISOString();
  return {
    ...rec,
    seed: s,
    rotatedAt: now,
    updatedAt: now,
    previous: { seed: rec.seed, until },
  };
}

// The seeds that still open Messages: the current one, and the previous one until it lapses.
export function liveSeeds(rec, now = Date.now()) {
  const out = [rec.seed];
  if (rec.previous?.seed && Date.parse(rec.previous.until) > now) out.push(rec.previous.seed);
  return out;
}

// Drop a lapsed `previous` (returns the record unchanged when there's nothing to forget).
export function forgetLapsed(rec, now = Date.now()) {
  if (!rec.previous || Date.parse(rec.previous.until) > now) return rec;
  const { previous: _gone, ...rest } = rec;
  return rest;
}

// What the Persona's Profile Drive publishes as `inbox` (§3), or null for nothing.
//   off     `sign` once the Persona has sent a Message
//   link    `sign`
//   anyone  `sign`, `box` and the mailboxes
export function publishedInbox(rec, pub) {
  if (!rec) return null;
  if (rec.mode === 'anyone')
    return { v: 1, sign: pub.sign, box: pub.box, mailboxes: pub.mailboxes.slice(0, MAX_MAILBOXES) };
  if (rec.mode === 'link' || rec.sent) return { v: 1, sign: pub.sign };
  return null;
}

// Does the `inbox` a Profile Drive publishes match what this Device derives from the Vault (§7.3)?
//   'ok'       it matches
//   'update'   it's ours but out of date (a mode change, a new Device): rewrite it
//   'changed'  a sign or box key that isn't ours: someone changed the inbox address. Stop.
// `known` is every public key set the Vault's seeds give (current, and previous while it lives).
export function checkPublished(published, wanted, known = []) {
  const same = (a, b) => canonicalJSON(a ?? null) === canonicalJSON(b ?? null);
  if (same(published, wanted)) return 'ok';
  if (!published || typeof published !== 'object') return 'update';
  const signs = new Set(known.map((k) => k.sign));
  const boxes = new Set(known.map((k) => k.box));
  if (published.sign && !signs.has(String(published.sign))) return 'changed';
  if (published.box && !boxes.has(String(published.box))) return 'changed';
  return 'update';
}

// Contacts
// =

export function contactsPrefix(personaId) {
  return `${CONTACTS_PREFIX}${personaId}/`;
}

// `profileHash` is the hex sha256 of the contact's Profile Drive key.
export function contactPath(personaId, profileHash) {
  if (!PERSONA_ID.test(String(personaId || '')) || !isHex64(profileHash))
    throw new Error('A contact needs a Persona and a profile');
  return `${contactsPrefix(personaId)}${profileHash}.json`;
}

export function profileKeyOf(url) {
  const m = /^hyper:\/\/([0-9a-f]{64})(?:[/?#]|$)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : null;
}

export function profileUrlOf(url) {
  const key = profileKeyOf(url);
  if (!key) throw new Error('A profile is a hyper://…/ drive');
  return `hyper://${key}/`;
}

export function normalizeReplyTo(r) {
  if (!r || typeof r !== 'object' || !isHex64(r.box)) return null;
  const mailboxes = (Array.isArray(r.mailboxes) ? r.mailboxes : [])
    .map((m) => String(m).toLowerCase())
    .filter(isHex64);
  if (!mailboxes.length) return null;
  return {
    box: String(r.box).toLowerCase(),
    mailboxes: [...new Set(mailboxes)].slice(0, MAX_MAILBOXES),
  };
}

export function makeContact(
  { personaId, profileUrl, state = 'accepted', sign, replyTo },
  prev = null,
  now = new Date().toISOString()
) {
  if (!['accepted', 'blocked'].includes(state)) throw new Error('A contact is accepted or blocked');
  const rec = {
    type: CONTACT_TYPE,
    personaId: prev?.personaId || personaId,
    profileUrl: profileUrlOf(prev?.profileUrl || profileUrl),
    state,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
  const s = sign ?? prev?.sign;
  if (isHex64(s)) rec.sign = s;
  const r = normalizeReplyTo(replyTo) || normalizeReplyTo(prev?.replyTo);
  if (r) rec.replyTo = r;
  if (!PERSONA_ID.test(String(rec.personaId || ''))) throw new Error('A contact needs a Persona');
  return rec;
}

export function isContact(rec) {
  return !!(
    rec &&
    rec.type === CONTACT_TYPE &&
    PERSONA_ID.test(String(rec.personaId || '')) &&
    profileKeyOf(rec.profileUrl) &&
    (rec.state === 'accepted' || rec.state === 'blocked')
  );
}

// Messages (§5)
// =

// 16 random bytes, base32: 26 characters.
export function newMessageId(bytes) {
  if (!bytes || bytes.length < 16) throw new Error('A message id needs 16 random bytes');
  return base32(bytes.slice(0, 16));
}

export function normalizeText(text) {
  const s = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    // Control characters other than tab and newline.
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim();
  if (!s) throw new Error('Write something first');
  if (s.length > MAX_TEXT) throw new Error(`A message can be at most ${MAX_TEXT} characters`);
  return s;
}

/** @param {{ id: string, from: string, to: string, text: string, inReplyTo?: string }} f */
export function makeMessage({ id, from, to, text, inReplyTo }, now = new Date().toISOString()) {
  const m = {
    type: MESSAGE_TYPE,
    id,
    from: profileUrlOf(from),
    to: profileUrlOf(to),
    createdAt: now,
    text: normalizeText(text),
  };
  if (inReplyTo) m.inReplyTo = String(inReplyTo);
  const err = messageError(m);
  if (err) throw new Error(err);
  return m;
}

// Why a `walled.garden/message` isn't valid, or null. The same rules as its Zod schema
// (app/lib/schemas/walled.garden/message.ts), so a Device never stores one another app would refuse.
export function messageError(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return 'not an object';
  if (m.type !== MESSAGE_TYPE) return 'wrong type';
  if (!MESSAGE_ID.test(String(m.id || ''))) return 'bad id';
  if (!profileKeyOf(m.from) || m.from !== profileUrlOf(m.from)) return 'bad from';
  if (!profileKeyOf(m.to) || m.to !== profileUrlOf(m.to)) return 'bad to';
  if (m.from === m.to) return 'to self';
  if (!ISO.test(String(m.createdAt || ''))) return 'bad createdAt';
  if (typeof m.text !== 'string' || !m.text.length || m.text.length > MAX_TEXT) return 'bad text';
  if (m.inReplyTo !== undefined && (typeof m.inReplyTo !== 'string' || m.inReplyTo.length > 40))
    return 'bad inReplyTo';
  const allowed = new Set(['type', 'id', 'from', 'to', 'createdAt', 'text', 'inReplyTo']);
  for (const k of Object.keys(m)) if (!allowed.has(k)) return `unknown field ${k}`;
  return null;
}

// sha256(sort([myProfileKey, theirProfileKey]).join(':')) — `sha256hex` from the caller.
export function conversationKeyInput(a, b) {
  return [profileKeyOf(a), profileKeyOf(b)].sort().join(':');
}

export function messagesPrefix(personaId, conversationKey = null) {
  return `${MESSAGES_PREFIX}${personaId}/${conversationKey ? `${conversationKey}/` : ''}`;
}

export function messagePath(personaId, conversationKey, message) {
  if (!PERSONA_ID.test(String(personaId || '')) || !isHex64(conversationKey))
    throw new Error('A message record needs a Persona and a conversation');
  return `${messagesPrefix(personaId, conversationKey)}${message.createdAt}-${message.id}.json`;
}

export function parseMessagePath(path) {
  const m =
    /^\/\.vault\/messages\/([a-z0-9]{8,40})\/([0-9a-f]{64})\/(.+)-([a-z2-7]{16,40})\.json$/.exec(
      String(path || '')
    );
  return m ? { personaId: m[1], conversationKey: m[2], createdAt: m[3], id: m[4] } : null;
}

export function makeRecord(fields) {
  const rec = { type: RECORD_TYPE, ...fields };
  if (!['in', 'out'].includes(rec.direction)) throw new Error('A record is in or out');
  return rec;
}

export function isRecord(rec) {
  return !!(
    rec &&
    rec.type === RECORD_TYPE &&
    (rec.direction === 'in' || rec.direction === 'out') &&
    !messageError(rec.message)
  );
}

// The message link (§3.1)
// =

// nomad://messages/new?to=hyper://<profile>/&box=<hex>&mailbox=<hex>[&mailbox=<hex>…]
export function messageLink({ profileUrl, box, mailboxes }) {
  const r = normalizeReplyTo({ box, mailboxes });
  if (!r) throw new Error('A message link needs the inbox keys');
  const q = [`to=${encodeURIComponent(profileUrlOf(profileUrl))}`, `box=${r.box}`];
  for (const m of r.mailboxes) q.push(`mailbox=${m}`);
  return `nomad://messages/new?${q.join('&')}`;
}

// { profileUrl, replyTo } from a message link, or null.
export function parseMessageLink(link) {
  let u;
  try {
    u = new URL(String(link || '').trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'nomad:' || u.hostname !== 'messages' || !/^\/new\/?$/.test(u.pathname))
    return null;
  const to = profileKeyOf(u.searchParams.get('to'));
  if (!to) return null;
  const replyTo = normalizeReplyTo({
    box: u.searchParams.get('box'),
    mailboxes: u.searchParams.getAll('mailbox'),
  });
  return { profileUrl: `hyper://${to}/`, replyTo };
}

// The wire (§4)
// =
//
// Each direction carries one frame, length-prefixed (4 bytes, big-endian):
//   sender -> mailbox   [ 0x01 version ][ sealed bytes ]
//   mailbox -> sender   [ 0x01 version ][ 0x01 ok ]
// `sealed` is crypto_box_seal to the recipient's box key of the UTF-8 JSON
//   { message, sig, sign, replyTo, invite? }
// where `sig` is Ed25519 by the sender's sign key over
//   'nomad/inbox/v1' ‖ recipientBox ‖ canonicalJSON(message).

export const VERSION = 1;
export const ACK = new Uint8Array([VERSION, 1]);

export function lengthPrefix(payload) {
  const out = new Uint8Array(4 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length, false);
  out.set(payload, 4);
  return out;
}

// Collects stream chunks into length-prefixed frames. `push(chunk)` returns the frames completed;
// it throws when a frame claims more than `max` bytes, before any of it is buffered.
export function frameReader(max = MAX_FRAME) {
  let buf = new Uint8Array(0);
  return {
    push(chunk) {
      buf = concat(buf, chunk);
      const frames = [];
      while (buf.length >= 4) {
        const len = new DataView(buf.buffer, buf.byteOffset, 4).getUint32(0, false);
        if (len > max) throw new Error('Frame too large');
        if (buf.length < 4 + len) break;
        frames.push(buf.slice(4, 4 + len));
        buf = buf.slice(4 + len);
      }
      if (buf.length > max + 4) throw new Error('Frame too large');
      return frames;
    },
  };
}

export function encodeFrame(sealed) {
  if (sealed.length + 1 > MAX_FRAME) throw new Error('Message too large');
  return concat(new Uint8Array([VERSION]), sealed);
}

export function decodeFrame(frame) {
  if (!frame || frame.length < 2 || frame.length > MAX_FRAME) throw new Error('Bad frame');
  if (frame[0] !== VERSION) throw new Error('Unknown frame version');
  return frame.slice(1);
}

export function isAck(frame) {
  return !!frame && frame.length === 2 && frame[0] === VERSION && frame[1] === 1;
}

export function signedBytes(message, recipientBox) {
  const box = typeof recipientBox === 'string' ? fromHex(recipientBox) : recipientBox;
  return concat(utf8(SIG_CONTEXT), box, utf8(canonicalJSON(message)));
}

// Seal a Message to the recipient. `sign` is the sender's sign key pair; `replyTo` the sender's own
// { box, mailboxes }; `invite` an invite id (ADR-0040) or nothing.
/** @param {{ message: any, sign: any, recipientBox: any, replyTo?: any, invite?: string }} o @param {any} crypto */
export function sealMessage({ message, sign, recipientBox, replyTo, invite }, crypto) {
  const err = messageError(message);
  if (err) throw new Error(`Not a message: ${err}`);
  const box = typeof recipientBox === 'string' ? fromHex(recipientBox) : recipientBox;
  const sig = crypto.sign(signedBytes(message, box), sign.secretKey);
  const body = { message, sig: toHex(sig), sign: toHex(sign.publicKey) };
  const r = normalizeReplyTo(replyTo);
  if (r) body.replyTo = r;
  if (invite) body.invite = String(invite);
  return crypto.seal(utf8(JSON.stringify(body)), box);
}

// Open a sealed frame with any of `boxes` (the current box key pair, and the previous one while it
// lives) and check the signature. Returns { message, sign, replyTo, invite } or null. A null tells
// the mailbox to drop it; the sender still gets the same ack (§6.4).
export function openSealed(sealed, boxes, crypto) {
  for (const box of boxes) {
    let plain;
    try {
      plain = crypto.unseal(sealed, box.publicKey, box.secretKey);
    } catch {
      plain = null;
    }
    if (!plain) continue;
    let body;
    try {
      body = JSON.parse(fromUtf8(plain));
    } catch {
      return null;
    }
    if (!body || typeof body !== 'object' || messageError(body.message)) return null;
    if (!isHex64(body.sign) || !/^[0-9a-f]{128}$/.test(String(body.sig || ''))) return null;
    const ok = crypto.verify(
      fromHex(body.sig),
      signedBytes(body.message, box.publicKey),
      fromHex(body.sign)
    );
    if (!ok) return null;
    return {
      message: body.message,
      sign: body.sign,
      replyTo: normalizeReplyTo(body.replyTo),
      invite: typeof body.invite === 'string' ? body.invite.slice(0, 64) : null,
    };
  }
  return null;
}

// Consent (§3, §6)
// =

// Where an opened Message goes:
//   'inbox'    from an accepted Contact whose sign key matches (or isn't known yet)
//   'request'  from someone who isn't a Contact, when the mode lets strangers ask
//   'check'    from a Contact whose sign key changed: hold as a request until the profile says so
//   'drop'     blocked, Off to strangers, a second request while one waits, or too many
/** @param {{ contact?: any, mode?: string, sign?: string, pendingFromSender?: boolean }} [o] */
export function classify({ contact = null, mode = 'off', sign, pendingFromSender = false } = {}) {
  if (contact?.state === 'blocked') return 'drop';
  if (contact?.state === 'accepted') {
    if (contact.sign && sign && contact.sign !== sign) return 'check';
    return 'inbox';
  }
  if (mode === 'off') return 'drop';
  if (pendingFromSender) return 'drop';
  return 'request';
}

// Requests past MAX_REQUESTS: the oldest go. `requests` are records; returns the ones to delete.
export function requestsToPrune(requests, max = MAX_REQUESTS) {
  const sorted = [...requests].sort((a, b) =>
    String(b.receivedAt || b.message?.createdAt).localeCompare(
      String(a.receivedAt || a.message?.createdAt)
    )
  );
  return sorted.slice(max);
}

// A request that can't be checked against its sender's profile in 7 days is dropped (§6.3).
export function uncheckedExpired(rec, now = Date.now()) {
  return (
    !!rec?.request &&
    rec.verified === false &&
    now - Date.parse(rec.receivedAt || rec.message?.createdAt) > REQUEST_CHECK_MS
  );
}

// Rate limits at the mailbox (§6.2): per remote address, before decryption; and strangers overall,
// after. In memory, per mailbox server.
export function rateLimiter({
  perAddressHour = ADDRESS_PER_HOUR,
  strangersPerMinute = STRANGERS_PER_MINUTE,
} = {}) {
  const byAddress = new Map(); // address -> [times]
  let strangers = [];
  const trim = (list, since) => list.filter((t) => t > since);
  return {
    address(addr, now = Date.now()) {
      const key = String(addr || '?');
      const list = trim(byAddress.get(key) || [], now - 60 * 60 * 1000);
      if (list.length >= perAddressHour) {
        byAddress.set(key, list);
        return false;
      }
      list.push(now);
      byAddress.set(key, list);
      if (byAddress.size > 5000) byAddress.delete(byAddress.keys().next().value);
      return true;
    },
    stranger(now = Date.now()) {
      strangers = trim(strangers, now - 60 * 1000);
      if (strangers.length >= strangersPerMinute) return false;
      strangers.push(now);
      return true;
    },
  };
}

// The outbox (§4)
// =

export function retryDelay(attempts) {
  return RETRY_STEPS_MS[Math.min(attempts, RETRY_STEPS_MS.length - 1)];
}

// Is a queued record due for another try?
export function outboxDue(rec, now = Date.now()) {
  if (rec?.direction !== 'out' || rec.status !== 'queued') return false;
  return !rec.nextAttemptAt || Date.parse(rec.nextAttemptAt) <= now;
}

// After a try: delivered, or queued for the next one, or failed after 30 days.
export function afterAttempt(rec, delivered, now = Date.now()) {
  const at = new Date(now).toISOString();
  if (delivered) {
    const { nextAttemptAt: _n, ...rest } = rec;
    return { ...rest, status: 'delivered', deliveredAt: at, attempts: (rec.attempts || 0) + 1 };
  }
  const attempts = (rec.attempts || 0) + 1;
  if (now - Date.parse(rec.message.createdAt) > OUTBOX_MS) {
    const { nextAttemptAt: _n, ...rest } = rec;
    return { ...rest, status: 'failed', attempts };
  }
  return {
    ...rec,
    attempts,
    lastAttemptAt: at,
    nextAttemptAt: new Date(now + retryDelay(attempts)).toISOString(),
  };
}

// Try again now (a network change, the app starting, the user pressing Retry).
export function retryNow(rec) {
  if (rec.direction !== 'out' || (rec.status !== 'queued' && rec.status !== 'failed')) return rec;
  const { nextAttemptAt: _n, ...r } = rec;
  return { ...r, status: 'queued', ...(rec.status === 'failed' ? { attempts: 0 } : {}) };
}

// Conversations for a list
// =

// Records grouped into Conversations, newest first:
//   { conversationKey, personaId, other (profile URL), last, unread, request, count }
export function conversations(records) {
  const by = new Map();
  for (const r of records) {
    if (!isRecord(r)) continue;
    const other = r.direction === 'in' ? r.message.from : r.message.to;
    const key = `${r.personaId}:${other}`;
    let c = by.get(key);
    if (!c) {
      c = { personaId: r.personaId, other, last: null, unread: 0, request: true, count: 0 };
      by.set(key, c);
    }
    c.count++;
    if (!c.last || r.message.createdAt > c.last.message.createdAt) c.last = r;
    if (r.direction === 'in' && !r.readAt) c.unread++;
    if (!r.request) c.request = false;
  }
  return [...by.values()].sort((a, b) =>
    String(b.last.message.createdAt).localeCompare(String(a.last.message.createdAt))
  );
}

// A Conversation's records, oldest first.
export function sortThread(records) {
  return [...records]
    .filter(isRecord)
    .sort(
      (a, b) =>
        String(a.message.createdAt).localeCompare(String(b.message.createdAt)) ||
        a.message.id.localeCompare(b.message.id)
    );
}

// A short way to show a profile key: "abcdef…wxyz".
export function shortKey(url) {
  const key = profileKeyOf(url);
  return key ? `${key.slice(0, 6)}…${key.slice(-4)}` : '';
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

// The `crypto` object from a libsodium binding (sodium-universal / sodium-native), passed in so this
// file keeps no imports. hash is BLAKE2b-256 (crypto_generichash), the same as hypercore-crypto.
export function cryptoFromSodium(sodium) {
  const pair = (seed, kind) => {
    const pk = new Uint8Array(32);
    const sk = new Uint8Array(kind === 'sign' ? 64 : 32);
    if (kind === 'sign') sodium.crypto_sign_seed_keypair(pk, sk, seed);
    else sodium.crypto_box_seed_keypair(pk, sk, seed);
    return { publicKey: pk, secretKey: sk };
  };
  return {
    hash(bytes) {
      const out = new Uint8Array(32);
      sodium.crypto_generichash(out, bytes);
      return out;
    },
    signKeyPair: (seed) => pair(seed, 'sign'),
    boxKeyPair: (seed) => pair(seed, 'box'),
    sign(msg, secretKey) {
      const sig = new Uint8Array(64);
      sodium.crypto_sign_detached(sig, msg, secretKey);
      return sig;
    },
    verify(sig, msg, publicKey) {
      try {
        return sodium.crypto_sign_verify_detached(sig, msg, publicKey);
      } catch {
        return false;
      }
    },
    seal(msg, publicKey) {
      const out = new Uint8Array(msg.length + sodium.crypto_box_SEALBYTES);
      sodium.crypto_box_seal(out, msg, publicKey);
      return out;
    },
    unseal(cipher, publicKey, secretKey) {
      if (cipher.length < sodium.crypto_box_SEALBYTES) return null;
      const out = new Uint8Array(cipher.length - sodium.crypto_box_SEALBYTES);
      try {
        return sodium.crypto_box_seal_open(out, cipher, publicKey, secretKey) ? out : null;
      } catch {
        return null;
      }
    },
  };
}

// Notifications on a Device that learns of Messages through the Vault (the phone, ADR-0036 §9):
// new Messages from Contacts received after `since` (an ISO time, the newest receivedAt already
// shown). Never a request, never an unchecked one, never one already read. The first time (no
// `since`) nothing older shows. Returns { notify: records, since }.
export function pendingNotifications(records, since = null) {
  const shown = (r) =>
    isRecord(r) && r.direction === 'in' && !r.request && r.verified !== false && !r.readAt;
  const all = records.filter((r) => isRecord(r) && r.direction === 'in' && r.receivedAt);
  const newest = all.reduce((m, r) => (r.receivedAt > m ? r.receivedAt : m), since || '');
  if (!since) return { notify: [], since: newest || new Date(0).toISOString() };
  const notify = all
    .filter((r) => shown(r) && r.receivedAt > since)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  return { notify, since: newest };
}
