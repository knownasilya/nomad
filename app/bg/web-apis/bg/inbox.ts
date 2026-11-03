// nomad.inbox (internal, nomad:// pages only): nomad://messages, My Library → Personas and
// site-info's Message button. The rules are shared/inbox.mjs; the work is bg/hyper/inbox.js
// (ADR-0036).

import { EventEmitter } from 'events';
import * as inbox from '../../hyper/inbox';
import * as filesystem from '../../filesystem/index';
import * as tabManager from '../../ui/tabs/manager';
import * as settingsDb from '../../dbs/settings';
import { findWebContentsParentWindow } from '../../lib/electron';
import { parseMessageLink } from '../../../../shared/inbox.mjs';

function spaceIdOf(ctx) {
  let id = ctx?.sender ? filesystem.getSpaceIdForWebContents(ctx.sender.id) : null;
  if (!id && ctx?.sender) {
    const win = findWebContentsParentWindow(ctx.sender);
    if (win) id = tabManager.getWindowActiveSpaceId(win);
  }
  return Number(id) || 1;
}

const str = (v) => String(v || '');

export default {
  async summary() {
    return inbox.summary();
  },

  async thread(personaId, profileUrl) {
    return inbox.thread(str(personaId), str(profileUrl));
  },

  async lookup(profileUrl) {
    return inbox.lookup(str(profileUrl));
  },

  async parseLink(link) {
    return parseMessageLink(str(link));
  },

  async send(o: any = {}) {
    const parsed = o?.link ? parseMessageLink(str(o.link)) : null;
    return inbox.send({
      personaId: str(o.personaId),
      to: str(o.to || parsed?.profileUrl),
      text: str(o.text),
      inReplyTo: o.inReplyTo ? str(o.inReplyTo) : undefined,
      replyTo: parsed?.replyTo || null,
    });
  },

  async accept(personaId, profileUrl) {
    await inbox.accept(str(personaId), str(profileUrl));
  },

  async ignore(personaId, profileUrl) {
    await inbox.ignore(str(personaId), str(profileUrl));
  },

  async block(personaId, profileUrl) {
    await inbox.block(str(personaId), str(profileUrl));
  },

  async unblock(personaId, profileUrl) {
    await inbox.unblock(str(personaId), str(profileUrl));
  },

  async markRead(personaId, profileUrl) {
    await inbox.markRead(str(personaId), str(profileUrl));
  },

  async retry(personaId, profileUrl, id) {
    await inbox.retry(str(personaId), str(profileUrl), id ? str(id) : null);
  },

  async deleteConversation(personaId, profileUrl) {
    await inbox.deleteConversation(str(personaId), str(profileUrl));
  },

  async setMode(personaId, mode) {
    await inbox.setMode(str(personaId), str(mode));
  },

  async rotate(personaId) {
    await inbox.rotate(str(personaId));
  },

  async messageLink(personaId) {
    return inbox.linkFor(str(personaId));
  },

  async tabPersona() {
    return inbox.personaForSpace(spaceIdOf(this));
  },

  async getNotify() {
    return !!Number(await settingsDb.get('inbox_notify'));
  },

  async setNotify(on) {
    await settingsDb.set('inbox_notify', on ? 1 : 0);
  },

  watch() {
    const emitter: any = new EventEmitter();
    const changed = () => emitter.emit('changed', {});
    inbox.events.on('changed', changed);
    emitter.close = () => inbox.events.removeListener('changed', changed);
    return emitter;
  },
};
