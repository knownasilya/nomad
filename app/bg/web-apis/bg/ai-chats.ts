// The AI page's chats (nomad://ai/chats, ADR-0032): the AI Sidebar's saved sessions (chat-store.js,
// hyper://private/.ai-chat/), to list, search, rename, delete and reopen in the sidebar.
//
// Every caller is a trusted nomad:// page (internalOnly in web-apis/bg.ts), which may read
// hyper://private/, so its own webContents is the sender for the Drive reads, as the shell window's
// is for ai-shell.ts. Renames and deletes tell every window's sidebar (tabs/manager.js), so a
// sidebar showing a deleted chat doesn't save it back.

import * as chatStore from '../../ai/chat-store';
import { findWebContentsParentWindow } from '../../lib/electron';
import { openAiSidebarChat, emitAiChatsChanged } from '../../ui/tabs/manager';

const isId = (id) => typeof id === 'string' && /^[a-z0-9]{1,40}$/.test(id);

function checkId(id) {
  if (!isId(id)) throw new Error('Not a chat id');
  return id;
}

export default {
  async list({ query = '' } = {}) {
    const [chats, lastId] = await Promise.all([
      chatStore.listSessions(this.sender, { query: String(query || '') }),
      chatStore.getLastSessionId(this.sender).catch(() => null),
    ]);
    return { chats, lastId };
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

  async open(id) {
    const win = findWebContentsParentWindow(this.sender);
    if (!win) throw new Error('No window to open the chat in');
    openAiSidebarChat(win, checkId(id));
  },

  async openNew() {
    const win = findWebContentsParentWindow(this.sender);
    if (!win) throw new Error('No window to open the chat in');
    openAiSidebarChat(win, null);
  },
};
