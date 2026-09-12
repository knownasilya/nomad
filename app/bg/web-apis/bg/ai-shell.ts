// Backend for the shell-chrome AI sidebar (app/fg/shell-window/ai-sidebar.js). Unlike
// manifests/external/ai.ts (called by a content page about itself), every call here originates
// from the shell window's own renderer and is always about "whichever tab is active right now" —
// so every method resolves the active tab's Pane first.
//
// For an ordinary page, that Pane's own webContents doubles as both `sender` (permission
// attribution, page-tools scoping) AND the Drive being chatted about (sender.getURL()). For
// nomad://editor / nomad://explorer, those are NOT the same thing — the tab's own URL is the app,
// not the Drive it has open — so resolveActiveDrive() below asks the app itself (via
// window.__nomadAiHost) which Drive it's really showing, and that's threaded through as an
// explicit `driveUrl`/`allowWrite` override. Without this, every Drive tool (readDriveFile etc.)
// fails with "Not browsing a Drive" the moment it's used from editor/explorer.
//
// Session storage (chat-store.js) is a separate exception: it targets hyper://private/, which is
// gated to trusted senders, so it deliberately uses `this.sender` (the shell window itself, always
// nomad://shell-window and so trusted) rather than the active tab's (usually untrusted) webContents.

import { findWebContentsParentWindow } from '../../lib/electron';
import { getActive } from '../../ui/tabs/manager';
import aiAPI, { routeChat, createChatStream } from './ai';
import * as chatStore from '../../ai/chat-store';

function activePane(sender) {
  const win = findWebContentsParentWindow(sender);
  const tab = win && getActive(win);
  return tab?.primaryPane || null;
}

// Editor/explorer get special agent-run integration (which Drive is really open, save-before-run,
// reload-after-write) via a `window.__nomadAiHost` global they define — see editor/js/main.js +
// explorer/js/main.js for the implementation of getAgentDrive/getAgentContext/prepareForAgentRun/
// onAgentWroteFile.
function isAgentHostApp(url) {
  return typeof url === 'string' && (url.startsWith('nomad://editor') || url.startsWith('nomad://explorer'));
}

async function callHost(pane, expr) {
  try {
    return await pane.webContents.executeJavaScript(expr);
  } catch {
    return undefined;
  }
}

// { url, writable } for the Drive this tab is actually about — pane.url/pane.writable for an
// ordinary tab, or asked of the host app for editor/explorer (whose own tab URL is the app, not
// the Drive). `url` is null when there's no Drive in play (a plain http/https page, or a host app
// with nothing open).
async function resolveActiveDrive(pane) {
  if (isAgentHostApp(pane.url)) {
    const info = await callHost(
      pane,
      'window.__nomadAiHost && window.__nomadAiHost.getAgentDrive && window.__nomadAiHost.getAgentDrive()'
    );
    return { url: info?.url || null, writable: !!info?.writable };
  }
  if (typeof pane.url === 'string' && pane.url.startsWith('hyper://')) {
    return { url: pane.url, writable: !!pane.writable };
  }
  return { url: null, writable: false };
}

// Fallback context when the host app doesn't supply its own (richer) getAgentContext() — or for
// any ordinary tab, where this is the only context the model gets.
function describeActiveTab(pane, drive) {
  const title = pane.title ? ` ("${pane.title}")` : '';
  if (drive.url && drive.url.startsWith('hyper://')) {
    return (
      `You are chatting about the Nomad Drive currently open in this tab: ${drive.url}${title}. ` +
      'Use readDriveFile/listDriveFiles/writeDriveFile with absolute paths to read/edit its files ' +
      "directly. readCurrentPage/screenshotCurrentPage read THIS TAB's own rendered UI instead — " +
      "for an editor/explorer tab that's the app's own interface, not the Drive's rendered pages " +
      '— so prefer the Drive tools whenever you need the Drive\'s actual content.'
    );
  }
  const url = pane.url || '';
  return (
    `You are chatting about the page currently open in this tab: ${url}${title}. This is a ` +
    'regular web page, not a Nomad Drive — the Drive tools will not work here. Use ' +
    'readCurrentPage to read its visible text content.'
  );
}

export default {
  // opts: { model, think, effort, allowVision, onToolEvent, onReasoning } — same shape as
  // window.nomad.ai.chat's opts, minus driveUrl/allowWrite/context/usePageTools/pageToolsWcId,
  // which are always derived here from the active tab rather than accepted from the caller.
  chat(messages, opts: any = {}) {
    const pane = activePane(this.sender);
    if (!pane) {
      return createChatStream(async () => {
        throw new Error('No active tab');
      });
    }
    const hostApp = isAgentHostApp(pane.url);

    return createChatStream(async (emitter, signal) => {
      if (hostApp) {
        // Tap the same 'tool' events the sidebar UI itself listens to for the live activity trace
        // — no changes needed to the shared runChat/executeTool loop in ai.ts.
        emitter.on('tool', (e) => {
          if (e && e.phase === 'write' && e.path) {
            callHost(
              pane,
              `window.__nomadAiHost && window.__nomadAiHost.onAgentWroteFile && window.__nomadAiHost.onAgentWroteFile(${JSON.stringify(e.path)})`
            );
          }
        });
      }

      // Pin the agent to the actual Drive/tab it's chatting about — without this, `location.href`
      // in NOMAD_API_REFERENCE's guidance is meaningless (this call runs from the shell window,
      // not the page) and, for editor/explorer, the Drive tools have no Drive to target at all.
      const drive = await resolveActiveDrive(pane);
      let context = describeActiveTab(pane, drive);
      if (hostApp) {
        const hostCtx = await callHost(
          pane,
          'window.__nomadAiHost && window.__nomadAiHost.getAgentContext && window.__nomadAiHost.getAgentContext()'
        );
        if (hostCtx) context = hostCtx;
        const ok = await callHost(
          pane,
          'window.__nomadAiHost && window.__nomadAiHost.prepareForAgentRun ? window.__nomadAiHost.prepareForAgentRun() : true'
        );
        if (ok === false) throw new Error('Save your changes before running the assistant.');
      }

      await routeChat(messages, pane.webContents, emitter, {
        ...opts,
        driveUrl: drive.url || undefined,
        // The active tab's own `allowWrite` (e.g. the shell sidebar's this._writable) only
        // describes an ordinary hyper:// tab; for a host app it's meaningless (that tab is
        // nomad://editor, never itself a Drive), so the resolved Drive's own writability wins.
        allowWrite: drive.url ? drive.writable : opts.allowWrite,
        context,
        signal,
      });
    });
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

  // { url, writable } for the Drive the active tab is really about — lets the shell sidebar's own
  // read-only note / revert / Draft-Mode-auto-stage logic work correctly for editor/explorer too,
  // instead of only ever seeing those tabs' own nomad://editor URL (never a Drive).
  async getActiveDriveInfo() {
    const pane = activePane(this.sender);
    if (!pane) return { url: null, writable: false };
    return resolveActiveDrive(pane);
  },

  // Mirrors the 'tool'/'write' event tap in chat() above, for writes that happen OUTSIDE a chat
  // turn — specifically the sidebar's "Revert this turn" button, which writes directly via
  // nomad.fs rather than through executeTool, so there's no tool event for chat() to tap.
  async notifyAgentWroteFile(path) {
    const pane = activePane(this.sender);
    if (!pane || !isAgentHostApp(pane.url)) return;
    await callHost(
      pane,
      `window.__nomadAiHost && window.__nomadAiHost.onAgentWroteFile && window.__nomadAiHost.onAgentWroteFile(${JSON.stringify(path)})`
    );
  },

  async listSessions(origin) {
    return chatStore.listSessions(this.sender, origin);
  },

  async loadSession(origin, sessionId) {
    return chatStore.loadSession(this.sender, origin, sessionId);
  },

  newSession() {
    return chatStore.newSessionId();
  },

  async saveSession(origin, sessionId, data) {
    return chatStore.saveSession(this.sender, origin, sessionId, data);
  },

  async deleteSession(origin, sessionId) {
    return chatStore.deleteSession(this.sender, origin, sessionId);
  },

  async getLastSessionId(origin) {
    return chatStore.getLastSessionId(this.sender, origin);
  },

  async getSitePrefs(origin) {
    return chatStore.getPrefs(this.sender, origin);
  },

  async saveSitePrefs(origin, prefs) {
    return chatStore.savePrefs(this.sender, origin, prefs);
  },
};
