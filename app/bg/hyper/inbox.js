// @ts-nocheck
//
// The Persona Inbox on desktop (ADR-0036): direct messages to the user's Personas. The rules are
// shared/inbox.mjs and the mailbox / outbox / checks are shared/inbox-engine.mjs, the same code the
// phone runs. This module gives the engine what it needs here: the swarm's HyperDHT node, the Vault's
// app records, the Personas (bg/ui/personas.js) and OS notifications.
//
// Who calls in: nomad.inbox (web-apis/bg/inbox.ts) for nomad://messages, My Library → Personas and
// site-info. No page API reads or sends messages (§7.1), and the AI has no capability for them (§7.6).

import crypto from 'crypto';
import { EventEmitter } from 'events';
import { Notification, powerMonitor } from 'electron';
import b4a from 'b4a';
import sodium from 'sodium-universal';
import * as vault from './vault';
import * as daemon from './daemon';
import * as personas from '../ui/personas';
import * as deviceActivity from '../ui/device-activity';
import * as settingsDb from '../dbs/settings';
import * as logLib from '../logger';
import * as I from '../../../shared/inbox.mjs';
import { createInboxEngine, dhtTransport } from '../../../shared/inbox-engine.mjs';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'inbox' });

// Emits 'changed' when anything nomad://messages shows changed.
export const events = new EventEmitter();

let engine = null;
let openConversation = null; // (personaId, profileUrl) -> open nomad://messages there

const hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

function store() {
  return {
    read: (path) => vault.readAppRecord(path),
    list: (prefix) => vault.listAppRecords(prefix),
    listPaths: (prefix) => vault.listAppRecordPaths(prefix),
    put: (path, obj) => vault.putAppRecord(path, obj),
    del: (path) => vault.delAppRecord(path),
  };
}

async function notify({ personaId, personaLabel, from, title, text }) {
  if (!Number(await settingsDb.get('inbox_notify'))) return;
  if (!Notification.isSupported()) return;
  // The user is on another of their Devices, which shows it (bg/ui/device-activity.js).
  if (!deviceActivity.notifyHere()) return;
  const many = personas.inboxPersonas().length > 1;
  const n = new Notification({
    title: many ? `${title} · to ${personaLabel}` : title,
    // Plain text, cut short; the OS shows it, nothing loads from it.
    body: text.length > 200 ? `${text.slice(0, 200)}…` : text,
  });
  n.on('click', () => openConversation?.(personaId, from));
  n.show();
}

export function setup({ open } = {}) {
  openConversation = open || null;
  const swarm = daemon.getSwarm();
  if (!swarm?.dht) {
    logger.warn('No DHT node yet; the Inbox stays off');
    return;
  }
  engine = createInboxEngine({
    crypto: I.cryptoFromSodium(sodium),
    randomBytes: (n) => new Uint8Array(crypto.randomBytes(n)),
    sha256hex: hex,
    store: store(),
    ...dhtTransport(swarm.dht, swarm.dht.constructor, b4a),
    personas: () => personas.inboxPersonas(),
    vaultReady: () => personas.deviceInfo().vaultReady,
    deviceKey: () => personas.deviceInfo().deviceKey,
    deviceKeys: () => personas.deviceInfo().deviceKeys,
    readProfile: (url) => personas.readProfileManifest(url),
    writeProfileInbox: (id, inbox) => personas.writeProfileInbox(id, inbox),
    notify: (n) => {
      notify(n).catch(() => {});
    },
    onChange: () => events.emit('changed'),
    log: {
      info: (msg, o) => logger.info(msg, o),
      warn: (msg, o) => logger.warn(msg, o),
    },
  });
  engine.start();
  personas.events.on('changed', () => engine.poke());
  personas.onRemove((id) => engine.forgetPersona(id));
  // A lid that closes takes the mailbox off the DHT cleanly; opening it puts it back and retries
  // the outbox at once.
  try {
    powerMonitor.on('resume', () => {
      engine.poke();
      engine.flush().catch(() => {});
    });
  } catch {}
}

export async function shutdown() {
  if (engine) await engine.close().catch(() => {});
}

function need() {
  if (!engine) throw new Error('Messages aren’t available yet. Try again in a moment.');
  return engine;
}

// For nomad.inbox
// =

export async function summary() {
  await personas.ensureLoaded();
  if (!engine)
    return { vaultReady: false, personas: [], conversations: [], requests: [], blocked: [] };
  return engine.summary();
}

export const thread = (personaId, profileUrl) => need().thread(personaId, profileUrl);
export const lookup = (profileUrl) => need().lookup(profileUrl);
export const send = (o) => need().send(o);
export const accept = (personaId, profileUrl) => need().accept(personaId, profileUrl);
export const ignore = (personaId, profileUrl) => need().ignore(personaId, profileUrl);
export const block = (personaId, profileUrl) => need().block(personaId, profileUrl);
export const unblock = (personaId, profileUrl) => need().unblock(personaId, profileUrl);
export const markRead = (personaId, profileUrl) => need().markRead(personaId, profileUrl);
export const retry = (personaId, profileUrl, id) => need().retry(personaId, profileUrl, id);
export const deleteConversation = (personaId, profileUrl) =>
  need().deleteConversation(personaId, profileUrl);
export const setMode = (personaId, mode) => need().setMode(personaId, mode);
export const rotate = (personaId) => need().rotate(personaId);
export const linkFor = (personaId) => need().linkFor(personaId);

// The Persona a new Conversation started from a tab comes from (§7.2): the Space's, then the default.
export function personaForSpace(spaceId) {
  return personas.personaForSpaceId(spaceId)?.id || null;
}

// Invite links (ADR-0040, bg/hyper/invites.js): sign with a Persona's `sign` key, and read the
// `sign` key a Profile Drive publishes.
export const signInvite = (personaId, bytes) => need().signInvite(personaId, bytes);
export const publishedSign = (profileUrl) => need().publishedSign(profileUrl);
