import { EventTarget, bindEventStream, fromEventStream } from './event-target';
import errors from 'beaker-error-constants';
import loggerManifest from '../manifests/internal/logger';
import beakerBrowserManifest from '../manifests/internal/browser';
import bookmarksManifest from '../manifests/internal/bookmarks';
import downloadsManifest from '../manifests/internal/downloads';
import drivesManifest from '../manifests/internal/drives';
import folderSyncManifest from '../manifests/internal/folder-sync';
import historyManifest from '../manifests/internal/history';
import hyperdebugManifest from '../manifests/internal/hyperdebug';
import sitedataManifest from '../manifests/internal/sitedata';
import watchlistManifest from '../manifests/internal/watchlist';
import vaultManifest from '../manifests/internal/vault';
import secretsManifest from '../manifests/internal/secrets';
import webmcpDevtoolsManifest from '../manifests/internal/webmcp';
import aiChatsManifest from '../manifests/internal/ai-chats';
import aiSitesManifest from '../manifests/internal/ai-sites';
import sharedFilesManifest from '../manifests/internal/shared-files';
import personasManifest from '../manifests/internal/personas';
import inboxManifest from '../manifests/internal/inbox';
import aiShellManifest from '../manifests/internal/ai-shell';
import { streamToAsyncIterator } from './ai-stream';

export const setup = function (rpc) {
  const internal: any = {};
  const opts = { timeout: false, errors };

  const loggerRPC = rpc.importAPI('logger', loggerManifest, opts);
  const beakerBrowserRPC = rpc.importAPI('nomad-browser', beakerBrowserManifest, opts);
  const bookmarksRPC = rpc.importAPI('bookmarks', bookmarksManifest, opts);
  const downloadsRPC = rpc.importAPI('downloads', downloadsManifest, opts);
  const drivesRPC = rpc.importAPI('drives', drivesManifest, opts);
  const folderSyncRPC = rpc.importAPI('folder-sync', folderSyncManifest, opts);
  const historyRPC = rpc.importAPI('history', historyManifest, opts);
  const hyperdebugRPC = rpc.importAPI('hyperdebug', hyperdebugManifest, opts);
  const sitedataRPC = rpc.importAPI('sitedata', sitedataManifest, opts);
  const watchlistRPC = rpc.importAPI('watchlist', watchlistManifest, opts);
  const vaultRPC = rpc.importAPI('vault', vaultManifest, opts);
  const secretsRPC = rpc.importAPI('secrets', secretsManifest, opts);
  const webmcpRPC = rpc.importAPI('webmcp-devtools', webmcpDevtoolsManifest, opts);
  const aiChatsRPC = rpc.importAPI('ai-chats', aiChatsManifest, opts);
  const aiSitesRPC = rpc.importAPI('ai-sites', aiSitesManifest, opts);
  const sharedFilesRPC = rpc.importAPI('shared-files', sharedFilesManifest, opts);
  const personasRPC = rpc.importAPI('personas', personasManifest, opts);
  const inboxRPC = rpc.importAPI('inbox', inboxManifest, opts);
  const aiShellRPC = rpc.importAPI('ai-shell', aiShellManifest, opts);

  // attach APIs
  internal.browser = Object.assign({}, beakerBrowserRPC);
  internal.browser.createEventsStream = () =>
    fromEventStream(beakerBrowserRPC.createEventsStream());
  internal.bookmarks = Object.assign({}, bookmarksRPC);
  internal.downloads = Object.assign({}, downloadsRPC);
  internal.downloads.createEventsStream = () => fromEventStream(downloadsRPC.createEventsStream());
  internal.folderSync = Object.assign({}, folderSyncRPC);
  internal.history = Object.assign({}, historyRPC);
  internal.hyperdebug = Object.assign({}, hyperdebugRPC);
  internal.hyperdebug.createCoreEventStream = (key) =>
    fromEventStream(hyperdebugRPC.createCoreEventStream(key));
  internal.logger = Object.assign({}, loggerRPC);
  internal.logger.stream = (opts) => fromEventStream(loggerRPC.stream(opts));
  internal.logger.streamAuditLog = (opts) => fromEventStream(loggerRPC.streamAuditLog(opts));
  internal.sitedata = Object.assign({}, sitedataRPC);
  internal.watchlist = Object.assign({}, watchlistRPC);
  internal.watchlist.createEventsStream = () => fromEventStream(watchlistRPC.createEventsStream());
  internal.vault = Object.assign({}, vaultRPC);
  internal.vault.watchPendingRequests = () => fromEventStream(vaultRPC.watchPendingRequests());
  internal.vault.watchAppData = () => fromEventStream(vaultRPC.watchAppData());
  internal.vault.watchJobs = () => fromEventStream(vaultRPC.watchJobs());
  internal.vault.watchJobProgress = (id) => fromEventStream(vaultRPC.watchJobProgress(id));
  internal.vault.openLiveNote = (id, conn) => fromEventStream(vaultRPC.openLiveNote(id, conn));
  internal.secrets = Object.assign({}, secretsRPC);
  internal.secrets.watch = () => fromEventStream(secretsRPC.watch());
  internal.webmcp = Object.assign({}, webmcpRPC);
  internal.webmcp.watch = () => fromEventStream(webmcpRPC.watch());
  // The AI Sidebar's saved chats, for nomad://ai/chats.
  internal.aiChats = Object.assign({}, aiChatsRPC);
  // The sites the user let the AI send to for 3 months, for nomad://ai/sites.
  internal.aiSites = Object.assign({}, aiSitesRPC);
  internal.aiSites.watch = () => fromEventStream(aiSitesRPC.watch());
  // Files and folders the user picked for a site in the capability file picker, for site-info.
  internal.sharedFiles = Object.assign({}, sharedFilesRPC);
  // The user's Personas and the Sessions sites hold (ADR-0031): My Library → Personas, site-info.
  internal.personas = Object.assign({}, personasRPC);
  internal.personas.watch = () => fromEventStream(personasRPC.watch());
  internal.inbox = Object.assign({}, inboxRPC);
  internal.inbox.watch = () => fromEventStream(inboxRPC.watch());
  // The user's own assistant, asked from the drive terminal's prompt (nomad://webterm `ai`). The
  // same turn as the AI Sidebar's, about the page the terminal is attached to (bg/ai-shell.ts
  // `terminal`). Its chats are saved with the sidebar's, so they open there too.
  internal.aiTerminal = {
    chat(messages, o: any = {}) {
      const events = fromEventStream(
        aiShellRPC.chat(messages, {
          model: o.model,
          think: o.think,
          turnId: o.turnId,
          chatId: o.chatId,
          privateData: o.privateData === true,
          terminal: { cwd: typeof o.cwd === 'string' ? o.cwd : '' },
        })
      );
      if (typeof o.onToolEvent === 'function') events.addEventListener('tool', (e) => o.onToolEvent(e));
      if (typeof o.onReasoning === 'function') events.addEventListener('reasoning', (e) => o.onReasoning(e.text));
      return streamToAsyncIterator(events);
    },
    newSession: () => aiShellRPC.newSession(),
    saveSession: (id, data) => aiShellRPC.saveSession(id, data),
    loadSession: (id) => aiShellRPC.loadSession(id),
    listModels: () => aiShellRPC.listModels(),
    getPrefs: () => aiShellRPC.getPrefs(),
  };

  // internal.drives
  internal.drives = new EventTarget();
  internal.drives.get = drivesRPC.get;
  internal.drives.list = drivesRPC.list;
  internal.drives.getForks = drivesRPC.getForks;
  internal.drives.editors = drivesRPC.editors;
  internal.drives.cancelInvite = drivesRPC.cancelInvite;
  internal.drives.acceptInvite = drivesRPC.acceptInvite;
  internal.drives.askToEdit = drivesRPC.askToEdit;
  // Version history and search in your drives (nomad://versions, nomad://search, the terminal).
  internal.drives.history = drivesRPC.history;
  internal.drives.fileAt = drivesRPC.fileAt;
  internal.drives.restoreFile = drivesRPC.restoreFile;
  internal.drives.restorePreview = drivesRPC.restorePreview;
  internal.drives.restoreDrive = drivesRPC.restoreDrive;
  internal.drives.searchFiles = drivesRPC.searchFiles;
  internal.drives.configure = drivesRPC.configure;
  internal.drives.remove = drivesRPC.remove;
  internal.drives.listTrash = drivesRPC.listTrash;
  internal.drives.collectTrash = drivesRPC.collectTrash;
  internal.drives.delete = drivesRPC.delete;
  internal.drives.touch = drivesRPC.touch;
  internal.drives.clearFileCache = drivesRPC.clearFileCache;
  internal.drives.clearDnsCache = drivesRPC.clearDnsCache;
  internal.drives.getDebugLog = drivesRPC.getDebugLog;
  internal.drives.createDebugStream = () => fromEventStream(drivesRPC.createDebugStream());
  // window.addEventListener('load', () => {
  //   try {
  //     bindEventStream(drivesRPC.createEventStream(), internal.drives)
  //   } catch (e) {
  //     // permissions error
  //   }
  // })

  return internal;
};
