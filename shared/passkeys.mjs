// Passkeys (ADR-0049): the rules for the WebAuthn passkeys Nomad keeps for websites. Nomad is the
// authenticator itself, a software one in the browser: a page's navigator.credentials.create() and
// .get() go to Nomad's own prompt (fg/webview-preload/passkeys.js, bg/ui/passkeys.js), and Nomad makes
// and signs with an ES256 (P-256) key that never leaves this computer (bg/passkeys/store.js).
//
// This module is the pure part, with no crypto and no I/O: which pages can use passkeys and with which
// RP ID, the options a page passes, and the bytes WebAuthn needs (clientDataJSON, authenticator data,
// the COSE key, the "none" attestation object). bg hashes and signs. It runs on Node and is kept safe
// for the phone's Bare worklet (no Buffer, TextEncoder or btoa globals: plain JS below), for later.

// A Nomad AAGUID, so a site that shows "made with" names Nomad. Attestation is always "none".
export const AAGUID_HEX = '6e6f6d61-6400-4f61-8b65-7973706b6579'.replace(/-/g, '');

export const ES256 = -7;

// Authenticator data flags (WebAuthn §6.1). BE/BS stay 0: a Nomad passkey is on one computer, never
// backed up or synced (the user chose this computer's keychain, ADR-0049 §2).
export const FLAG_UP = 0x01;
export const FLAG_UV = 0x04;
export const FLAG_BE = 0x08;
export const FLAG_BS = 0x10;
export const FLAG_AT = 0x40;

export const MAX_CHALLENGE = 1024;
export const MIN_CHALLENGE = 16;
export const MAX_USER_ID = 64;
export const MAX_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_TIMEOUT_MS = 5 * 60_000;

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

// base64url
// =

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toB64url(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < b.length) out += B64[(n >> 6) & 63];
    if (i + 2 < b.length) out += B64[n & 63];
  }
  return out;
}

export function fromB64url(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str) || str.length % 4 === 1)
    throw new PasskeyError('TypeError', 'Bad base64url');
  const out = new Uint8Array(Math.floor((str.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let j = 0;
  for (let i = 0; i < str.length; i++) {
    acc = (acc << 6) | B64.indexOf(str[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

export function utf8(str) {
  const s = String(str);
  const out = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

// An error a page sees as a DOMException with this name (NotAllowedError, SecurityError, …).
export class PasskeyError extends Error {
  constructor(name, message) {
    super(message);
    this.domName = name;
  }
}

// Which pages, which RP ID
// =

// The page's origin and host when it can use Nomad's passkeys: https, or http on this computer (as
// browsers allow, for developing a site). Anything else (hyper://, nomad://, file:, http) can't.
export function pageOrigin(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const local = u.protocol === 'http:' && LOCAL_HOSTS.includes(u.hostname);
  if (u.protocol !== 'https:' && !local) return null;
  if (!u.hostname) return null;
  return { origin: u.origin, host: u.hostname.toLowerCase() };
}

function isIp(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
}

// The RP ID a page may use (WebAuthn §5.1.3 step 8, §5.1.4.1 step 7): its own host, or a domain above
// it that is still someone's own (not a public suffix like co.uk or github.io). `registrable(host)`
// gives the host's registrable domain from the Public Suffix List, private section included (as
// Chromium does), or null. Throws a SecurityError otherwise.
export function checkRpId(rpId, host, registrable) {
  const h = String(host || '').toLowerCase();
  const id = rpId === undefined || rpId === null || rpId === '' ? h : String(rpId).toLowerCase();
  if (id === h && (LOCAL_HOSTS.includes(h) || id === 'localhost')) return id;
  if (isIp(h) || isIp(id)) throw new PasskeyError('SecurityError', 'Passkeys need a domain name, not an IP address');
  if (id !== h && !h.endsWith('.' + id))
    throw new PasskeyError('SecurityError', `This page (${h}) can’t use passkeys for ${id}`);
  const reg = registrable(h);
  if (!reg || (id !== reg && !id.endsWith('.' + reg)))
    throw new PasskeyError('SecurityError', `${id} is a public suffix, not a site`);
  return id;
}

// Options from the page
// =
// The page's shim (fg/webview-preload/passkeys.js) sends the publicKey options with every buffer as
// base64url. These check them and keep only what Nomad uses.

function bytesField(v, what, min, max) {
  if (typeof v !== 'string') throw new PasskeyError('TypeError', `${what} is missing`);
  const b = fromB64url(v);
  if (b.length < min || b.length > max) throw new PasskeyError('TypeError', `${what} has the wrong length`);
  return v;
}

function text(v, max = 256) {
  const s = [...String(v ?? '')].filter((ch) => ch.charCodeAt(0) >= 0x20 && ch !== '\u007f').join('');
  return s.trim().slice(0, max);
}

function timeoutOf(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(n, 30_000), MAX_TIMEOUT_MS);
}

function credList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && (c.type === undefined || c.type === 'public-key') && typeof c.id === 'string')
    .slice(0, 64)
    .map((c) => {
      try {
        return toB64url(fromB64url(c.id)); // normalized
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const UV = ['required', 'preferred', 'discouraged'];

export function normalizeCreateOptions(pk) {
  const o = pk && typeof pk === 'object' ? pk : {};
  const params = Array.isArray(o.pubKeyCredParams) ? o.pubKeyCredParams : [];
  // An empty list means ES256 and RS256 (§5.1.3 step 10); Nomad only makes ES256.
  if (params.length && !params.some((p) => p && p.type === 'public-key' && Number(p.alg) === ES256))
    throw new PasskeyError('NotSupportedError', 'This site wants a kind of key Nomad doesn’t make (only ES256)');
  const user = o.user && typeof o.user === 'object' ? o.user : {};
  const sel = o.authenticatorSelection && typeof o.authenticatorSelection === 'object' ? o.authenticatorSelection : {};
  const name = text(user.name);
  return {
    challenge: bytesField(o.challenge, 'challenge', MIN_CHALLENGE, MAX_CHALLENGE),
    rp: { id: o.rp?.id === undefined ? undefined : String(o.rp.id), name: text(o.rp?.name) },
    user: {
      id: bytesField(user.id, 'user.id', 1, MAX_USER_ID),
      name,
      displayName: text(user.displayName) || name,
    },
    excludeCredentials: credList(o.excludeCredentials),
    // Nomad is a platform authenticator; a site that asks only for a security key or phone gets the
    // computer's own WebAuthn instead (the caller falls back).
    crossPlatformOnly: sel.authenticatorAttachment === 'cross-platform',
    userVerification: UV.includes(sel.userVerification) ? sel.userVerification : 'preferred',
    timeout: timeoutOf(o.timeout),
    credProps: !!o.extensions?.credProps,
  };
}

export function normalizeGetOptions(pk) {
  const o = pk && typeof pk === 'object' ? pk : {};
  return {
    challenge: bytesField(o.challenge, 'challenge', MIN_CHALLENGE, MAX_CHALLENGE),
    rpId: o.rpId === undefined ? undefined : String(o.rpId),
    allowCredentials: credList(o.allowCredentials),
    userVerification: UV.includes(o.userVerification) ? o.userVerification : 'preferred',
    timeout: timeoutOf(o.timeout),
  };
}

// Records
// =
// One passkey, as bg/passkeys/store.js keeps it (its private key is kept beside it, encrypted).

export function makePasskey(f) {
  const now = new Date().toISOString();
  return {
    id: String(f.id), // the credential ID, base64url
    rpId: String(f.rpId),
    rpName: text(f.rpName),
    userId: String(f.userId), // base64url, the site's handle for the account
    userName: text(f.userName),
    displayName: text(f.displayName),
    origin: String(f.origin || ''), // the page it was made on
    alg: ES256,
    createdAt: f.createdAt || now,
    lastUsedAt: f.lastUsedAt || null,
  };
}

export function isPasskey(r) {
  return !!r && typeof r.id === 'string' && typeof r.rpId === 'string' && typeof r.userId === 'string';
}

// The passkeys a sign-in may use: the RP's, and only the listed ones when the site lists any.
export function passkeysFor(all, rpId, allowCredentials = []) {
  const mine = all.filter((p) => p.rpId === rpId);
  const pick = allowCredentials.length ? mine.filter((p) => allowCredentials.includes(p.id)) : mine;
  return pick.sort((a, b) => (b.lastUsedAt || b.createdAt).localeCompare(a.lastUsedAt || a.createdAt));
}

// A passkey Nomad already has for this account (the site's excludeCredentials), so it doesn't make two.
export function excludedPasskey(all, rpId, excludeCredentials = []) {
  return all.find((p) => p.rpId === rpId && excludeCredentials.includes(p.id)) || null;
}

// A new passkey for an account Nomad already has one for replaces it (same RP, same user handle), as
// platform authenticators do with a discoverable credential.
export function replacedBy(all, rpId, userId) {
  return all.filter((p) => p.rpId === rpId && p.userId === userId);
}

// How the account reads in the prompt and in My Library.
export function accountLabel(p) {
  const name = p.userName || '';
  const display = p.displayName || '';
  if (display && name && display !== name) return { title: display, sub: name };
  return { title: display || name || 'Unnamed account', sub: '' };
}

// The bytes
// =

// clientDataJSON (§5.8.1), serialized the way §5.8.1.1 says, key order and all.
export function clientDataJSON({ type, challenge, origin, crossOrigin = false }) {
  return `{"type":${JSON.stringify(type)},"challenge":${JSON.stringify(challenge)},"origin":${JSON.stringify(origin)},"crossOrigin":${crossOrigin ? 'true' : 'false'}}`;
}

export function hexBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function concat(parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// Authenticator data (§6.1): rpIdHash ‖ flags ‖ signCount (‖ attested credential data).
export function authenticatorData({ rpIdHash, flags, signCount = 0, credentialId = null, coseKey = null }) {
  if (rpIdHash.length !== 32) throw new Error('rpIdHash must be 32 bytes');
  const head = new Uint8Array(37);
  head.set(rpIdHash, 0);
  head[32] = flags & 0xff;
  new DataView(head.buffer).setUint32(33, signCount >>> 0);
  if (!credentialId) return head;
  const len = new Uint8Array(2);
  new DataView(len.buffer).setUint16(0, credentialId.length);
  return concat([head, hexBytes(AAGUID_HEX), len, credentialId, coseKey]);
}

export function flagsFor({ attested = false, verified = false }) {
  return FLAG_UP | (verified ? FLAG_UV : 0) | (attested ? FLAG_AT : 0);
}

// The credential's public key as COSE_Key (RFC 9053, EC2 P-256): {1: 2, 3: -7, -1: 1, -2: x, -3: y}.
export function coseEC2(x, y) {
  return cborEncode(
    new Map([
      [1, 2],
      [3, ES256],
      [-1, 1],
      [-2, x],
      [-3, y],
    ])
  );
}

// The attestation object with "none" attestation (§8.7).
export function attestationObject(authData) {
  return cborEncode({ fmt: 'none', attStmt: {}, authData });
}

// CBOR (RFC 8949), just enough for the above: integers, byte and text strings, arrays, maps (a Map
// keeps its order; an object's keys go in CTAP2 canonical order: shorter first, then bytewise).
export function cborEncode(v) {
  const out = [];
  enc(v, out);
  return concat(out);
}

function head(major, n, out) {
  if (n < 24) out.push(Uint8Array.of((major << 5) | n));
  else if (n < 0x100) out.push(Uint8Array.of((major << 5) | 24, n));
  else if (n < 0x10000) out.push(Uint8Array.of((major << 5) | 25, n >> 8, n & 0xff));
  else if (n < 0x100000000) {
    const b = new Uint8Array(5);
    b[0] = (major << 5) | 26;
    new DataView(b.buffer).setUint32(1, n);
    out.push(b);
  } else throw new Error('CBOR: number too large');
}

function enc(v, out) {
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error('CBOR: only integers');
    if (v >= 0) head(0, v, out);
    else head(1, -1 - v, out);
  } else if (typeof v === 'boolean') out.push(Uint8Array.of(v ? 0xf5 : 0xf4));
  else if (v === null) out.push(Uint8Array.of(0xf6));
  else if (typeof v === 'string') {
    const b = utf8(v);
    head(3, b.length, out);
    out.push(b);
  } else if (v instanceof Uint8Array) {
    head(2, v.length, out);
    out.push(v);
  } else if (Array.isArray(v)) {
    head(4, v.length, out);
    for (const x of v) enc(x, out);
  } else if (v instanceof Map) {
    head(5, v.size, out);
    for (const [k, x] of v) {
      enc(k, out);
      enc(x, out);
    }
  } else if (typeof v === 'object') {
    const keys = Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    head(5, keys.length, out);
    for (const k of keys) {
      enc(k, out);
      enc(v[k], out);
    }
  } else throw new Error('CBOR: unsupported value');
}
