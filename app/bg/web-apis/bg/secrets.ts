//
// Internal web API: nomad.secrets — My Library → Secrets (ADR-0033). Available only to nomad://
// pages, and its writes only to nomad://library. A value goes in through save() and never comes back
// out: the AI's httpRequest (ai.ts) is the only reader.

import { EventEmitter } from 'events';
import * as secretStore from '../../ai/secret-store';
import * as jobs from '../../ai/jobs';

function assertLibrary(ctx) {
  const url = ctx?.sender?.getURL?.() || '';
  if (!/^nomad:\/\/library\//.test(url)) throw new Error('Only My Library can change secrets');
}

export default {
  async getStatus() {
    return secretStore.encryptionStatus();
  },

  async list() {
    return {
      secrets: await secretStore.list(),
      jobs: jobs.list().map((j) => ({ id: j.id, title: j.title })),
    };
  },

  async save(fields) {
    assertLibrary(this);
    const f = fields || {};
    return secretStore.save({
      name: f.name,
      create: !!f.create,
      ...(f.note !== undefined ? { note: f.note } : {}),
      ...(f.hosts !== undefined ? { hosts: f.hosts } : {}),
      ...(f.inject !== undefined ? { inject: f.inject } : {}),
      ...(f.chat !== undefined ? { chat: f.chat } : {}),
      ...(typeof f.value === 'string' ? { value: f.value } : {}),
    });
  },

  async remove(name) {
    assertLibrary(this);
    await secretStore.remove(String(name || ''));
  },

  async setJobGrant(name, jobId, allowed) {
    assertLibrary(this);
    if (!jobs.get(jobId)) throw new Error('No Job with that id');
    await secretStore.setJobGrant(String(name || ''), jobId, !!allowed);
  },

  watch() {
    const emitter: any = new EventEmitter();
    const changed = () => emitter.emit('changed', {});
    secretStore.events.on('changed', changed);
    jobs.events.on('changed', changed);
    emitter.close = () => {
      secretStore.events.removeListener('changed', changed);
      jobs.events.removeListener('changed', changed);
    };
    return emitter;
  },
};
