// The sites the user let their AI send to for 3 months (bg/ai/send-grants.js, ADR-0037 amendment),
// for nomad://ai/sites. Internal-only; changes only from nomad://ai. See bg/ai-sites.ts.
export default {
  list: 'promise', // -> { grants: [{ host, grantedAt, until }], days } soonest to end first
  extend: 'promise', // (host) -> { host, grantedAt, until }: another 3 months from now
  remove: 'promise', // (host): the next request there asks again
  watch: 'readable', // 'changed' when a site is added, extended or removed
};
