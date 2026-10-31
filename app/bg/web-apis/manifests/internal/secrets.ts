// The user's secrets (bg/ai/secret-store.js, ADR-0032), for My Library → Secrets. Values go in and
// never come out: every method returns records with `hasValue`, never a value.
export default {
  getStatus: 'promise', // -> { ok, reason }: whether this computer can keep secrets encrypted
  list: 'promise', // -> { secrets: [{ name, note, hosts, inject, chat, jobs, hasValue, … }], jobs: [{ id, title }] }
  save: 'promise', // ({ name, create?, note?, hosts?, inject?, chat?, value? }) -> record; value '' keeps the old one
  remove: 'promise', // (name)
  setJobGrant: 'promise', // (name, jobId, allowed): let a Job use it on this computer, or stop it
  watch: 'readable', // 'changed' when a secret changes or is used
};
