// Pure, dependency-injected gate that keeps pages out of the user's private drives: the Root Drive
// of every Space, which a page reaches as `hyper://private/`. It holds the user's address book, AI
// chat sessions and drive list, so it is closed by default. Only trusted nomad:// UI and pages
// served from that same drive get in freely.
//
// A page can get one narrow way in: a grant for ONE file, or ONE folder and everything under it,
// for read or write (write includes read). The user approves each grant in a prompt that names the
// path and picks how long it lasts (an hour by default, up to 3 months: PRIVATE_GRANT_DURATIONS in
// lib/private-grant-durations.mjs; the page can't choose). A grant is never possible for the root `/`
// or for a call that acts on the whole drive (getInfo, watch, fork, configure, writer management,
// Draft Mode). Grants are kept by the injected `store` until they end, so one outlives a restart;
// without a store they live in memory only. Site-info lists them and takes one back (remove).
//
// Both drive backends ask this guard: the nomad.fs facade (fs.ts) with assert(), which can prompt,
// and the Hyperdrive backend (hyperdrive.ts) with check(), which never prompts. The wired instance
// is private-drive-access.ts. Same DI shape as fs-write-guard.ts, so it is unit-tested without
// Electron. See tests/unit/private-drive-guard.test.js.
//
// Injected deps:
//   isWcTrusted(sender)          — true for a trusted nomad:// UI
//   isRootKey(key)               — true for the Root Drive of any Space
//   senderDriveKey(sender)       — hex key of the drive the sender's page is served from, or null
//   senderOrigin(sender)         — the sender page's origin (the key a grant belongs to), or null
//   requestPermission(permId, sender, opts) — prompts the user, resolves a boolean decision
//   now()                        — current time in ms (optional; for tests)
//   ttlMs                        — how long a plain yes lasts (optional; PRIVATE_GRANT_TTL_MS)
//   store                        — { load(): Promise<grant[]>, save(grant[]) } (optional; keeps grants)
//   newId()                      — a grant's id (optional; for tests)
import { PermissionsError, UserDeniedError } from 'beaker-error-constants';
import { normalizeDrivePath } from '../../hyper/capability-rules.mjs';
import {
  DEFAULT_PRIVATE_GRANT_MINUTES,
  PRIVATE_GRANT_MINUTES,
  grantedMinutes,
} from '../../../lib/private-grant-durations.mjs';

export const PRIVATE_GRANT_TTL_MS = DEFAULT_PRIVATE_GRANT_MINUTES * 60 * 1000;
const LONGEST_MS = Math.max(...PRIVATE_GRANT_MINUTES) * 60 * 1000;
const ACCESS = new Set(['read', 'write']);

// Normalise a request or grant path: decoded, '/'-rooted, with no empty or '.' segments. A trailing
// '/' (folder) is kept. Returns null for anything we refuse to reason about (a '..' segment, a
// backslash, a NUL, bad percent-encoding), so it can never match a grant. Shared with capability
// URLs (capability-rules.mjs), so both read a path the same way.
export const normalizePrivatePath = normalizeDrivePath;

// A folder grant ('/notes/') covers the folder itself and everything below it. A file grant covers
// that exact path only.
function covers(grantPath, path) {
  if (grantPath.endsWith('/')) return path === grantPath.slice(0, -1) || path.startsWith(grantPath);
  return path === grantPath;
}

const ALLOW = { allow: true };
const NEVER = { allow: false };

let idCounter = 0;
const defaultId = () => `${Date.now().toString(36)}-${(++idCounter).toString(36)}`;

// The kept grants that are well-formed and still running. Anything odd in the file is dropped, and
// none can run longer than the longest choice from now (a clock set back, a hand-edited file).
export function liveGrants(list, t, newId = defaultId) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const g of list) {
    if (!g || typeof g !== 'object') continue;
    const path = typeof g.path === 'string' ? normalizePrivatePath(g.path) : null;
    if (!path || path === '/' || path !== g.path) continue;
    if (typeof g.origin !== 'string' || !g.origin) continue;
    if (typeof g.rootKey !== 'string' || !/^[0-9a-f]{64}$/i.test(g.rootKey)) continue;
    if (!ACCESS.has(g.access)) continue;
    if (!Number.isFinite(g.expiresAt) || g.expiresAt <= t) continue;
    out.push({
      id: typeof g.id === 'string' && g.id ? g.id : newId(),
      origin: g.origin,
      rootKey: g.rootKey,
      path,
      access: g.access,
      grantedAt: Number.isFinite(g.grantedAt) ? g.grantedAt : t,
      expiresAt: Math.min(g.expiresAt, t + LONGEST_MS),
    });
  }
  return out;
}

export function createPrivateDriveGuard(deps) {
  const {
    isWcTrusted,
    isRootKey,
    senderDriveKey,
    senderOrigin,
    requestPermission,
    now = Date.now,
    ttlMs = PRIVATE_GRANT_TTL_MS,
    store = null,
    newId = defaultId,
  } = deps;
  let grants = [];
  let loading = null;

  // Read the kept grants once, before the first decision.
  function ready() {
    if (!store) return null;
    if (!loading) {
      loading = Promise.resolve()
        .then(() => store.load())
        .then((list) => {
          grants = [...liveGrants(list, now(), newId), ...grants];
        })
        .catch(() => {});
    }
    return loading;
  }

  function persist() {
    if (!store) return;
    try {
      Promise.resolve(store.save(grants.map((g) => ({ ...g })))).catch(() => {});
    } catch {
      /* a failed save only costs the grant after a restart */
    }
  }

  function live() {
    const t = now();
    grants = grants.filter((g) => g.expiresAt > t);
    return grants;
  }

  // access: 'read' | 'write' | 'drive'. Resolves ALLOW, NEVER, or { ask } when a grant could help.
  async function decide(ctx, baseKey, rawPath, access) {
    const sender = ctx?.sender;
    if (!sender) return ALLOW; // internal caller, no page involved
    if (!isRootKey(baseKey)) return ALLOW; // not a private drive: other guards apply
    if (isWcTrusted(sender)) return ALLOW;
    if ((await senderDriveKey(sender)) === baseKey) return ALLOW; // a page served from this drive

    if (access !== 'read' && access !== 'write') return NEVER;
    await ready();
    const path = normalizePrivatePath(rawPath);
    if (!path || path === '/') return NEVER;
    const origin = senderOrigin(sender);
    if (!origin) return NEVER;

    const granted = live().some(
      (g) =>
        g.origin === origin &&
        g.rootKey === baseKey &&
        covers(g.path, path) &&
        (g.access === 'write' || access === 'read')
    );
    return granted ? ALLOW : { allow: false, ask: { origin, path } };
  }

  // True when the call may go ahead now. Never prompts.
  async function check(ctx, baseKey, rawPath, access) {
    return (await decide(ctx, baseKey, rawPath, access)).allow;
  }

  // Returns when the call may go ahead. Prompts for a grant when one could help; throws otherwise.
  async function assert(ctx, baseKey, rawPath, access) {
    const d: any = await decide(ctx, baseKey, rawPath, access);
    if (d.allow) return;
    if (!d.ask) throw new PermissionsError('Cannot access the hyper://private/ drive');

    const { origin, path } = d.ask;
    const permId = `${access === 'write' ? 'privateWrite' : 'privateRead'}:${path}`;
    const minutes = Math.round(ttlMs / 60000);
    // The prompt offers the lengths in `durations` and answers with the minutes picked; a plain yes
    // is `ttlMs`. Any other number is not one we offered, so it counts as a plain yes.
    const answer = await requestPermission(permId, ctx.sender, {
      path,
      minutes,
      durations: PRIVATE_GRANT_MINUTES,
    });
    const picked = grantedMinutes(answer, PRIVATE_GRANT_MINUTES, -1);
    if (!picked) throw new UserDeniedError();
    const forMs = picked > 0 ? picked * 60 * 1000 : ttlMs;

    const same = (g) =>
      g.origin === origin && g.rootKey === baseKey && g.path === path && g.access === access;
    const t = now();
    grants = live().filter((g) => !same(g));
    grants.push({
      id: newId(),
      origin,
      rootKey: baseKey,
      path,
      access,
      grantedAt: t,
      expiresAt: t + forMs,
    });
    persist();
  }

  // The running grants, soonest to end first; for one site (`origin`) when given. Site-info lists
  // them (nomad.sharedFiles.listPrivate).
  async function list(origin = null) {
    await ready();
    return live()
      .filter((g) => !origin || g.origin === origin)
      .sort((a, b) => a.expiresAt - b.expiresAt)
      .map((g) => ({ ...g }));
  }

  // End a grant now: the page's next call asks again. False when there was none.
  async function remove(id) {
    await ready();
    const before = live().length;
    grants = grants.filter((g) => g.id !== id);
    if (grants.length === before) return false;
    persist();
    return true;
  }

  return { check, assert, list, remove };
}
