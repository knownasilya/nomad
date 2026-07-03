import * as rpc from 'pauls-electron-rpc';
import { findTab } from '../ui/tabs/manager';

// internal manifests
import loggerManifest from './manifests/internal/logger';
import drivesManifest from './manifests/internal/drives';
import beakerBrowserManifest from './manifests/internal/browser';
import beakerFilesystemManifest from './manifests/internal/beaker-filesystem';
import bookmarksManifest from './manifests/internal/bookmarks';
import downloadsManifest from './manifests/internal/downloads';
import folderSyncManifest from './manifests/internal/folder-sync';
import historyManifest from './manifests/internal/history';
import hyperdebugManifest from './manifests/internal/hyperdebug';
import sitedataManifest from './manifests/internal/sitedata';
import watchlistManifest from './manifests/internal/watchlist';
import vaultManifest from './manifests/internal/vault';

// internal apis
import { WEBAPI as loggerAPI } from '../logger';
import { WEBAPI as auditLogAPI } from '../dbs/audit-log';
import drivesAPI from './bg/drives';
import * as bookmarksAPI from '../filesystem/bookmarks';
import beakerFilesystemAPI from './bg/beaker-filesystem';
import folderSyncAPI from './bg/folder-sync';
import historyAPI from './bg/history';
import hyperdebugAPI from './bg/hyperdebug';
import { WEBAPI as sitedataAPI } from '../dbs/sitedata';
import watchlistAPI from './bg/watchlist';
import vaultAPI from './bg/vault';
import { WEBAPI as downloadsAPI } from '../ui/downloads';
import { WEBAPI as beakerBrowserAPI } from '../browser';

// external manifests
import aiManifest from './manifests/external/ai';
import capabilitiesManifest from './manifests/external/capabilities';
import contactsManifest from './manifests/external/contacts';
import fsManifest from './manifests/external/fs';
import markdownManifest from './manifests/external/markdown';
import panesManifest from './manifests/external/panes';
import peersocketsManifest from './manifests/external/peersockets';
import schemasManifest from './manifests/external/schemas';
import shellManifest from './manifests/external/shell';

// external apis
import aiAPI from './bg/ai';
import capabilitiesAPI from './bg/capabilities';
import contactsAPI from './bg/contacts';
import fsAPI from './bg/fs';
// NOTE: bg/hyperdrive.js + bg/autobase.js are no longer exposed as public APIs (ADR-0010).
// They remain as INTERNAL implementations that bg/fs.js delegates to behind beaker.fs.
import markdownAPI from './bg/markdown';
import panesAPI from './bg/panes';
import peersocketsAPI from './bg/peersockets';
import schemasAPI from './bg/schemas';
import * as shellAPI from './bg/shell';

// experimental manifests
import experimentalCapturePageManifest from './manifests/external/experimental/capture-page';
import experimentalGlobalFetchManifest from './manifests/external/experimental/global-fetch';

// experimental apis
import experimentalCapturePageAPI from './bg/experimental/capture-page';
import experimentalGlobalFetchAPI from './bg/experimental/global-fetch';

const INTERNAL_ORIGIN_REGEX = /^(beaker:)/i;
const SITE_ORIGIN_REGEX = /^(beaker:|hyper:|https?:|data:)/i;
const IFRAME_WHITELIST = [
  'fs.loadDrive',
  'fs.getInfo',
  'fs.diff',
  'fs.stat',
  'fs.readFile',
  'fs.readdir',
  'fs.query',
  'fs.watch',
];

// exported api
// =

export const setup = function () {
  // internal apis
  rpc.exportAPI('logger', loggerManifest, Object.assign({}, auditLogAPI, loggerAPI), internalOnly);
  rpc.exportAPI('beaker-browser', beakerBrowserManifest, beakerBrowserAPI, internalOnly);
  rpc.exportAPI('beaker-filesystem', beakerFilesystemManifest, beakerFilesystemAPI, internalOnly);
  rpc.exportAPI('bookmarks', bookmarksManifest, bookmarksAPI, internalOnly);
  rpc.exportAPI('downloads', downloadsManifest, downloadsAPI, internalOnly);
  rpc.exportAPI('drives', drivesManifest, drivesAPI, internalOnly);
  rpc.exportAPI('folder-sync', folderSyncManifest, folderSyncAPI, internalOnly);
  rpc.exportAPI('history', historyManifest, historyAPI, internalOnly);
  rpc.exportAPI('hyperdebug', hyperdebugManifest, hyperdebugAPI, internalOnly);
  rpc.exportAPI('sitedata', sitedataManifest, sitedataAPI, internalOnly);
  rpc.exportAPI('watchlist', watchlistManifest, watchlistAPI, internalOnly);
  rpc.exportAPI('vault', vaultManifest, vaultAPI, internalOnly);

  // external apis
  rpc.exportAPI('ai', aiManifest, aiAPI, secureOnly('ai'));
  rpc.exportAPI('capabilities', capabilitiesManifest, capabilitiesAPI, secureOnly('capabilities'));
  rpc.exportAPI('contacts', contactsManifest, contactsAPI, secureOnly('contacts'));
  rpc.exportAPI('fs', fsManifest, fsAPI, secureOnly('fs'));
  rpc.exportAPI('markdown', markdownManifest, markdownAPI);
  rpc.exportAPI('panes', panesManifest, panesAPI, secureOnly('panes'));
  rpc.exportAPI('schemas', schemasManifest, schemasAPI);
  rpc.exportAPI('peersockets', peersocketsManifest, peersocketsAPI, secureOnly('peersockets'));
  rpc.exportAPI('shell', shellManifest, shellAPI, secureOnly('shell'));

  // experimental apis
  rpc.exportAPI(
    'experimental-capture-page',
    experimentalCapturePageManifest,
    experimentalCapturePageAPI,
    secureOnly
  );
  rpc.exportAPI(
    'experimental-global-fetch',
    experimentalGlobalFetchManifest,
    experimentalGlobalFetchAPI,
    secureOnly
  );
};

function internalOnly(event, methodName, args) {
  if (!(event && event.sender)) {
    return false;
  }
  var senderInfo = getSenderInfo(event);
  return senderInfo.isMainFrame && INTERNAL_ORIGIN_REGEX.test(senderInfo.url);
}

const secureOnly = (apiName) => (event, methodName, args) => {
  if (!(event && event.sender)) {
    return false;
  }
  var senderInfo = getSenderInfo(event);
  if (!SITE_ORIGIN_REGEX.test(senderInfo.url)) {
    return false;
  }
  if (!senderInfo.isMainFrame) {
    return IFRAME_WHITELIST.includes(`${apiName}.${methodName}`);
  }
  return true;
};

function getSenderInfo(event) {
  var tab = findTab(event.sender);
  if (tab) return tab.getIPCSenderInfo(event);
  return { isMainFrame: true, url: event.sender.getURL() };
}
