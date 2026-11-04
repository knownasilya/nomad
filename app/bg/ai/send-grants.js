// Sites the user let their AI send to for 3 months (ADR-0037 amendment). The `aiSendData` prompt's
// "Allow for 3 months" box adds one; the AI page (nomad://ai/sites) lists them, extends one by
// another 3 months, or removes it. They live on this computer only, like secrets:
//
//   <userData>/ai-send-grants.json   { version: 1, grants: [{ host, grantedAt, until }] }
//
// The egress guard asks `covers(host)` before it prompts (ai.ts). The rules are egress.mjs.

import { app } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { liveSendGrants, sendGrantCovers, withSendGrant, withoutSendGrant } from './egress.mjs';

const FILE = 'ai-send-grants.json';

// Emits 'changed' when a grant is added, extended or removed.
export const events = new EventEmitter();

/** @type {{ host: string, grantedAt: number, until: number }[]} */
let grants = [];
/** @type {Promise<void> | null} */
let loading = null;
/** @type {Promise<any>} */
let writes = Promise.resolve();

function filePath() {
  return path.join(app.getPath('userData'), FILE);
}

function load() {
  if (!loading) {
    loading = fs.promises
      .readFile(filePath(), 'utf8')
      .then((text) => {
        const data = JSON.parse(text);
        grants = liveSendGrants(data?.grants);
      })
      .catch(() => {
        grants = [];
      });
  }
  return loading;
}

function save(next) {
  grants = next;
  events.emit('changed');
  const text = JSON.stringify({ version: 1, grants: next }, null, 2);
  writes = writes
    .catch(() => {})
    .then(() => fs.promises.writeFile(filePath(), text, { mode: 0o600 }));
  return writes;
}

/** The running grants, soonest to end first. */
export async function list() {
  await load();
  return liveSendGrants(grants);
}

/** Whether the user allowed `host` and the grant still runs. */
export async function covers(host) {
  await load();
  return sendGrantCovers(host, grants);
}

/** Allow `host` for 3 months from now: a new grant, or one extended. */
export async function grant(host) {
  await load();
  const next = withSendGrant(grants, host);
  await save(next);
  // withSendGrant puts the new or extended grant last.
  return next[next.length - 1];
}

/** Stop allowing `host`: the next request there asks again. */
export async function remove(host) {
  await load();
  await save(withoutSendGrant(grants, host));
}
