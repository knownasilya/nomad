// Internal web API: nomad.passkeys — My Library → Passkeys (ADR-0049). Available only to nomad://
// pages, and its one write (remove) only to nomad://library. Websites make and use passkeys through
// navigator.credentials (bg/ui/passkeys.js), never through this.

import { EventEmitter } from 'events';
import * as store from '../../passkeys/store';

function assertLibrary(ctx) {
  const url = ctx?.sender?.getURL?.() || '';
  if (!/^nomad:\/\/library\//.test(url)) throw new Error('Only My Library can remove passkeys');
}

const view = (p) => ({
  id: p.id,
  rpId: p.rpId,
  rpName: p.rpName,
  userName: p.userName,
  displayName: p.displayName,
  origin: p.origin,
  createdAt: p.createdAt,
  lastUsedAt: p.lastUsedAt,
});

export default {
  async getStatus() {
    return store.encryptionStatus();
  },

  async list() {
    return (await store.list()).map(view);
  },

  async remove(id) {
    assertLibrary(this);
    await store.remove(String(id || ''));
  },

  watch() {
    const emitter: any = new EventEmitter();
    const changed = () => emitter.emit('changed', {});
    store.events.on('changed', changed);
    emitter.close = () => store.events.removeListener('changed', changed);
    return emitter;
  },
};
