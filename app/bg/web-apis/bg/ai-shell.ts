// Backend for the shell-chrome AI sidebar (app/fg/shell-window/ai-sidebar.js). Unlike
// manifests/external/ai.ts (called by a content page about itself), every call here originates
// from the shell window's own renderer.
//
// The sidebar's assistant is the user's, not a tab's (ADR-0021): one conversation across tabs. A
// turn is the 'sidebar' stage. It has no Drive of its own; each tool call looks up the tab the user
// is on at that moment (currentTabOf). That tab's own webContents is the call's sender, so a
// permission prompt is for the tab's site (ADR-0019 §4). For nomad://editor and nomad://explorer,
// the tab's own URL is the app, not the Drive it has open, so resolveActiveDrive() asks the app
// itself (via window.__nomadAiHost) which Drive it shows.
//
// Session storage (chat-store.js) is a separate exception: it targets hyper://private/, which is
// gated to trusted senders, so it deliberately uses `this.sender` (the shell window itself, always
// nomad://shell-window and so trusted) rather than the active tab's (usually untrusted) webContents.

import { findWebContentsParentWindow } from '../../lib/electron';
import { getActive } from '../../ui/tabs/manager';
import {
  callAgentHost,
  isAgentHostApp,
  notifyAgentHostOfWrite,
  resolveActiveDrive,
} from '../../ai/active-tab.mjs';
import aiAPI, { routeChat, createChatStream } from './ai';
import * as chatStore from '../../ai/chat-store';
import * as vaultApps from './vault-apps';
import * as jobChat from '../../ai/job-chat';
import * as homeLayout from '../../ui/home-layout';
import * as settingsDb from '../../dbs/settings';
import { createSteering } from '../../ai/steering.mjs';

// The sidebar's one model choice, on this device (ADR-0021).
const PREFS_SETTING = 'ai_sidebar_prefs';

// The running turns the user can steer, by shell window and the turn id the sidebar picked. A
// message sent with steer() waits here until the turn's loop reads it (steering.mjs).
const steerings = new Map();
const steerKey = (shell, turnId) => `${shell?.id}:${turnId}`;

function activePane(sender) {
  const win = findWebContentsParentWindow(sender);
  const tab = win && getActive(win);
  return tab?.primaryPane || null;
}

// The tab the user is on in the sidebar's window, right now — or null.
async function currentTabOf(shell) {
  const pane = activePane(shell);
  const wc = pane?.webContents;
  if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return null;
  const drive = await resolveActiveDrive(pane);
  return { sender: wc, url: pane.url || '', title: pane.title || '', drive: drive.url ? drive : null };
}

// What the user is looking at when they send. The model can ask currentTab again later, since the
// user may change tabs while it works.
function describeTab(pane, drive) {
  const title = pane.title ? ` ("${pane.title}")` : '';
  const where =
    drive.url && drive.url.startsWith('hyper://')
      ? `${pane.url}${title}. The Nomad Drive in it is ${drive.url}${drive.writable ? ', which they can write' : ''}`
      : `${pane.url || 'a new tab'}${title}, a regular web page, not a Nomad Drive`;
  return (
    "You are the user's own assistant in Nomad's AI sidebar. You are not tied to one tab. When they " +
    `sent this message, the user was looking at ${where}. currentTab gives the tab they are on now. ` +
    "readCurrentPage and screenshotCurrentPage read that tab's rendered page; for a Drive, readDriveFile " +
    'and listDriveFiles read its files. To write a file, name its drive (`drive`). When they ask you to do ' +
    'something on the page, snapshotPage and the page actions click and type on it.'
  );
}

function cleanPrefs(prefs: any = {}) {
  const vision = {};
  for (const [model, on] of Object.entries(prefs?.vision || {})) {
    if (typeof model === 'string' && model && typeof on === 'boolean') vision[model] = on;
  }
  return {
    model: typeof prefs?.model === 'string' ? prefs.model : '',
    think: prefs?.think !== false,
    effort: typeof prefs?.effort === 'string' ? prefs.effort : '',
    // The user's "this model can see images", per model id.
    vision,
  };
}

export default {
  // opts: { model, think, effort, allowVision, turnId, chatId, privateData } — the sidebar's own choices, the
  // id it steers this turn by, and the chat (session) it's in. The rest of a turn's options are set here: the stage, the tab lookup and
  // the context.
  chat(messages, opts: any = {}) {
    const shell = this.sender;
    const turnId = typeof opts.turnId === 'string' && opts.turnId ? opts.turnId : null;
    const chatId = typeof opts.chatId === 'string' && opts.chatId ? opts.chatId : null;
    const pane = activePane(shell);
    if (!pane) {
      return createChatStream(async () => {
        throw new Error('No active tab');
      });
    }

    return createChatStream(async (emitter, signal) => {
      const steering = createSteering();
      const key = turnId ? steerKey(shell, turnId) : null;
      if (key) steerings.set(key, steering);
      try {
        await runSidebarTurn(emitter, signal, steering);
      } finally {
        steering.close();
        if (key && steerings.get(key) === steering) steerings.delete(key);
      }
    });

    async function runSidebarTurn(emitter, signal, steering) {
      // An editor or explorer that shows the drive the AI wrote to reloads that file.
      emitter.on('tool', (e) => {
        if (e?.phase === 'write') notifyAgentHostOfWrite(activePane(shell), e.drive, e.path);
      });

      const drive = await resolveActiveDrive(pane);
      let context = describeTab(pane, drive);
      if (isAgentHostApp(pane.url)) {
        const hostCtx = await callAgentHost(
          pane,
          'window.__nomadAiHost && window.__nomadAiHost.getAgentContext && window.__nomadAiHost.getAgentContext()'
        );
        if (hostCtx) context += `\n\nThe app in that tab says:\n${hostCtx}`;
        const ok = await callAgentHost(
          pane,
          'window.__nomadAiHost && window.__nomadAiHost.prepareForAgentRun ? window.__nomadAiHost.prepareForAgentRun() : true'
        );
        if (ok === false) throw new Error('Save your changes before running the assistant.');
      }

      await routeChat(messages, pane.webContents, emitter, {
        model: opts.model,
        think: opts.think,
        effort: opts.effort,
        allowVision: opts.allowVision,
        stage: 'sidebar',
        // The sidebar renders charts, maps and other UI the model writes in openui-lang.
        genUi: true,
        currentTab: () => currentTabOf(shell),
        context,
        signal,
        steering,
        // Page control remembers "allow similar" per chat, in this window.
        pageChat: chatId ? `${shell.id}:${chatId}` : null,
        // What the AI saves with saveScratch stays for the chat's later turns (scratch.mjs).
        scratchScope: chatId ? `sidebar:${shell.id}:${chatId}` : null,
        // An earlier answer in this chat read the user's private data (ADR-0037).
        privateData: opts.privateData === true,
        // What the AI makes or changes links back to this chat (ADR-0047). A chat is kept in
        // hyper://private/ of the window's Space (chat-store.js), so the Space goes with it.
        origin: chatId
          ? { chat: chatId, space: await vaultApps.spaceKey({ sender: shell }).catch(() => undefined) }
          : null,
      });
    }
  },

  // A message the user sent while turn `turnId` runs. true when the turn will read it at its next
  // step; false when it can't (it ended, it runs on another Device): the sidebar then sends it as
  // the next turn. A `steer` event on the chat stream says when the model got it.
  async steer(turnId, id, text) {
    const steering = steerings.get(steerKey(this.sender, turnId));
    return steering ? steering.push(id, text) : false;
  },

  // Sends a waiting message now: the model call in flight stops, and the turn reads the message
  // before its next one (steering.mjs now()). false when the turn already read it.
  async steerNow(turnId, id) {
    const steering = steerings.get(steerKey(this.sender, turnId));
    return steering ? steering.now(id) : false;
  },

  // Takes back a message the turn hasn't read yet. false when it already has.
  async unsteer(turnId, id) {
    const steering = steerings.get(steerKey(this.sender, turnId));
    return steering ? steering.remove(id) : false;
  },

  async listModels() {
    return aiAPI.listModels();
  },

  async modelInfo(model) {
    return aiAPI.modelInfo(model);
  },

  async listTools(opts: any = {}) {
    const pane = activePane(this.sender);
    return aiAPI.listTools.call({ sender: pane?.webContents }, opts);
  },

  // { url, writable } for the Drive the active tab is really about — lets the sidebar start a Draft
  // for it, and find the editor/explorer's Drive, not those tabs' own nomad://editor URL.
  async getActiveDriveInfo() {
    const pane = activePane(this.sender);
    if (!pane) return { url: null, writable: false };
    return resolveActiveDrive(pane);
  },

  // Mirrors the 'tool'/'write' event tap in chat() above, for writes that happen OUTSIDE a chat
  // turn — specifically the sidebar's "Revert this turn" button, which writes directly via
  // nomad.fs rather than through executeTool, so there's no tool event for chat() to tap.
  async notifyAgentWroteFile(path, drive) {
    await notifyAgentHostOfWrite(activePane(this.sender), drive, path);
  },

  // `running` marks the chat of a Job run that is going on now (job-chat.js).
  async listSessions() {
    const rows = await chatStore.listSessions(this.sender);
    return rows.map((r) => ({ ...r, running: jobChat.isLive(r.id) }));
  },

  async loadSession(sessionId) {
    const data = await chatStore.loadSession(this.sender, sessionId);
    return data ? { ...data, running: jobChat.isLive(sessionId) } : data;
  },

  // A Job run the user watches, as it happens (job-chat.js): the same events as chat(), from the
  // run's start. Closing it stops following, not the run; stopJob() stops the run.
  followJob(sessionId) {
    return createChatStream((emitter, signal) => jobChat.follow(String(sessionId || ''), emitter, signal));
  },

  async stopJob(sessionId) {
    return jobChat.stop(String(sessionId || ''));
  },

  newSession() {
    return chatStore.newSessionId();
  },

  async saveSession(sessionId, data) {
    return chatStore.saveSession(this.sender, sessionId, data);
  },

  async deleteSession(sessionId) {
    return chatStore.deleteSession(this.sender, sessionId);
  },

  async getLastSessionId() {
    return chatStore.getLastSessionId(this.sender);
  },

  // Pin to Home under a drawing (ADR-0048): the program becomes a card on the home page of the
  // window's Space, linked back to the chat it was drawn in. Returns { id, title }.
  async pinToHome(opts: any = {}) {
    const space = await vaultApps.spaceKey({ sender: this.sender }).catch(() => null);
    const chatId = typeof opts.chatId === 'string' && opts.chatId ? opts.chatId : null;
    const card = await homeLayout.pinCard(
      space,
      { source: opts.source, title: typeof opts.title === 'string' ? opts.title : undefined },
      chatId ? { stage: 'sidebar', chat: chatId, space: space || undefined } : null
    );
    return { id: card.id, title: card.title };
  },

  async getPrefs() {
    return cleanPrefs((await settingsDb.get(PREFS_SETTING)) as any);
  },

  async savePrefs(prefs) {
    await settingsDb.set(PREFS_SETTING, cleanPrefs(prefs));
  },
};
