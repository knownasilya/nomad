// Internal web API: nomad.aiSites — the AI page's Sites (nomad://ai/sites, ADR-0037 amendment): the
// sites the user let their AI send to for 3 months from the `aiSendData` prompt. Available only to
// nomad:// pages (internalOnly in web-apis/bg.ts), and its changes only to nomad://ai, so no other
// page can allow a site for the user. There is no add: a grant starts only at the prompt.

import { EventEmitter } from 'events';
import * as sendGrants from '../../ai/send-grants';
import { SEND_GRANT_DAYS } from '../../ai/egress.mjs';

function assertAiPage(ctx) {
  const url = ctx?.sender?.getURL?.() || '';
  if (!/^nomad:\/\/ai\//.test(url)) throw new Error('Only the AI page can change these sites');
}

async function existing(host) {
  const h = String(host || '');
  const found = (await sendGrants.list()).find((g) => g.host === h);
  if (!found) throw new Error(`${h || 'That site'} isn't allowed now`);
  return found;
}

export default {
  async list() {
    return { grants: await sendGrants.list(), days: SEND_GRANT_DAYS };
  },

  // Only a site the user allowed can be extended, so this never adds one.
  async extend(host) {
    assertAiPage(this);
    const found = await existing(host);
    return sendGrants.grant(found.host);
  },

  async remove(host) {
    assertAiPage(this);
    await sendGrants.remove(String(host || ''));
  },

  watch() {
    const emitter: any = new EventEmitter();
    const changed = () => emitter.emit('changed', {});
    sendGrants.events.on('changed', changed);
    emitter.close = () => sendGrants.events.removeListener('changed', changed);
    return emitter;
  },
};
