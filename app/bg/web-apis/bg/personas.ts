// nomad.personas (internal, nomad:// pages only): My Library → Personas and site-info's Session
// section. The records and rules are in bg/ui/personas.js and shared/personas.mjs (ADR-0031).

import { EventEmitter } from 'events';
import * as personas from '../../ui/personas';
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

  watch() {
    const emitter: any = new EventEmitter();
    const changed = () => emitter.emit('changed', {});
    personas.events.on('changed', changed);
    emitter.close = () => personas.events.removeListener('changed', changed);
    return emitter;
  },
};
