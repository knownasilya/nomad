// The AI page's chats (nomad://ai/chats, ADR-0032): the AI Sidebar's saved sessions (chat-store.js,
// hyper://private/.ai-chat/), to list, search, rename, delete and reopen in the sidebar.
//
// Every caller is a trusted nomad:// page (internalOnly in web-apis/bg.ts), which may read
// hyper://private/, so its own webContents is the sender for the Drive reads, as the shell window's
// is for ai-shell.ts. Renames and deletes tell every window's sidebar (tabs/manager.js), so a
// sidebar showing a deleted chat doesn't save it back.

import * as chatStore from '../../ai/chat-store';
import * as jobChat from '../../ai/job-chat';
import { findWebContentsParentWindow } from '../../lib/electron';
import { openAiSidebarChat, emitAiChatsChanged, getWindowActiveSpaceId, setActiveSpace } from '../../ui/tabs/manager';
import * as spacesDb from '../../dbs/spaces';
import * as drives from '../../hyper/drives';
import * as jobs from '../../ai/jobs';
import * as aiMade from '../../ai/ai-made';
import * as vaultApps from './vault-apps';
import { resolveOrigins, originsForPath } from '../../../../shared/ai-origin.mjs';
import { isSpaceKey } from '../../../../shared/vault-apps.mjs';

const MAX_DRAFT = 4000;
const isId = (id) => typeof id === 'string' && /^[a-z0-9]{1,40}$/.test(id);

function checkId(id) {
  if (!isId(id)) throw new Error('Not a chat id');
  return id;
}

// The Space with this key on this computer, or null.
function spaceByKey(key) {
  if (!isSpaceKey(key)) return null;
  return (
    spacesDb.getCachedAll().find((sp) => {
      try {
        return sp.root_drive_url && drives.fromURLToKey(sp.root_drive_url) === key;
      } catch {
        return false;
      }
    }) || null
  );
}

// What an item shows for the chats that made or changed it (shared/ai-origin.mjs, ADR-0047).
async function resolveFor(sender, list) {
  const currentSpace = await vaultApps.spaceKey({ sender }).catch(() => null);
  return resolveOrigins(Array.isArray(list) ? list : [], {
    chat: (id, space) => chatStore.findSession(sender, id, isSpaceKey(space) && spaceByKey(space) ? space : null),
    job: async (id) => jobs.get(id) || null,
    currentSpace,
    spaceName: (key) => vaultApps.spaceNameOf(key) || '',
  });
}

export default {
  async list({ query = '' } = {}) {
    const [chats, lastId] = await Promise.all([
      chatStore.listSessions(this.sender, { query: String(query || '') }),
      chatStore.getLastSessionId(this.sender).catch(() => null),
    ]);
    // `job` marks a Job run's chat; `running`, one going on now (job-chat.js).
    return { chats: chats.map((c) => ({ ...c, running: jobChat.isLive(c.id) })), lastId };
  },

  async load(id) {
    return chatStore.loadSession(this.sender, checkId(id));
  },

  async rename(id, name) {
    const title = await chatStore.renameSession(this.sender, checkId(id), name);
    emitAiChatsChanged({ renamed: id });
    return title;
  },

  async remove(id) {
    await chatStore.deleteSession(this.sender, checkId(id));
    emitAiChatsChanged({ deleted: id });
  },

  // Opens it in the AI Sidebar of the caller's window. `space` (a Space key) is the Space the chat
  // is kept in, from an item the AI made (ADR-0047): the window switches to it first.
  async open(id, opts: any = {}) {
    const win = findWebContentsParentWindow(this.sender);
    if (!win) throw new Error('No window to open the chat in');
    checkId(id);
    const space = opts && isSpaceKey(opts.space) ? spaceByKey(opts.space) : null;
    if (space && getWindowActiveSpaceId(win) !== space.id) await setActiveSpace(win, space.id);
    openAiSidebarChat(win, id);
  },

  // The chats (or Jobs) that made or changed an item, from its `ai` list (a Note's, an Asset's),
  // as it shows them: [{ kind: 'chat' | 'job' | 'none', text, tip, id?, space?, made, at }].
  async origins(list) {
    return resolveFor(this.sender, list);
  },

  // The same for a drive (ai-made.js), newest first; with `path`, the chats that wrote that file
  // come first when there are any.
  async driveOrigins(url, path = '') {
    const list = await aiMade.driveOrigins(String(url || ''));
    if (!list.length) return [];
    return resolveFor(this.sender, path ? originsForPath(list, String(path)) : list);
  },

  // A new chat in the caller's window's sidebar. `draft` is text to put in its input for the user
  // to read and send (the home page's "Ask AI to change this page"): it is never sent for them.
  async openNew(opts: any = {}) {
    const win = findWebContentsParentWindow(this.sender);
    if (!win) throw new Error('No window to open the chat in');
    const draft = typeof opts?.draft === 'string' ? opts.draft.slice(0, MAX_DRAFT) : '';
    openAiSidebarChat(win, null, draft);
  },
};
