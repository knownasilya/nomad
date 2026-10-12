// AI Sidebar chat sessions — one list, not one per site: the sidebar's assistant is the user's,
// not a tab's (ADR-0021). Device-private, hosted in hyper://private/ (the current Space's root
// drive) so it syncs across a user's own Devices for free, the same way
// hyper://private/address-book.json already does (app/userland/library/js/lib/contacts.js).
//
// Layout:
//   /.ai-chat/sessions/<sessionId>.json   { id, title, messages, updatedAt }
//   /.ai-chat/last-session.json           { sessionId }
//
// Older builds kept sessions and model preferences per site, in /.ai-chat/<hash of origin>/. Those
// folders are left where they are and not read. The model choice now lives in the settings DB
// (ai_sidebar_prefs, see ai-shell.ts).
//
// Built on the same `fsAPI` facade (bg/web-apis/bg/fs.ts) every other Drive read/write in the app
// goes through — not the lower-level Autobase primitives — so it gets the usual backend dispatch,
// Draft-safety, etc. for free. The caller always passes a trusted `sender` (the shell window's own
// webContents, which is nomad://shell-window and so passes wcTrust) so hyper://private/ access is
// permitted the same way it is for any other privileged nomad:// UI.

import fsAPI from '../web-apis/bg/fs';

const ROOT = 'hyper://private/.ai-chat';
const SESSIONS = `${ROOT}/sessions`;
const LAST_SESSION = `${ROOT}/last-session.json`;
const sessionUrl = (id) => `${SESSIONS}/${id}.json`;

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

export function newSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function listSessions(sender) {
  const ctx = { sender };
  let entries;
  try {
    entries = await fsAPI.list.call(ctx, SESSIONS, {});
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
  const sessions = await Promise.all(ids.map((id) => readJson(ctx, sessionUrl(id))));
  const out = [];
  sessions.forEach((data, i) => {
    if (!data) return;
    out.push({ id: ids[i], title: data.title || '', updatedAt: data.updatedAt || 0 });
  });
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export async function loadSession(sender, sessionId) {
  return readJson({ sender }, sessionUrl(sessionId));
}

export async function saveSession(sender, sessionId, data) {
  const ctx = { sender };
  await Promise.all([
    writeJson(ctx, sessionUrl(sessionId), { ...data, id: sessionId, updatedAt: Date.now() }),
    writeJson(ctx, LAST_SESSION, { sessionId }),
  ]);
}

export async function deleteSession(sender, sessionId) {
  try {
    await fsAPI.unlink.call({ sender }, sessionUrl(sessionId));
  } catch {
    /* already gone */
  }
}

export async function getLastSessionId(sender) {
  const rec = await readJson({ sender }, LAST_SESSION);
  return rec?.sessionId || null;
}
