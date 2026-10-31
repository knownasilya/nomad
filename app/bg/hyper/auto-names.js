// @ts-nocheck
//
// Auto-names (ADR-0018 amendment): when the user keeps coming back to a site, the AI gives it a
// Name from its title and description, so typing a short word already goes there. The rules are in
// shared/names.mjs (siteOf, nameAnchors, autoNameError, pickAutoName); this module decides when.
//
// - Only a site visited AUTO_NAME_MIN_VISITS times (in different hours, history.countSiteVisits)
//   and not named yet. Each site is asked about once (sitedata `auto_name`), so a name the user
//   removes doesn't come back.
// - The name must be spelled from the site's own host (or a drive's title), so a page can't take
//   a name like "gmail" by what it says about itself.
// - This Device's AI runtime only (ai.ts completeText): it never borrows another Device's AI.
// - Only with a Vault: setting a name would otherwise make one in the background.
// - The AI page (nomad://ai/setup) → "Name sites I visit often" (`ai_auto_names`) turns it off.

import * as logLib from '../logger';
import * as settingsDb from '../dbs/settings';
import * as historyDb from '../dbs/history';
import * as sitedata from '../dbs/sitedata';
import * as vault from './vault';
import * as names from './names';
import {
  AUTO_NAME_MIN_VISITS,
  autoNameMessages,
  nameAnchors,
  pickAutoName,
  siteOf,
} from '../../../shared/names.mjs';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'auto-names' });

export const SETTING = 'ai_auto_names';
const ASKED_KEY = 'auto_name'; // sitedata: the name given, or "-" when the AI had none
const RETRY_MS = 10 * 60e3; // after no runtime answered

let complete = null; // (messages) => Promise<string | null>, from ai.ts (completeText)
let queue = Promise.resolve();
const pending = new Set();
const retryAt = new Map(); // site -> ms

// `complete` is passed in by main.js: importing the AI stack here would loop back to the tabs.
export function setup(opts = {}) {
  complete = opts.complete || null;
}

// A page finished loading and its visit is in history (ui/tabs/pane.js). One site at a time, in
// the order visited.
export function onVisit({ url, title, driveTitle, webContents }) {
  const site = siteOf(url);
  if (!site || !complete || pending.has(site)) return;
  if ((retryAt.get(site) || 0) > Date.now()) return;
  pending.add(site);
  queue = queue
    .then(() => consider({ site, title, driveTitle, webContents }))
    .catch((err) => {
      retryAt.set(site, Date.now() + RETRY_MS);
      logger.warn('Auto-name failed', { site, error: err?.message || String(err) });
    })
    .finally(() => pending.delete(site));
}

async function consider({ site, title, driveTitle, webContents }) {
  if (!(await settingsDb.get(SETTING))) return;
  if (!(await vault.hasVault())) return;
  if (names.listAll().some((r) => siteOf(r.url) === site)) return;
  if (await sitedata.get(site, ASKED_KEY, { dontExtractOrigin: true })) return;
  if ((await historyDb.countSiteVisits(0, site)) < AUTO_NAME_MIN_VISITS) return;

  const anchors = nameAnchors(site, driveTitle || title);
  if (!anchors.length) return markAsked(site, '-');
  const page = await readPage(webContents, site);
  const reply = await complete(
    autoNameMessages({ site, title: driveTitle || title, ...page, anchors })
  );
  if (reply === null) {
    // No AI runtime on this Device right now. Ask again on a later visit.
    retryAt.set(site, Date.now() + RETRY_MS);
    return;
  }
  const name = pickAutoName(reply, anchors);
  if (!name || names.get(name)) {
    logger.info('No auto-name', { site, reply: String(reply).slice(0, 80) });
    return markAsked(site, '-');
  }
  await names.set({ name, url: site, title: driveTitle || title || site, auto: true });
  await markAsked(site, name);
  logger.info('Auto-named', { name, site });
}

function markAsked(site, value) {
  return sitedata.set(site, ASKED_KEY, value, { dontExtractOrigin: true });
}

// The page's description and first heading, when the tab still shows that site. Read in the
// preload's isolated world (999), so the page's own scripts can't stand in for the DOM API.
async function readPage(wc, site) {
  try {
    if (!wc || wc.isDestroyed() || siteOf(wc.getURL()) !== site) return {};
    const res = await wc.executeJavaScriptInIsolatedWorld(999, [
      {
        code: `(() => {
          const meta = (s) => (document.querySelector(s)?.getAttribute('content') || '').trim();
          return {
            description: (meta('meta[name="description"]') || meta('meta[property="og:description"]')).slice(0, 500),
            heading: (document.querySelector('h1')?.textContent || '').trim().slice(0, 200),
          };
        })()`,
      },
    ]);
    return {
      description: typeof res?.description === 'string' ? res.description : '',
      heading: typeof res?.heading === 'string' ? res.heading : '',
    };
  } catch {
    return {};
  }
}
