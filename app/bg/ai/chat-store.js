// Per-site AI chat session storage — device-private, hosted in hyper://private/ (the current
// Space's root drive) so it syncs across a user's own Devices for free, the same way
// hyper://private/address-book.json already does (app/userland/library/js/lib/contacts.js).
//
// Layout, namespaced by a hash of the site's origin (an origin string contains ':' and '/', which
// aren't safe raw path segments):
//   /.ai-chat/<hash>/meta.json               { origin }
//   /.ai-chat/<hash>/sessions/<sessionId>.json  { id, title, messages, updatedAt }
//   /.ai-chat/<hash>/last-session.json        { sessionId }
//   /.ai-chat/<hash>/prefs.json               { model, think, effort }
//
// prefs are a per-SITE preference, not per-session — picking a model (or toggling Thinking) in
// the AI sidebar applies to every chat on that site going forward, including ones already saved;
// it isn't reset by "New session" or by reopening an older chat.
//
// Built on the same `fsAPI` facade (bg/web-apis/bg/fs.ts) every other Drive read/write in the app
// goes through — not the lower-level Autobase primitives — so it gets the usual backend dispatch,
// Draft-safety, etc. for free. The caller always passes a trusted `sender` (the shell window's own
// webContents, which is nomad://shell-window and so passes wcTrust) so hyper://private/ access is
// permitted the same way it is for any other privileged nomad:// UI.

import crypto from 'crypto';
import fsAPI from '../web-apis/bg/fs';

const ROOT = 'hyper://private/.ai-chat';

function siteHash(origin) {
  return crypto.createHash('sha256').update(String(origin || '')).digest('hex').slice(0, 16);
}

const metaUrl = (hash) => `${ROOT}/${hash}/meta.json`;
const sessionsUrl = (hash) => `${ROOT}/${hash}/sessions`;
const sessionUrl = (hash, id) => `${sessionsUrl(hash)}/${id}.json`;
const lastSessionUrl = (hash) => `${ROOT}/${hash}/last-session.json`;
const prefsUrl = (hash) => `${ROOT}/${hash}/prefs.json`;

async function readJson(ctx, url) {
  try {
    const v = await fsAPI.readFile.call(ctx, url, 'utf8');
    if (v === null || v === undefined) return null;
    return JSON.parse(typeof v === 'string' ? v : v.toString());
  } catch {
    return null;
  }
}

async function writeJson(ctx, url, data) {
  await fsAPI.writeFile.call(ctx, url, JSON.stringify(data), 'utf8');
}

// meta.json only ever records {origin}, which never changes once written — skip the rewrite (a
// Drive write, not free) once it's already correct, rather than doing it unconditionally on every
// single saveSession/savePrefs call.
async function ensureMeta(ctx, hash, origin) {
  const existing = await readJson(ctx, metaUrl(hash));
  if (existing?.origin === origin) return;
  await writeJson(ctx, metaUrl(hash), { origin });
}

export function newSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function listSessions(sender, origin) {
  const ctx = { sender };
  const hash = siteHash(origin);
  let entries;
  try {
    entries = await fsAPI.list.call(ctx, sessionsUrl(hash), {});
  } catch {
    return [];
  }
  const ids = [];
  for (const e of entries || []) {
    const name = (e && (e.name ?? e.key ?? e)) || '';
    const base = String(name).split('/').pop() || '';
    if (!base.endsWith('.json')) continue;
    ids.push(base.slice(0, -'.json'.length));
  }
  // Independent reads — fire them concurrently rather than one Drive round trip at a time, so
  // opening the history panel doesn't cost O(sessions) sequential latency.
  const sessions = await Promise.all(ids.map((id) => readJson(ctx, sessionUrl(hash, id))));
  const out = [];
  sessions.forEach((data, i) => {
    if (!data) return;
    out.push({ id: ids[i], title: data.title || '', updatedAt: data.updatedAt || 0 });
  });
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export async function loadSession(sender, origin, sessionId) {
  return readJson({ sender }, sessionUrl(siteHash(origin), sessionId));
}

export async function saveSession(sender, origin, sessionId, data) {
  const ctx = { sender };
  const hash = siteHash(origin);
  await Promise.all([
    ensureMeta(ctx, hash, origin),
    writeJson(ctx, sessionUrl(hash, sessionId), { ...data, id: sessionId, updatedAt: Date.now() }),
    writeJson(ctx, lastSessionUrl(hash), { sessionId }),
  ]);
}

export async function deleteSession(sender, origin, sessionId) {
  const ctx = { sender };
  try {
    await fsAPI.unlink.call(ctx, sessionUrl(siteHash(origin), sessionId));
  } catch {
    /* already gone */
  }
}

export async function getLastSessionId(sender, origin) {
  const rec = await readJson({ sender }, lastSessionUrl(siteHash(origin)));
  return rec?.sessionId || null;
}

// { model, think, effort } | null — the site-level (not session-level) model/thinking/effort
// preference, independent of which chat is currently open.
export async function getPrefs(sender, origin) {
  return readJson({ sender }, prefsUrl(siteHash(origin)));
}

export async function savePrefs(sender, origin, prefs) {
  const ctx = { sender };
  const hash = siteHash(origin);
  await Promise.all([ensureMeta(ctx, hash, origin), writeJson(ctx, prefsUrl(hash), prefs)]);
}
