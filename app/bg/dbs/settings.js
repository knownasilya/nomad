import EventEmitter from 'events';
import sqlite3 from 'sqlite3';
import path from 'path';
import { cbPromise } from '../../lib/functions';
import { setupSqliteDB } from '../lib/db';
import { getEnvVar } from '../lib/env';
import * as profileDb from './profile-data-db';

const CACHED_VALUES = ['new_tabs_in_foreground'];
const JSON_ENCODED_SETTINGS = ['search_engines', 'adblock_lists'];

// Settings that are always global (never per-space)
const GLOBAL_SETTINGS = new Set([
  'auto_update_enabled',
  'run_background',
  'launch_on_startup',
  'analytics_enabled',
  'active_space_id',
  'no_welcome_tab',
]);

// globals
// =

var db;
var migrations;
var setupPromise;
var defaultSettings;
var events = new EventEmitter();
var cachedValues = {};

// exported methods
// =

/**
 * @param {Object} opts
 * @param {string} opts.userDataPath
 * @param {string} opts.homePath
 */
export const setup = async function (opts) {
  // open database
  var dbPath = path.join(opts.userDataPath, 'Settings');
  db = new sqlite3.Database(dbPath);
  setupPromise = setupSqliteDB(db, { migrations }, '[SETTINGS]');

  defaultSettings = {
    auto_update_enabled: 1,
    auto_redirect_to_dat: 1,
    custom_start_page: 'blank',
    new_tab: 'beaker://desktop/',
    new_tabs_in_foreground: 0,
    run_background: 1,
    default_zoom: 0,
    launch_on_startup: 0,
    browser_theme: 'system',
    analytics_enabled: 1,
    extended_network_index: 'default',
    extended_network_index_url: '',
    search_engines: [
      {
        name: 'Startpage',
        url: 'https://startpage.com/do/dsearch?query=',
        selected: true,
      },
      {
        name: 'DuckDuckGo',
        url: 'https://www.duckduckgo.com/?q=',
      },
      { name: 'Nomad', url: 'beaker://desktop/?q=' },
      { name: 'Google', url: 'https://www.google.com/search?q=' },
    ],
    adblock_lists: [
      {
        name: 'EasyList',
        url: 'https://easylist.to/easylist/easylist.txt',
        selected: true,
      },
      {
        name: 'EasyPrivacy',
        url: 'https://easylist.to/easylist/easyprivacy.txt',
      },
      {
        name: 'EasyList Cookie List',
        url: 'https://easylist-downloads.adblockplus.org/easylist-cookie.txt',
      },
      {
        name: "Fanboy's Social Blocking List",
        url: 'https://easylist.to/easylist/fanboy-social.txt',
      },
      {
        name: "Fanboy's Annoyance List",
        url: 'https://easylist.to/easylist/fanboy-annoyance.txt',
      },
      {
        name: 'Adblock Warning Removal List',
        url: 'https://easylist-downloads.adblockplus.org/antiadblockfilters.txt',
      },
    ],
  };

  for (let k of CACHED_VALUES) {
    cachedValues[k] = await get(k);
  }
};

export const on = events.on.bind(events);
export const once = events.once.bind(events);

/**
 * @param {string} key
 * @param {string | number | object} value
 * @returns {Promise<void>}
 */
export async function set(key, value) {
  if (JSON_ENCODED_SETTINGS.includes(key)) {
    value = JSON.stringify(value);
  }
  await setupPromise.then(() =>
    cbPromise((cb) => {
      db.run(
        `
      INSERT OR REPLACE
        INTO settings (key, value, ts)
        VALUES (?, ?, ?)
    `,
        [key, value, Date.now()],
        cb
      );
    })
  );
  if (CACHED_VALUES.includes(key)) cachedValues[key] = value;
  events.emit('set', key, value);
  events.emit('set:' + key, value);
}

/**
 * @param {string} key
 * @returns {string | number}
 */
export function getCached(key) {
  return cachedValues[key];
}

export function setCachedValue(key, value) {
  if (CACHED_VALUES.includes(key)) cachedValues[key] = value;
}

/**
 * @param {string} key
 * @returns {boolean | Promise<string | number | object>}
 */
export const get = function (key) {
  // env variables
  if (key === 'no_welcome_tab') {
    return Number(getEnvVar('BEAKER_NO_WELCOME_TAB')) === 1;
  }
  // stored values
  return setupPromise.then(() =>
    cbPromise((cb) => {
      db.get(`SELECT value FROM settings WHERE key = ?`, [key], (err, row) => {
        if (row) {
          row = row.value;
          if (JSON_ENCODED_SETTINGS.includes(key)) {
            try {
              row = JSON.parse(row);
            } catch (e) {
              row = defaultSettings[key];
            }
          }
        }
        if (typeof row === 'undefined') {
          row = defaultSettings[key];
        }
        cb(err, row);
      });
    })
  );
};

/**
 * @returns {Promise<Object>}
 */
export const getAll = function () {
  return setupPromise.then((v) =>
    cbPromise((cb) => {
      db.all(`SELECT key, value FROM settings`, (err, rows) => {
        if (err) {
          return cb(err);
        }
        var obj = {};
        rows.forEach((row) => {
          // parse non-string values
          if (JSON_ENCODED_SETTINGS.includes(row.key)) {
            try {
              row.value = JSON.parse(row.value);
            } catch (e) {
              row.value = defaultSettings[row.key];
            }
          }
          obj[row.key] = row.value;
        });

        obj = Object.assign({}, defaultSettings, obj);
        obj.no_welcome_tab = Number(getEnvVar('BEAKER_NO_WELCOME_TAB')) === 1;
        cb(null, obj);
      });
    })
  );
};

/**
 * Get a setting for a specific space.
 * For global keys, reads from the global settings table.
 * For per-space keys, reads from space_settings and falls back to hardcoded defaults
 * (never the shared global settings table, so spaces are fully isolated).
 * @param {number} spaceId
 * @param {string} key
 */
export async function getForSpace(spaceId, key) {
  if (!spaceId || GLOBAL_SETTINGS.has(key)) return get(key);
  const row = await profileDb.get(
    'SELECT value FROM space_settings WHERE spaceId = ? AND key = ?',
    [spaceId, key]
  );
  if (row && row.value !== undefined) {
    let val = row.value;
    if (JSON_ENCODED_SETTINGS.includes(key)) {
      try { val = JSON.parse(val); } catch (e) { val = defaultSettings[key]; }
    }
    return val;
  }
  // Fall back to hardcoded defaults — not the global settings table —
  // so changes in one space can never bleed into another.
  return defaultSettings[key];
}

/**
 * Get all settings for a specific space.
 * Merges: hardcoded defaults + global settings (for GLOBAL_SETTINGS keys only) + space overrides.
 * @param {number} spaceId
 */
export async function getAllForSpace(spaceId) {
  if (!spaceId) return getAll();

  // Start from hardcoded defaults
  var obj = Object.assign({}, defaultSettings);

  // Overlay global-only keys from the global settings table
  for (const key of GLOBAL_SETTINGS) {
    const val = await get(key);
    if (val !== undefined) obj[key] = val;
  }

  // Overlay space-specific settings
  const rows = await profileDb.all(
    'SELECT key, value FROM space_settings WHERE spaceId = ?',
    [spaceId]
  );
  for (const row of rows) {
    let val = row.value;
    if (JSON_ENCODED_SETTINGS.includes(row.key)) {
      try { val = JSON.parse(val); } catch (e) { continue; }
    }
    obj[row.key] = val;
  }

  obj.no_welcome_tab = Number(getEnvVar('BEAKER_NO_WELCOME_TAB')) === 1;
  return obj;
}

/**
 * Set a setting for a specific space.
 * @param {number} spaceId
 * @param {string} key
 * @param {string|number|object} value
 */
export async function setForSpace(spaceId, key, value) {
  if (!spaceId || GLOBAL_SETTINGS.has(key)) return set(key, value);
  let stored = value;
  if (JSON_ENCODED_SETTINGS.includes(key)) stored = JSON.stringify(value);
  await profileDb.run(
    'INSERT OR REPLACE INTO space_settings (spaceId, key, value, ts) VALUES (?, ?, ?, ?)',
    [spaceId, key, stored, Date.now()]
  );
  // Emit space-scoped events only — NOT the global 'set:key' events,
  // so other spaces' caches and listeners are not affected.
  events.emit('set-space:' + spaceId, key, value);
  events.emit('set-space:' + spaceId + ':' + key, value);
}

// internal methods
// =

migrations = [
  // version 1
  function (cb) {
    db.exec(
      `
      CREATE TABLE settings(
        key PRIMARY KEY,
        value,
        ts
      );
      INSERT INTO settings (key, value) VALUES ('auto_update_enabled', 1);
      PRAGMA user_version = 1;
    `,
      cb
    );
  },
  // version 2
  function (cb) {
    db.exec(
      `
      INSERT INTO settings (key, value) VALUES ('start_page_background_image', '');
      PRAGMA user_version = 2
    `,
      cb
    );
  },
];
