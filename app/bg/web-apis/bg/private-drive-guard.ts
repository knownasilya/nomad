// Pure, dependency-injected gate that keeps pages out of the user's private drives: the Root Drive
// of every Space, which a page reaches as `hyper://private/`. It holds the user's address book, AI
// chat sessions and drive list, so it is closed by default. Only trusted nomad:// UI and pages
// served from that same drive get in freely.
//
// A page can get one narrow way in: a grant for ONE file, or ONE folder and everything under it,
// for read or write (write includes read). The user approves each grant in a prompt that names the
// path, and the grant ends after `ttlMs`. A grant is never possible for the root `/` or for a call
// that acts on the whole drive (getInfo, watch, fork, configure, writer management, Draft Mode).
// Grants live in memory only, so a restart ends them all.
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
//   ttlMs                        — how long a grant lasts (optional; PRIVATE_GRANT_TTL_MS)
import { PermissionsError, UserDeniedError } from 'beaker-error-constants';

export const PRIVATE_GRANT_TTL_MS = 60 * 60 * 1000;

// Normalise a request or grant path: decoded, '/'-rooted, with no empty or '.' segments. A trailing
// '/' (folder) is kept. Returns null for anything we refuse to reason about (a '..' segment, a
// backslash, a NUL, bad percent-encoding), so it can never match a grant.
export function normalizePrivatePath(raw) {
  if (typeof raw !== 'string') return null;
  let p;
  try {
    p = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (p.includes('\\') || p.includes('\0')) return null;
  const isFolder = p.endsWith('/');
  const parts = p.split('/').filter((s) => s !== '' && s !== '.');
  if (parts.includes('..')) return null;
  if (parts.length === 0) return '/';
  return '/' + parts.join('/') + (isFolder ? '/' : '');
}

// A folder grant ('/notes/') covers the folder itself and everything below it. A file grant covers
// that exact path only.
function covers(grantPath, path) {
  if (grantPath.endsWith('/')) return path === grantPath.slice(0, -1) || path.startsWith(grantPath);
  return path === grantPath;
}

const ALLOW = { allow: true };
const NEVER = { allow: false };

export function createPrivateDriveGuard(deps) {
  const {
    isWcTrusted,
    isRootKey,
    senderDriveKey,
    senderOrigin,
    requestPermission,
    now = Date.now,
    ttlMs = PRIVATE_GRANT_TTL_MS,
  } = deps;
  let grants = [];

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
    const allowed = await requestPermission(permId, ctx.sender, { path, minutes });
    if (!allowed) throw new UserDeniedError();

    const same = (g) =>
      g.origin === origin && g.rootKey === baseKey && g.path === path && g.access === access;
    grants = live().filter((g) => !same(g));
    grants.push({ origin, rootKey: baseKey, path, access, expiresAt: now() + ttlMs });
  }

  // The live grants, for inspection (tests, a future site-info list).
  function list() {
    return live().map((g) => ({ ...g }));
  }

  return { check, assert, list };
}
