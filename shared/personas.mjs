// nomad/shared/personas.mjs
//
// Personas and Sessions (ADR-0031). A Persona is one of the user's identities in the browser: a
// private label that points at one Profile Drive (a Drive whose /index.json is
// `walled.garden/person`). A Session is the login a site holds after the user said yes in the login
// prompt. Both live in the Vault, so every Device the user owns has them, and neither ever leaves
// the user's own Devices.
//
//   /.vault/personas/<id>.json        { type, id, profileUrl, label, creator?, createdAt, updatedAt }
//   /.vault/persona-default.json      { type, personaId, updatedAt }
//   /.vault/spaces/<rootKey>.json     gains persona?: <id>      (the Space's override)
//   /.vault/sessions/<spaceKey>/<personaId>/<sha256(origin)>.json
//                                     { type, id, origin, personaId, space, perms, createdAt, expiresAt? }
//
// Pure: no imports, so desktop (bg/ui/personas.js) and the phone (mobile/backend/lib/vault-apps.mjs)
// share it. Hashing and random bytes come from the caller.

export const PERSONAS_PREFIX = '/.vault/personas/';
export const PERSONA_TYPE = 'nomad/persona';
export const DEFAULT_PATH = '/.vault/persona-default.json';
export const DEFAULT_TYPE = 'nomad/persona-default';
export const SESSIONS_PREFIX = '/.vault/sessions/';
export const SESSION_TYPE = 'nomad/session';
export const SPACES_PREFIX = '/.vault/spaces/';

export const MAX_LABEL = 40;
// The most a page may ask for with requestLogin({ maxAge }), in seconds: ten years.
export const MAX_AGE_LIMIT = 10 * 365 * 24 * 60 * 60;

const HEX64 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9]{8,40}$/;

// Paths
// =

export function personaPath(id) {
  return `${PERSONAS_PREFIX}${id}.json`;
}

export function spacePath(spaceKey) {
  return `${SPACES_PREFIX}${spaceKey}.json`;
}

// Every Session in a Space, or every Session of one Persona in a Space.
export function sessionsPrefix(spaceKey, personaId = null) {
  return `${SESSIONS_PREFIX}${spaceKey}/${personaId ? `${personaId}/` : ''}`;
}

// A Session's path. `originHash` is the hex sha256 of the Session's origin (originHashInput).
export function sessionPath(spaceKey, personaId, originHash) {
  return `${sessionsPrefix(spaceKey, personaId)}${originHash}.json`;
}

// The parts of a Session path, or null.
export function parseSessionPath(path) {
  const m = /^\/\.vault\/sessions\/([0-9a-f]{64})\/([a-z0-9]{8,40})\/([0-9a-f]{64})\.json$/.exec(
    String(path || '')
  );
  return m ? { space: m[1], personaId: m[2], hash: m[3] } : null;
}

// What sha256 is taken of for a Session's file name: the origin, as text.
export function originHashInput(origin) {
  return String(origin);
}

// Origins
// =

// The origin a Session belongs to: "https://example.com" (with a port when it has one) or
// "hyper://<key>". Null for a page that can't hold one: nomad://, the private drive, file:, data:,
// a drive named by a name instead of its key.
export function sessionOrigin(url) {
  let u;
  try {
    u = new URL(String(url || ''));
  } catch {
    return null;
  }
  if (u.protocol === 'https:' || u.protocol === 'http:') {
    if (!u.hostname) return null;
    return `${u.protocol}//${u.host}`.toLowerCase();
  }
  if (u.protocol === 'hyper:') {
    const host = u.hostname.toLowerCase();
    if (!HEX64.test(host)) return null;
    return `hyper://${host}`;
  }
  return null;
}

// The key of a hyper:// URL, or null.
export function driveKeyOf(url) {
  const m = /^hyper:\/\/([0-9a-f]{64})(?:[/?#]|$)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : null;
}

// "hyper://<key>/" for a Profile Drive URL typed or pasted in any form, or throws.
export function normalizeProfileUrl(url) {
  const key = driveKeyOf(String(url || '').trim());
  if (!key) throw new Error('A Persona needs a Profile Drive, like hyper://…/');
  return `hyper://${key}/`;
}

// Records
// =

// A new id for a Persona: lowercase letters and digits, from random bytes.
export function newPersonaId(bytes) {
  return base32(bytes).slice(0, 16);
}

// A Session id (ADR-0031 §8, tier 1): 16 random bytes, base32. Nothing in it comes from the user.
export function newSessionId(bytes) {
  if (!bytes || bytes.length < 16) throw new Error('A Session id needs 16 random bytes');
  return base32(bytes.slice(0, 16));
}

export function normalizeLabel(label) {
  const s = String(label ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) throw new Error('Give the Persona a name, like Work or Me');
  if (s.length > MAX_LABEL)
    throw new Error(`A Persona’s name can be at most ${MAX_LABEL} characters`);
  return s;
}

// A Persona record from the fields given and the one stored (prev). `creator` is the Profile Drive's
// key when this Device made the Drive: the writer the Drive started with is then the user's own
// (see profileState).
export function makePersona(fields, prev = null, now = new Date().toISOString()) {
  const id = prev?.id || fields.id;
  if (!ID.test(String(id || ''))) throw new Error('A Persona needs an id');
  const profileUrl = normalizeProfileUrl(fields.profileUrl ?? prev?.profileUrl);
  const label = normalizeLabel(fields.label ?? prev?.label);
  const creator = fields.creator !== undefined ? fields.creator : prev?.creator;
  const rec = {
    type: PERSONA_TYPE,
    id,
    profileUrl,
    label,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
  if (creator && HEX64.test(creator) && creator === driveKeyOf(profileUrl)) rec.creator = creator;
  return rec;
}

export function isPersona(rec) {
  return !!(
    rec &&
    rec.type === PERSONA_TYPE &&
    ID.test(String(rec.id || '')) &&
    driveKeyOf(rec.profileUrl) &&
    typeof rec.label === 'string'
  );
}

export function makeDefault(personaId, now = new Date().toISOString()) {
  return { type: DEFAULT_TYPE, personaId: personaId || null, updatedAt: now };
}

// Personas by label, then oldest first.
export function sortPersonas(list) {
  return [...list].sort(
    (a, b) =>
      a.label.localeCompare(b.label) || String(a.createdAt).localeCompare(String(b.createdAt))
  );
}

// Which Persona a tab uses (ADR-0031 §4)
// =

// The Space's own Persona if it exists and is usable, else the Vault default if usable, else null.
// `usable(persona)` says whether a Persona may log in now (profileState(...).state === 'usable');
// leave it out to resolve without that check (what the UI shows as picked).
/** @param {{ spaceOverride?: string | null, defaultId?: string | null, personas?: any[], usable?: ((p: any) => boolean) | null }} [o] */
export function resolvePersona({
  spaceOverride = null,
  defaultId = null,
  personas = [],
  usable = null,
} = {}) {
  const ok = (p) => p && (!usable || usable(p));
  const byId = (id) => (id ? personas.find((p) => p.id === id) || null : null);
  const own = byId(spaceOverride);
  if (ok(own)) return own;
  const def = byId(defaultId);
  if (ok(def)) return def;
  return null;
}

// Where the resolved Persona came from: 'space', 'default', or null.
/** @param {{ spaceOverride?: string | null, defaultId?: string | null, personas?: any[], usable?: ((p: any) => boolean) | null }} [o] */
export function resolvedFrom({
  spaceOverride = null,
  defaultId = null,
  personas = [],
  usable = null,
} = {}) {
  const p = resolvePersona({ spaceOverride, defaultId, personas, usable });
  if (!p) return null;
  return p.id === spaceOverride ? 'space' : 'default';
}

// The writer check (ADR-0031 §5)
// =

// Whether a Persona's Profile Drive may log in. A Profile Drive's URL is public, so the Drive must
// have no writers but the user's own Devices:
//   - `writers`: the writer keys the Drive added (listWriters), every one a Device in the Vault;
//   - the writer the Drive started with (its own key) is the user's: a Device of theirs made it
//     (`persona.creator`), checked when the Persona was made.
// States: 'usable', 'foreign-writers', and 'not-ready' (this Device hasn't seen the Vault's Devices or
// the Drive yet: never an error about the user's own identity).
/** @param {{ persona?: any, vaultReady?: boolean, deviceKeys?: string[], writers?: string[] | null, loaded?: boolean }} [o] */
export function profileState({
  persona,
  vaultReady = true,
  deviceKeys = [],
  writers = null,
  loaded = true,
} = {}) {
  if (!vaultReady) {
    return { state: 'not-ready', reason: 'This device hasn’t finished syncing your Vault yet.' };
  }
  if (!loaded || !Array.isArray(writers)) {
    return {
      state: 'not-ready',
      reason: 'This device hasn’t got the Persona’s profile drive yet.',
    };
  }
  const key = driveKeyOf(persona?.profileUrl);
  if (!key || persona.creator !== key) {
    return {
      state: 'foreign-writers',
      reason: 'Its profile drive wasn’t made by one of your devices.',
    };
  }
  const own = new Set(deviceKeys.map((k) => String(k).toLowerCase()));
  own.add(key);
  const foreign = writers.map((w) => String(w).toLowerCase()).filter((w) => !own.has(w));
  if (foreign.length) {
    return {
      state: 'foreign-writers',
      reason: `Its profile drive has ${foreign.length === 1 ? 'a writer' : `${foreign.length} writers`} that ${foreign.length === 1 ? 'isn’t' : 'aren’t'} one of your devices.`,
      foreign,
    };
  }
  return { state: 'usable', reason: '' };
}

// Sessions (ADR-0031 §8–10)
// =

// The permissions a page may ask a Session for. `modifyDrive` is write access to the Persona's own
// Profile Drive and comes only with `profile` (a page can't write a drive it can't name).
export const SESSION_PERMS = ['profile', 'modifyDrive'];

// The tokens a page asked for, checked: known names only, `modifyDrive` (or
// `modifyDrive:<profileKey>`) turned into the token for the Persona's own drive. Throws on any other
// token, so a drive author learns at once.
export function requestedPerms(perms, profileKey = null) {
  if (perms == null) return [];
  if (!Array.isArray(perms)) throw new TypeError('perms must be an array, like ["profile"]');
  const out = [];
  for (const raw of perms) {
    const p = String(raw || '');
    const [name, param] = [p.split(':')[0], p.split(':').slice(1).join(':')];
    if (!SESSION_PERMS.includes(name) || (name === 'profile' && param)) {
      throw new TypeError(
        `nomad.session can’t grant “${p}”. It grants ${SESSION_PERMS.join(' and ')}.`
      );
    }
    if (name === 'modifyDrive' && param && param.toLowerCase() !== profileKey) {
      throw new TypeError(
        'nomad.session grants modifyDrive only for the Persona’s own profile drive'
      );
    }
    const token = name === 'modifyDrive' ? (profileKey ? `modifyDrive:${profileKey}` : null) : name;
    if (token && !out.includes(token)) out.push(token);
  }
  return out;
}

// What the user left checked, cut to what was asked: a partial grant is normal, and writing needs
// the profile.
export function grantedPerms(requested, checked) {
  const keep = requested.filter((t) => checked.includes(t));
  return keep.includes('profile') ? keep : keep.filter((t) => !t.startsWith('modifyDrive:'));
}

export function normalizeMaxAge(maxAge) {
  if (maxAge == null) return null;
  const n = Number(maxAge);
  if (!Number.isFinite(n) || n <= 0)
    throw new TypeError('maxAge must be a number of seconds above 0');
  return Math.min(Math.floor(n), MAX_AGE_LIMIT);
}

/** @param {{ id?: string, origin?: string, personaId?: string, space?: string, perms?: string[], maxAge?: number | null, now?: Date | string | number }} [o] */
export function makeSession({
  id,
  origin,
  personaId,
  space,
  perms = [],
  maxAge = null,
  now = new Date(),
} = {}) {
  if (!id) throw new Error('A Session needs an id');
  if (!sessionOrigin(origin) || sessionOrigin(origin) !== origin)
    throw new Error('A Session needs an origin');
  if (!ID.test(String(personaId || ''))) throw new Error('A Session needs a Persona');
  if (!HEX64.test(String(space || ''))) throw new Error('A Session needs a Space');
  const t = now instanceof Date ? now : new Date(now);
  const rec = {
    type: SESSION_TYPE,
    id,
    origin,
    personaId,
    space,
    perms: [...new Set(perms)],
    createdAt: t.toISOString(),
  };
  const age = normalizeMaxAge(maxAge);
  if (age) rec.expiresAt = new Date(t.getTime() + age * 1000).toISOString();
  return rec;
}

export function isSession(rec) {
  return !!(
    rec &&
    rec.type === SESSION_TYPE &&
    typeof rec.id === 'string' &&
    sessionOrigin(rec.origin) === rec.origin &&
    ID.test(String(rec.personaId || '')) &&
    HEX64.test(String(rec.space || '')) &&
    Array.isArray(rec.perms)
  );
}

/** @param {any} session @param {number | Date} [now] */
export function isExpired(session, now = Date.now()) {
  if (!session?.expiresAt) return false;
  return Date.parse(session.expiresAt) <= (now instanceof Date ? now.getTime() : now);
}

// Does a live Session grant this permission token? Only the tokens it holds, never the Persona's
// own authority, and never anything on hyper://private/.
/** @param {any} session @param {string} token @param {number | Date} [now] */
export function sessionGrants(session, token, now = Date.now()) {
  if (!session || isExpired(session, now)) return false;
  const t = String(token || '');
  if (/^[a-z]+:private(\b|$)/i.test(t)) return false;
  return session.perms.includes(t);
}

// What a page sees of its Session: the id always (tier 1), and the profile only with `profile`
// (tier 2). `perms` are the names the page asked with.
export function sessionView(session, profile = null) {
  if (!session) return null;
  const perms = session.perms.map((t) => t.split(':')[0]);
  const view = { id: session.id, perms, createdAt: session.createdAt };
  if (session.expiresAt) view.expiresAt = session.expiresAt;
  if (perms.includes('profile') && profile) {
    view.profile = {
      url: profile.url,
      title: profile.title || '',
      ...(profile.thumb ? { thumb: profile.thumb } : {}),
    };
  }
  return view;
}

// The user's Sessions, newest first.
export function sortSessions(list) {
  return [...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// A short way to show an origin: the host, or "hyper://abcd…wxyz" for a drive.
export function shortOrigin(origin) {
  const key = driveKeyOf(`${origin}/`);
  if (key) return `hyper://${key.slice(0, 6)}…${key.slice(-4)}`;
  return String(origin || '').replace(/^https?:\/\//, '');
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
