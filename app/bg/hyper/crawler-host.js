// @ts-nocheck
//
// Runs the discovery crawler (tools/crawler.mjs, ADR-0014/0016) inside the browser, so
// nomad://search works without starting one by hand. On by default; the `crawler_enabled` setting
// turns it off and on at once, and syncs to the user's other Devices (synced-settings.js).
//
// The crawler gets an Electron utility process: it brings its own Hyperswarm and Corestore, and a
// crash there must not take the browser down. It serves the search API on 127.0.0.1 only, at the
// port nomad://search queries by default.
//
// This browser's own listed Drives are handed to the crawler directly (discovery.js), not left to
// a DHT lookup: a lookup only finds what was announced at that moment, so a Drive listed just after
// the crawler started could stay missing from your own search for minutes. The full set is sent on
// each change, so unlisting takes the Drive out at once too.
//
// Another program can already hold CRAWLER_PORT (a dev server on 8787, say). The crawler then
// serves on a free port and reports it; nomad://search asks getEndpoint() for the address.

import { app, utilityProcess } from 'electron';
import path from 'path';
import * as logLib from '../logger';
import * as settingsDb from '../dbs/settings';
import * as discovery from './discovery';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'crawler' });

export const CRAWLER_SETTING = 'crawler_enabled';
export const CRAWLER_PORT = 8787; // keep in step with FALLBACK_ENDPOINT in userland/search/js/main.js
const STOP_GRACE_MS = 3000;
const ENDPOINT_WAIT_MS = 10_000; // how long getEndpoint() waits for a starting crawler's port

let child = null;
let port = null; // the port the running crawler's search API is on, once it says
let portWaiters = [];

export function setup() {
  settingsDb.on('set:' + CRAWLER_SETTING, () => sync());
  discovery.onChange(() => sendLocalListings());
  app.on('will-quit', () => stop());
  sync();
}

export function isRunning() {
  return !!child;
}

// The address of the built-in crawler's search API, or null when the crawler is off or has no API.
// While the crawler is starting, waits a little for it to report its port.
export async function getEndpoint() {
  if (!child) return null;
  if (!port) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, ENDPOINT_WAIT_MS);
      portWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  return port ? `http://127.0.0.1:${port}` : null;
}

function setPort(value) {
  port = value;
  const waiters = portWaiters;
  portWaiters = [];
  for (const w of waiters) w();
}

async function sync() {
  const value = await settingsDb.get(CRAWLER_SETTING);
  if (isOn(value)) start();
  else stop();
}

function start() {
  if (child) return;
  // Built by scripts/build.js from tools/crawler-process.mjs.
  const entry = path.join(app.getAppPath(), 'tools/crawler-process.build.js');
  const args = [
    '--port',
    String(CRAWLER_PORT),
    '--host',
    '127.0.0.1',
    '--storage',
    path.join(app.getPath('userData'), 'crawler'),
  ];
  let proc;
  try {
    proc = utilityProcess.fork(entry, args, { serviceName: 'Nomad crawler', stdio: 'pipe' });
  } catch (err) {
    logger.error('Could not start the crawler', { error: err?.message });
    return;
  }
  child = proc;
  logger.info('Crawler started', { port: CRAWLER_PORT });
  // Sending is idempotent (always the full set), so send now and again once the process is up, in
  // case a message posted before then is not delivered.
  sendLocalListings();
  proc.once('spawn', () => sendLocalListings());
  proc.stdout?.on('data', (d) => logger.info(String(d).trim()));
  proc.stderr?.on('data', (d) => logger.warn(String(d).trim()));
  proc.on('message', (msg) => {
    if (child === proc && msg?.type === 'listening' && Number.isInteger(msg.port)) {
      logger.info('Crawler search API listening', { port: msg.port });
      setPort(msg.port);
    }
  });
  proc.on('exit', (code) => {
    if (child === proc) {
      child = null;
      setPort(null);
    }
    logger.info('Crawler exited', { code });
  });
}

function sendLocalListings() {
  if (!child) return;
  try {
    child.postMessage({ type: 'listings', frames: discovery.getListingFrames() });
  } catch (err) {
    logger.warn('Could not send listings to the crawler', { error: err?.message });
  }
}

// Ask the crawler to close its swarm and store; kill it if it hasn't gone after a grace period.
function stop() {
  if (!child) return;
  const proc = child;
  child = null;
  setPort(null);
  try {
    proc.postMessage('stop');
  } catch {}
  setTimeout(() => {
    try {
      proc.kill();
    } catch {}
  }, STOP_GRACE_MS).unref?.();
}

// settingsDb stores text: '0' and 'false' are off.
function isOn(value) {
  return !(value === 0 || value === '0' || value === false || value === 'false' || value == null);
}
