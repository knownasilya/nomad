require('tls').DEFAULT_ECDH_CURVE = 'auto'; // HACK (prf) fix Node 8.9.x TLS issues, see https://github.com/nodejs/node/issues/19359
process.noAsar = true;

// DEBUG
// Error.stackTraceLimit = Infinity
// require('events').defaultMaxListeners = 1e3

// This is main process of Electron, started as first thing when your
// app starts. This script is running through entire life of your application.
// It doesn't have any windows which you can see on screen, but we can open
// window from here.

import { app, protocol, nativeTheme, BrowserWindow } from 'electron';
import { join } from 'path';

import { getEnvVar } from './bg/lib/env';
import * as logger from './bg/logger';
import * as beakerBrowser from './bg/browser';
import * as adblocker from './bg/adblocker';
import * as portForwarder from './bg/nat-port-forwarder';
import dbs from './bg/dbs/index';
import hyper from './bg/hyper/index';
import * as filesystem from './bg/filesystem/index';
import * as bookmarkPins from './bg/filesystem/pins';
import * as syncedSettings from './bg/hyper/synced-settings';
import * as vault from './bg/hyper/vault';
import * as names from './bg/hyper/names';
import * as autoNames from './bg/hyper/auto-names';
import * as readerArticles from './bg/web-apis/bg/reader-articles';
import * as noteTopics from './bg/web-apis/bg/note-topics';
import { remindersBetween } from './bg/web-apis/bg/calendar';
import { completeText, runJobTurn } from './bg/web-apis/bg/ai';
import * as aiJobs from './bg/ai/jobs';
import * as crawlerHost from './bg/hyper/crawler-host';
import * as webapis from './bg/web-apis/bg';

import * as initWindow from './bg/ui/init-window';
import { runSetupFlow } from './bg/ui/setup-flow';
import * as windows from './bg/ui/windows';
import * as tabManager from './bg/ui/tabs/manager';
import * as windowMenu from './bg/ui/window-menu';
import registerContextMenu from './bg/ui/context-menu';
import * as highlights from './bg/ui/highlights';
import * as mods from './bg/ui/mods';
import * as personas from './bg/ui/personas';
import * as aiMemory from './bg/ai/memory';
import * as aiSkills from './bg/ai/skills';
import * as pageControl from './bg/ui/page-control';
import * as openTabs from './bg/ui/open-tabs';
import * as remoteUpdate from './bg/remote-update';
import * as inbox from './bg/hyper/inbox';
import { createQuitTeardown } from './bg/quit-teardown.mjs';
import * as vouches from './bg/ui/vouches';
import * as desktopNotifications from './bg/ui/desktop-notifications';
import * as deviceActivity from './bg/ui/device-activity';
import * as trayIcon from './bg/ui/tray-icon';
import * as downloads from './bg/ui/downloads';
import * as permissions from './bg/ui/permissions';

import * as nomadProtocol from './bg/protocols/nomad';
import * as assetProtocol from './bg/protocols/asset';
import * as hyperProtocol from './bg/protocols/hyper';
import { registerForPartition } from './bg/protocols/index';
import * as spacesDb from './bg/dbs/spaces';

import * as testDriver from './bg/test-driver';
import * as openURL from './bg/open-url';

// setup
// =

const log = logger.get().child({ category: 'browser', subcategory: 'init' });

// read config from env vars
if (getEnvVar('NOMAD_USER_DATA_PATH')) {
  console.log('User data path set by environment variables');
  console.log('userData:', getEnvVar('NOMAD_USER_DATA_PATH'));
  app.setPath('userData', getEnvVar('NOMAD_USER_DATA_PATH'));
}
if (getEnvVar('NOMAD_TEST_DRIVER')) {
  testDriver.setup();
}
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = '1'; // we know, we know

// enable the sandbox
app.enableSandbox();

// HACK fix for cors in custom protocols
// see https://github.com/electron/electron/issues/20730
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');

// configure the protocols
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'hyper',
    privileges: {
      standard: true,
      secure: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      // TODO: remove once https://github.com/electron/electron/issues/24859 is resolved
      bypassCSP: true,
    },
  },
  {
    scheme: 'nomad',
    privileges: {
      standard: true,
      secure: true,
      allowServiceWorkers: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: 'asset',
    privileges: {
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

// handle OS event to open URLs
app.on('open-url', (e, url) => {
  e.preventDefault(); // we are handling it
  // wait for ready (not waiting can trigger errors)
  if (app.isReady()) openURL.open(url);
  else app.on('ready', () => openURL.open(url));
});

// handle OS event to open files
app.on('open-file', (e, filepath) => {
  e.preventDefault(); // we are handling it
  // wait for ready (not waiting can trigger errors)
  if (app.isReady()) openURL.open(`file://${filepath}`);
  else app.on('ready', () => openURL.open(`file://${filepath}`));
});

app.on('ready', async function () {
  var commonOpts = {
    userDataPath: app.getPath('userData'),
    homePath: app.getPath('home'),
  };

  await logger.setup(join(commonOpts.userDataPath, 'nomad.log'));
  log.info('Welcome to Nomad');
  // Invite links (ADR-0040 §4): one narrow scheme, so the "Open the invite" button on nomad.pages.dev reaches Nomad.
  // It only ever opens the page that reads an invite (bg/hyper/invites.js acceptUrlFor).
  try {
    if (!app.isDefaultProtocolClient('nomad-invite')) app.setAsDefaultProtocolClient('nomad-invite');
  } catch (e) {
    log.warn('Could not register nomad-invite:', { error: String(e) });
  }
  nomadProtocol.register(protocol);
  webapis.setup();
  initWindow.open();
  portForwarder.setup();

  // setup databases
  log.info('Initializing databases');
  for (let k in dbs) {
    if (dbs[k].setup) {
      dbs[k].setup(commonOpts);
    }
  }

  // start subsystems
  // (order is important)
  log.info('Starting hyperdrive');
  await hyper.setup(commonOpts);
  log.info('Initializing hyperdrive filesystem');
  await filesystem.setup();
  log.info('Initializing browser');
  await beakerBrowser.setup();
  adblocker.setup();
  await bookmarkPins.setup();

  // protocols
  log.info('Registering protocols');
  assetProtocol.setup();
  assetProtocol.register(protocol);
  hyperProtocol.register(protocol);

  // register protocols on all non-default space session partitions
  try {
    const allSpaces = await spacesDb.list();
    for (const space of allSpaces) {
      if (space.partition) registerForPartition(space.partition);
    }
  } catch (e) {
    // non-fatal: new spaces will register on first use
  }

  initWindow.close();

  // setup flow
  log.info('Running setup flow');
  await runSetupFlow();

  // ui
  log.info('Initializing window menu');
  windowMenu.setup();
  log.info('Initializing context menus');
  registerContextMenu();
  await highlights.setup();
  // The user's Mods (custom styles and scripts per site), from the Vault.
  mods.setup();
  // The user's Personas and the Sessions sites hold (ADR-0031), from the Vault.
  personas.setup();
  // What the user's assistant remembers about them, from the Vault (ADR-0032).
  aiMemory.setup();
  // The instructions the user gives their assistant for kinds of tasks, from the Vault (ADR-0034).
  aiSkills.setup();
  // The AI Sidebar's cursor on a page: the bar's Stop, and the user taking over.
  pageControl.setup();
  // This Device's open tabs, published to the Vault for the user's other Devices.
  openTabs.setup();
  // The user's phone can ask this computer to update and restart (Settings → Auto Updater).
  remoteUpdate.setup();
  // When the user last used this computer, told to their other Devices, so a notification shows
  // only on the one they're using (shared/device-activity.mjs).
  deviceActivity.setup();
  // Direct messages to the user's Personas (ADR-0036): this Device's mailboxes and outbox. A click on
  // a notification opens the Conversation.
  inbox.setup({
    open: (personaId, from) => {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (!win) return;
      win.show();
      const q = `persona=${encodeURIComponent(personaId)}&with=${encodeURIComponent(from)}`;
      tabManager.create(win, `nomad://messages/?${q}`, { setActive: true });
    },
  });
  // Vouches between Personas (ADR-0045): taken in from Messages, checked, and guarded.
  vouches.setup();
  log.info('Initializing tray icon');
  trayIcon.setup();
  log.info('Initializing browser windows');
  windows.setup();
  log.info('Initializing downloads manager');
  downloads.setup();
  log.info('Initializing permissions manager');
  permissions.setup();
  // Synced settings first, so a Device that turned the crawler off elsewhere stops it here soon.
  syncedSettings.setup();
  // Index any Space the Vault doesn't have yet (one made before Spaces were published on creation,
  // or while the Vault wasn't writable), so the user's other Devices see it.
  vault.syncSpacesToVault().catch((e) => log.warn('Could not sync spaces to the Vault', { error: e.toString() }));
  // The user's names (hyper://<name>/ and the URL bar), from the Vault.
  names.setup();
  // The AI names sites the user visits often (the AI page, nomad://ai/setup, turns it off).
  autoNames.setup({ complete: completeText });
  readerArticles.setup({ complete: completeText });
  // The AI sorts Notes into topics (the AI page turns it off).
  noteTopics.setup({ complete: completeText });
  // The user's AI Jobs: this Device runs the ones it owns when they're due (Vault records).
  aiJobs.setup({ runTurn: runJobTurn });
  // OS notifications for Job results, shared-Space notices, and permission prompts nobody sees
  // (Settings → Notifications). A click opens the Job, or brings Nomad forward.
  desktopNotifications.setup({
    reminders: remindersBetween,
    openUrl: (url) => {
      windows.ensureOneWindowExists();
      const win = windows.getActiveWindow();
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (url) tabManager.create(win, url, { setActive: true });
    },
  });
  log.info('Starting the discovery crawler');
  crawlerHost.setup();
  log.info('Program setup complete');

  // theming
  nativeTheme.themeSource = await dbs.settings.get('browser_theme');
  dbs.settings.on('set:browser_theme', (v) => {
    nativeTheme.themeSource = v;
  });
});

app.on('window-all-closed', () => {
  // do nothing
});

// Close the daemon before the process ends, and always end it afterwards, even when closing fails
// or hangs: on macOS an update installs only once this process is gone (bg/quit-teardown.mjs).
app.on(
  'will-quit',
  createQuitTeardown({
    needed: () => hyper.daemon.requiresShutdown(),
    steps: [
      // Unannounce this Device's mailboxes first, so a sender tries the user's other Devices at once.
      ['inbox', () => inbox.shutdown()],
      ['daemon', () => hyper.daemon.shutdown()],
    ],
    quit: () => {
      app.quit();
      // If something holds the quit up after this, end the process anyway.
      setTimeout(() => {
        log.warn('Quit did not finish, exiting');
        app.exit(0);
      }, 5000);
    },
    logger: log,
  })
);

app.on('quit', () => {
  log.info('Program quit');
  portForwarder.closePort();
});

app.on('custom-ready-to-show', () => {
  // our first window is ready to show, do any additional setup
});

// only run one instance
const isFirstInstance = app.requestSingleInstanceLock();
if (!isFirstInstance) {
  app.exit();
} else {
  handleArgv(process.argv);
  app.on('second-instance', (event, argv, workingDirectory) => {
    log.info('Second instance opened', { argv });
    handleArgv(argv);

    // focus/create a window
    windows.ensureOneWindowExists();
  });
}
function handleArgv(argv) {
  if (process.platform !== 'darwin') {
    // look for URLs, windows & linux use argv instead of open-url
    let url = argv.find((v) => v.indexOf('://') !== -1 || v.startsWith('nomad-invite:'));
    if (url) {
      openURL.open(url);
    }
  }
}
