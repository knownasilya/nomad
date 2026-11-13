// An AI Job's page (ADR-0038): the one page a Job's run opens, reads, and clicks and types on.
//
// - A run with nobody watching opens it in a hidden window of its own, in the Job's Space's
//   session, so the page is signed in as the user. Nothing shows and nothing takes the focus. It
//   closes when the run ends.
// - A run the user watches (Run with me, in My Library → Jobs) opens it in a tab of the user's
//   window, in the "Jobs" tab group, with the page-control cursor, border and Stop bar. The tab
//   stays open after the run.
//
// What the page may do is the Job's `writes.pages` (shared/jobs.mjs): a site it may open, and
// whether it may click and type there. A watched run asks the user for a site it doesn't have yet
// (the `jobPage` permission) and for a click that buys, sends, posts or deletes (`aiPageAction`,
// whose "allow similar" saves that click on the Job), and saves each yes on the Job through
// `onGrant`. A run with nobody watching never asks: it is refused, and what it wanted goes into
// `needs`, which the run's record keeps so My Library can offer Run with me.
//
// The actions themselves are ui/page-control.js's, with the Job's rules in place of the sidebar's.

import path from 'path';
import { app, autoUpdater, BrowserWindow } from 'electron';
import * as logLib from '../logger';
import * as permissions from '../ui/permissions';
import * as tabManager from '../ui/tabs/manager';
import * as pageControl from '../ui/page-control';
import * as spacesDb from '../dbs/spaces';
import * as names from '../hyper/names';
import { registerForPartition } from '../protocols/index';
import { spaceIdOfKey } from '../ui/personas';
import { PAGE_ACTION_PERM, pageOffLimits, similarKey, similarLabel } from './page-control.mjs';
import { jobPageUrl } from './open-tab.mjs';
import { partFields } from './text-part.mjs';
import { readPageText } from './scratch.mjs';
import { grantPage, pageGrant, pageSite } from '../../../shared/jobs.mjs';

const logger = logLib.get().child({ category: 'ai', subcategory: 'job-page' });

// A shown Job window hides instead of closing while its run goes on, but never holds up a quit: an
// update's quitAndInstall closes every window first and installs only once they are all gone.
let quitting = false;
app.on('before-quit', () => (quitting = true));
autoUpdater?.on?.('before-quit-for-update', () => (quitting = true));

const PRELOAD_WORLD = 999;
const LOAD_TIMEOUT = 20_000;
export const JOB_PAGE_PERM = 'jobPage';
export const JOB_TAB_GROUP = 'Jobs';
// The hidden page's size: a laptop screen, so pages lay out as they do for the user.
const WIDTH = 1280;
const HEIGHT = 900;

let asks = 0;

/**
 * @param {{
 *   job: any,
 *   watchWin?: any,
 *   space?: string | null,
 *   egress?: any,
 *   stopTurn: () => void,
 *   onGrant: (writes: any) => Promise<any>,
 *   needs: any[],
 * }} opts
 * `watchWin` is the user's window for a run they watch; null for a hidden page. `onGrant` saves the
 * Job's writes after the user said yes to something. `needs` collects what the run wanted.
 */
export function createJobPage({
  job,
  watchWin = null,
  space = null,
  egress = null,
  stopTurn,
  onGrant,
  needs,
}) {
  const watched = !!watchWin;
  let writes = job.writes || null;
  let wc = null; // the page's webContents
  let hiddenWin = null;
  let shown = false; // the user asked to see the hidden page
  let ended = false;
  const answers = new Map(); // site + kind -> Promise<boolean>, this run's answers

  // The page's site may be used (`control`: clicked and typed on). Asks on a watched run; throws
  // otherwise, noting the need.
  async function mayUse(url, control) {
    const site = pageSite(url);
    if (!site) throw new Error('This page isn’t one a Job can use.');
    const g = pageGrant(writes, site);
    if (g && (!control || g.control)) return site;
    if (!watched) {
      needs.push({ site, control });
      throw new Error(
        `This Job may not ${control ? 'click and type on' : 'open'} ${site}. The user gives it that by running the ` +
          'Job with them once (Run with me, in My Library → Jobs). Don’t try again: finish, and say in your answer what ' +
          'you needed it for.'
      );
    }
    const key = `${site}\n${control ? 'control' : 'open'}`;
    if (!answers.has(key)) answers.set(key, ask(site, control));
    if (!(await answers.get(key))) {
      throw new Error(
        `The user didn’t let this Job ${control ? 'click and type on' : 'open'} ${site}. Don’t try again; say in your ` +
          'answer what you needed it for.'
      );
    }
    return site;
  }

  async function ask(site, control) {
    const target = await ensureTab(null);
    const ok = await permissions.requestPermission(`${JOB_PAGE_PERM}:${++asks}`, target, {
      title: job.title,
      site,
      control: !!control,
    });
    if (!ok) return false;
    await grant(site, { control });
    return true;
  }

  async function grant(site, how) {
    writes = grantPage(writes, site, how);
    // A site the user let the Job use is one it may reach after reading their data (ADR-0037).
    egress?.trust?.([site.startsWith('hyper://') ? site.slice(8) : site.replace(/:\d+$/, '')]);
    try {
      await onGrant(writes);
    } catch (err) {
      logger.warn('Could not save a Job’s page grant', { id: job.id, error: err?.message });
    }
  }

  // A click that buys, sends, posts or deletes: one the user let the Job repeat, or the user's OK
  // now on a watched run. With nobody watching it is refused.
  async function confirmAction({ wc: target, url, verb, control, what }) {
    const site = pageSite(url);
    const key = similarKey(url, verb, control);
    if (pageGrant(writes, site)?.actions?.some((a) => a.key === key)) return;
    if (!watched) {
      needs.push({ site, control: true, action: what });
      throw new Error(
        `Nobody is watching this Job, so it can’t ${what} on ${site} unless the user allowed clicks like it on a run ` +
          'they watched. Don’t do it; say in your answer what is left for the user.'
      );
    }
    const ok = await permissions.requestPermission(`${PAGE_ACTION_PERM}:job-${++asks}`, target, {
      action: what,
      job: job.title || 'Untitled',
      similar: similarLabel(url, control, 'on this Job’s later runs, with nobody watching'),
    });
    if (ok === 'similar') await grant(site, { control: true, action: { key, label: what } });
    if (!ok)
      throw new Error(
        `The user said no to: ${what}. Don’t do it; say in your answer what is left.`
      );
  }

  const session = pageControl.createSession({
    // Every prompt the session asks itself goes through the hooks above; this is a fallback.
    requestPermission: (perm, target, opts) =>
      watched ? permissions.requestPermission(perm, target, opts) : Promise.resolve(false),
    stopTurn,
    allowSite: async (url) => {
      const off = pageOffLimits(url);
      if (off) throw new Error(off);
      await mayUse(url, true);
      return true;
    },
    confirmAction,
    focus: watched,
  });

  // The watched run's tab: made on first use, in the Jobs group of the user's window. `url` null
  // opens a new tab page, for a prompt before the first page.
  async function ensureTab(url) {
    if (!watched) return ensureHidden();
    if (wc && !wc.isDestroyed()) return wc;
    const group = tabManager.findOrCreateTabGroup(watchWin, JOB_TAB_GROUP);
    /** @type {any} */
    const tabOpts = { setActive: true };
    const tab = group
      ? tabManager.createInGroup(watchWin, group.id, url || undefined, tabOpts)
      : tabManager.create(watchWin, url || undefined, tabOpts);
    const pane = tab?.primaryPane;
    if (!pane) throw new Error('Could not open a tab for the Job');
    wc = pane.webContents;
    session.noteOpened(wc);
    return wc;
  }

  // The hidden page: a window that is never shown, in the Job's Space's session. Its pages can't
  // open windows of their own.
  function ensureHidden() {
    if (wc && !wc.isDestroyed()) return wc;
    const partition = spacePartition(space);
    if (partition) registerForPartition(partition);
    hiddenWin = new BrowserWindow({
      show: false,
      width: WIDTH,
      height: HEIGHT,
      title: `Job: ${job.title}`,
      webPreferences: {
        preload: path.join(__dirname, 'fg', 'webview-preload', 'index.build.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
        defaultEncoding: 'utf-8',
        safeDialogs: true,
        // Hidden is how it always is: keep its timers and paint running like a page on screen.
        backgroundThrottling: false,
        ...(partition ? { partition } : {}),
      },
    });
    wc = hiddenWin.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.setAudioMuted(true);
    session.noteOpened(wc);
    return wc;
  }

  async function load(url) {
    const fresh = !wc || wc.isDestroyed();
    const target = await ensureTab(url);
    // A new watched tab is already loading `url`; anything else goes there now.
    if (!(watched && fresh)) target.loadURL(url).catch(() => {});
    await waitForLoad(target);
    await pageControl.settle(target);
    return target;
  }

  async function text(target) {
    let body = '';
    try {
      body = await target.executeJavaScriptInIsolatedWorld(PRELOAD_WORLD, [
        { code: 'document.body ? document.body.innerText : ""' },
      ]);
    } catch (err) {
      throw new Error(`Could not read the page: ${err?.message || err}`);
    }
    return typeof body === 'string' ? body.trim() : '';
  }

  // The page's text, or one part of it from `offset` when it is long (text-part.mjs), with where the
  // next part starts: readCurrentPage with that offset reads on. A long page is saved whole in the
  // run's scratch space (scratch.mjs), and later parts come from that copy.
  async function read(offset = 0, scratch = null) {
    if (ended) throw new Error('The run is over.');
    if (!wc || wc.isDestroyed()) throw new Error('No page is open. Open one with openPage.');
    // A click can go to another site: it needs its own grant to be read.
    await mayUse(wc.getURL(), false);
    const page = wc;
    const { part, saved } = await readPageText(scratch, {
      url: page.getURL(),
      offset,
      source: 'openPage',
      load: () => text(page),
    });
    return JSON.stringify({
      url: page.getURL(),
      title: page.getTitle() || '',
      text: part.text || '(This page has no text.)',
      ...partFields(part, 'readCurrentPage', '', saved),
    });
  }

  return {
    get watched() {
      return watched;
    },

    // openPage: the page at `url`, read. Names (hyper://<name>/) go to what the user named.
    async open(rawUrl, scratch = null) {
      if (ended) throw new Error('The run is over.');
      const given = jobPageUrl(rawUrl);
      const url = names.resolveUrl(given, space) || given;
      jobPageUrl(url);
      // Opening a page sends its URL to the site (ADR-0037).
      await egress?.check?.(url);
      await mayUse(url, false);
      await load(url);
      return read(0, scratch);
    },

    read,

    /**
     * A page action (snapshotPage, clickElement, …) on the Job's page.
     * @param {string} name
     * @param {Record<string, any>} args
     * @param {{ emitter?: any, id?: string }} [step]
     */
    async run(name, args, { emitter, id } = {}) {
      if (ended) throw new Error('The run is over.');
      if (!wc || wc.isDestroyed())
        throw new Error('No page is open. Open one with openPage first.');
      // A snapshot only reads, but it lists what the page shows: the site needs its open grant.
      if (name === 'snapshotPage') await mayUse(wc.getURL(), false);
      return session.run(name, args || {}, { tab: { sender: wc }, emitter, id });
    },

    // The user wants to see the page (Watch, in My Library → Jobs): a watched run's tab comes to the
    // front of its window; a hidden page shows in a window of its own, which stays until they close
    // it. While the run goes on, closing that window hides it again, so the run keeps its page.
    // false when there is no page to show (none opened yet, or its tab was closed).
    show() {
      if (!wc || wc.isDestroyed()) return false;
      if (watched) {
        const tab = tabManager.findTab(wc);
        const win = tab && tabManager.findContainingWindow(wc);
        if (!tab || !win) return false;
        tabManager.setActive(win, tab);
        win.focus();
        return true;
      }
      if (!hiddenWin || hiddenWin.isDestroyed()) return false;
      if (!shown) {
        shown = true;
        hiddenWin.on('close', (e) => {
          if (ended || quitting) return;
          e.preventDefault();
          hiddenWin.hide();
        });
      }
      hiddenWin.show();
      hiddenWin.focus();
      return true;
    },

    // The run is over: take the cursor off the page, close the hidden window unless the user is
    // looking at it. A watched run's tab stays, so the user sees where the Job left off.
    end() {
      if (ended) return;
      ended = true;
      session.end();
      if (hiddenWin && !hiddenWin.isDestroyed() && !(shown && hiddenWin.isVisible())) hiddenWin.destroy();
      hiddenWin = null;
    },
  };
}

// The session partition of the Space with this Root Drive key; '' for the default session.
function spacePartition(spaceKey) {
  if (!spaceKey) return '';
  try {
    const id = spaceIdOfKey(spaceKey);
    const space = id ? spacesDb.getCachedAll().find((s) => s.id === id) : null;
    return space?.partition || '';
  } catch {
    return '';
  }
}

// Wait for the page to finish loading, for at most LOAD_TIMEOUT. A load just asked for may not have
// started yet: give it a moment to.
async function waitForLoad(wc) {
  if (!wc || wc.isDestroyed()) return;
  if (!wc.isLoading()) await once(wc, 'did-start-loading', 1500);
  if (!wc.isDestroyed() && wc.isLoading()) await once(wc, 'did-stop-loading', LOAD_TIMEOUT);
}

function once(wc, event, ms) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      wc.removeListener(event, done);
      resolve(undefined);
    };
    const timer = setTimeout(done, ms);
    wc.on(event, done);
  });
}
