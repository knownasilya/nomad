// Websites' passkeys that Nomad keeps on this computer (bg/passkeys/store.js, ADR-0049), for
// My Library → Passkeys. Records only: no method returns a key.
export default {
  getStatus: 'promise', // -> { ok, reason }: whether this computer can keep passkeys encrypted
  list: 'promise', // -> [{ id, rpId, rpName, userName, displayName, origin, createdAt, lastUsedAt }]
  remove: 'promise', // (id)
  watch: 'readable', // 'changed' when a passkey is made, used or removed
};
