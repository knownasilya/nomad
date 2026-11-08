// nomad.personas (internal, nomad:// pages only): My Library → Personas and site-info's Session
// section. The records and rules are in bg/ui/personas.js and shared/personas.mjs (ADR-0031).

import { EventEmitter } from 'events';
import * as personas from '../../ui/personas';
import * as vouches from '../../ui/vouches';
import * as I from '../../../../shared/inbox.mjs';
import * as filesystem from '../../filesystem/index';
import * as tabManager from '../../ui/tabs/manager';
import { findWebContentsParentWindow } from '../../lib/electron';

// The caller's local Space id: its tab's Space, or the Space its window shows (site-info is a
// shell menu, so it names the window's Space).
function spaceIdOf(ctx) {
  let id = ctx?.sender ? filesystem.getSpaceIdForWebContents(ctx.sender.id) : null;
  if (!id && ctx?.sender) {
    const win = findWebContentsParentWindow(ctx.sender);
    if (win) id = tabManager.getWindowActiveSpaceId(win);
  }
  return Number(id) || 1;
}

export default {
  async list() {
    await personas.ensureLoaded();
    return { ...personas.state(), currentSpaceId: spaceIdOf(this) };
  },

  async create(fields: any = {}) {
    return personas.create(fields || {});
  },

  async update(id, fields: any = {}) {
    return personas.update(String(id), fields || {});
  },

  async remove(id) {
    await personas.remove(String(id));
  },

  async setDefault(id) {
    await personas.setDefault(id ? String(id) : null);
  },

  async setSpacePersona(spaceId, id) {
    await personas.setSpacePersona(Number(spaceId), id ? String(id) : null);
  },

  async listSessions() {
    return personas.listSessions();
  },

  async endSession(path) {
    await personas.endSession(String(path));
  },

  async getSiteSession(url) {
    return personas.siteSession(String(url || ''), spaceIdOf(this));
  },

  async endSiteSession(url) {
    await personas.endSessionFor(String(url || ''), spaceIdOf(this));
  },

  // Vouches (ADR-0045)
  // =

  async listVouches() {
    return vouches.summary();
  },

  // `to` is a Profile Drive, or the guest's message link (its address lets the Vouch reach them).
  async previewVouch({ personaId, to, link }: any = {}) {
    const parsed = link || /^nomad:/.test(String(to || '')) ? I.parseMessageLink(String(link || to)) : null;
    return vouches.preview({
      personaId: personaId ? String(personaId) : null,
      to: parsed?.profileUrl || String(to || ''),
      replyTo: parsed?.replyTo || null,
    });
  },

  async giveVouch({ personaId, to, note, link }: any = {}) {
    const parsed = link || /^nomad:/.test(String(to || '')) ? I.parseMessageLink(String(link || to)) : null;
    return vouches.give({
      personaId: String(personaId || ''),
      to: parsed?.profileUrl || String(to || ''),
      note: note == null ? undefined : String(note),
      replyTo: parsed?.replyTo || null,
    });
  },

  async renewVouch(personaId, id) {
    return vouches.renew(String(personaId), String(id));
  },

  async withdrawVouch(personaId, id) {
    await vouches.withdraw(String(personaId), String(id));
  },

  async forgetVouch(personaId, id) {
    await vouches.forgetGiven(String(personaId), String(id));
  },

  async acceptVouch(personaId, id) {
    await vouches.accept(String(personaId), String(id));
  },

  async declineVouch(personaId, id) {
    await vouches.decline(String(personaId), String(id));
  },

  async setVouchShown(personaId, id, shown) {
    await vouches.setShown(String(personaId), String(id), String(shown));
  },

  async profileVouches(url) {
    return vouches.profileVouches(String(url || ''));
  },

  async tabPersona() {
    return personas.personaForSpaceId(spaceIdOf(this))?.id || null;
  },

  watch() {
    const emitter: any = new EventEmitter();
    const changed = () => emitter.emit('changed', {});
    personas.events.on('changed', changed);
    vouches.events.on('changed', changed);
    emitter.close = () => {
      personas.events.removeListener('changed', changed);
      vouches.events.removeListener('changed', changed);
    };
    return emitter;
  },
};
