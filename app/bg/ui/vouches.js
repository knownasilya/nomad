// @ts-nocheck
//
// Vouches on desktop (ADR-0045): one Persona says "I've had this person over at my home". The rules
// are shared/vouches.mjs and the moving parts (give, take in, accept, show, check, the guard) are
// shared/vouch-engine.mjs, the same code the phone runs. This module gives the engine what it
// needs here: the Vault's app records, the Personas and their Profile Drives (bg/ui/personas.js),
// the Persona Inbox to deliver with (bg/hyper/inbox.js), the people the user knows (Contacts, Names
// and the drives Reader follows) and an OS notification for the guard.
//
// Who calls in:
//   - nomad.personas (web-apis/bg/personas.ts): My Library → Personas → Vouches, site-info.
//   - nomad.session (web-apis/bg/session.ts): the `vouches` permission and the login prompt.
// No page API gives, lists or accepts Vouches, and the AI has no capability for them (§9).

import crypto from 'crypto';
import { EventEmitter } from 'events';
import { Notification } from 'electron';
import * as vault from '../hyper/vault';
import * as personas from './personas';
import * as inbox from '../hyper/inbox';
import * as names from '../hyper/names';
import { readerOf } from '../web-apis/bg/vault-apps';
import * as logLib from '../logger';
import * as V from '../../../shared/vouches.mjs';
import * as I from '../../../shared/inbox.mjs';
import { createVouchEngine } from '../../../shared/vouch-engine.mjs';

const logger = logLib.get().child({ category: 'browser', subcategory: 'vouches' });

// Emits 'changed' when anything My Library → Vouches shows changed.
export const events = new EventEmitter();

const GUARD_MS = 5 * 60 * 1000;
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

let engine = null;
let timer = null;
let soon = null;

function store() {
  return {
    read: (path) => vault.readAppRecord(path),
    list: (prefix) => vault.listAppRecords(prefix),
    listPaths: (prefix) => vault.listAppRecordPaths(prefix),
    put: (path, obj) => vault.putAppRecord(path, obj),
    del: (path) => vault.delAppRecord(path),
  };
}

// People the user knows (§6): their Contacts, Names that point at a drive, and the drives Reader
// follows in any Space. All read here, from the user's own data.
async function known() {
  const out = new Set();
  for (const c of await vault.listAppRecords(I.CONTACTS_PREFIX).catch(() => [])) {
    if (I.isContact(c) && c.state === 'accepted') out.add(I.profileKeyOf(c.profileUrl));
  }
  for (const n of names.listAll()) {
    const key = V.profileKeyOf(n?.url);
    if (key) out.add(key);
  }
  try {
    for (const s of await vault.listSpaces()) {
      if (!s?.rootDriveKey || s.movedTo) continue;
      const r = await readerOf(s.rootDriveKey).catch(() => null);
      for (const url of r?.follows || []) {
        const key = V.profileKeyOf(url);
        if (key) out.add(key);
      }
    }
  } catch {}
  out.delete(null);
  return [...out];
}

function notifyForeign({ label }) {
  logger.warn('A vouch in a Persona’s profile drive wasn’t written by one of the user’s devices');
  try {
    if (!Notification.isSupported()) return;
    new Notification({
      title: `Someone added a vouch to your Persona ${label}`,
      body: 'None of your devices wrote it. Someone else may be able to change that profile drive. See My Library → Personas.',
    }).show();
  } catch {}
}

export function setup() {
  engine = createVouchEngine({
    store: store(),
    sha256hex,
    randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)),
    personas: () => personas.inboxPersonas(),
    readProfileFile: (url, path) => personas.readProfileFile(url, path),
    writeProfileFile: (id, path, obj) => personas.writeProfileFile(id, path, obj),
    send: ({ personaId, to, vouch, replyTo }) =>
      inbox.send({ personaId, to, text: '', vouch, replyTo: replyTo || null }),
    reachable: async (personaId, profileUrl) => !!(await inbox.thread(personaId, profileUrl))?.reachable,
    known,
    onForeign: notifyForeign,
    onChange: () => events.emit('changed'),
  });
  // Take Vouches in from Messages, on this Device and from the Vault, and watch the lists.
  const poke = () => {
    clearTimeout(soon);
    soon = setTimeout(() => {
      engine
        .intake()
        .catch((e) => logger.warn('Could not take in vouches', { error: String(e) }))
        .finally(() => engine.refresh().then(() => events.emit('changed')).catch(() => {}));
    }, 1500);
  };
  vault.events.on('changed', poke);
  inbox.events.on('changed', poke);
  personas.events.on('changed', poke);
  personas.onRemove((id) => engine.forgetPersona(id));
  personas.onSessionVouches((personaId, ids) => engine.sessionVouches(personaId, ids));
  poke();
  const guard = () => {
    if (personas.deviceInfo().vaultReady) engine.guard().catch(() => {});
  };
  setTimeout(guard, 30 * 1000).unref?.();
  timer = setInterval(guard, GUARD_MS);
  timer.unref?.();
}

function need() {
  if (!engine) throw new Error('Vouches aren’t available yet. Try again in a moment.');
  return engine;
}

// For nomad.personas
// =

export async function summary() {
  await personas.ensureLoaded();
  const s = await need().summary();
  // A Persona's thumb is a path in its drive; a nomad:// page loads it from the drive's URL.
  const pic = (who) => ({ ...who, thumbUrl: who.thumb ? `${who.url.replace(/\/$/, '')}/${who.thumb.replace(/^\//, '')}` : '' });
  return {
    ...s,
    held: s.held.map((r) => ({ ...r, host: pic(r.host) })),
    given: s.given.map((r) => ({ ...r, guest: pic(r.guest) })),
  };
}

export async function profileVouches(url) {
  const res = await need().profileVouches(url);
  const pic = (it) =>
    it.host
      ? { ...it, host: { ...it.host, thumbUrl: it.host.thumb ? `${it.host.url.replace(/\/$/, '')}/${it.host.thumb.replace(/^\//, '')}` : '' } }
      : it;
  return { ...res, known: res.known.map(pic), others: res.others.map(pic) };
}

export const preview = (o) => need().preview(o);
export const give = (o) => need().give(o);
export const renew = (personaId, id) => need().renew(personaId, id);
export const withdraw = (personaId, id) => need().withdraw(personaId, id);
export const forgetGiven = (personaId, id) => need().forgetGiven(personaId, id);
export const accept = (personaId, id) => need().accept(personaId, id);
export const decline = (personaId, id) => need().decline(personaId, id);
export const setShown = (personaId, id, shown) => need().setShown(personaId, id, shown);

// For the login prompt and the Session (session.ts, personas.sessionViewFor)
// =

export async function loginChoices(personaIds) {
  if (!engine) return {};
  await engine.refresh().catch(() => {});
  const out = {};
  const hosts = [];
  for (const id of personaIds) {
    out[id] = engine.loginChoices(id);
    hosts.push(...out[id].map((v) => v.host));
  }
  const titles = await engine.hostTitles(hosts).catch(() => ({}));
  for (const id of personaIds) out[id] = out[id].map((v) => ({ ...v, hostTitle: titles[v.host] || '' }));
  return out;
}

export function sessionVouches(personaId, ids) {
  return engine ? engine.sessionVouches(personaId, ids) : [];
}

export function newCount() {
  return engine ? engine.newCount() : 0;
}
