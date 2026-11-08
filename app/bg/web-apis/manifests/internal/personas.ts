// nomad.personas: the user's Personas and the Sessions sites hold (ADR-0031). nomad:// pages only
// (internalOnly): a page that could list Personas would learn every identity the user has.
export default {
  list: 'promise', // -> { hasVault, vaultReady, defaultId, personas: [...], spaces: [...] }
  create: 'promise', // ({ label, title?, description?, thumb? (data: URL), profileUrl? }) -> persona
  update: 'promise', // (id, { label?, title?, description?, thumb? })
  remove: 'promise', // (id) — its Sessions go too; the Profile Drive stays
  setDefault: 'promise', // (id | null)
  setSpacePersona: 'promise', // (spaceId, id | null) — null: the Space uses the default
  listSessions: 'promise', // -> [{ path, origin, site, personaLabel, spaceName, perms, createdAt, expiresAt }]
  endSession: 'promise', // (path)
  getSiteSession: 'promise', // (url) -> the caller's Space's Session on that site, or null
  endSiteSession: 'promise', // (url)
  // Vouches (ADR-0045): My Library → Personas → Vouches, and site-info on a Profile Drive.
  listVouches: 'promise', // -> { personas, held: [...], given: [...], foreign: [...] }
  previewVouch: 'promise', // ({ personaId, to, link? }) -> { profileUrl, ok, reason, title, thumb }
  giveVouch: 'promise', // ({ personaId, to, note?, link? }) — `link`: the guest's message link
  renewVouch: 'promise', // (personaId, id)
  withdrawVouch: 'promise', // (personaId, id) — quiet: nothing is sent
  forgetVouch: 'promise', // (personaId, id) — a withdrawn or expired one the host gave
  acceptVouch: 'promise', // (personaId, id)
  declineVouch: 'promise', // (personaId, id) — also removes an accepted one; never sent to the host
  setVouchShown: 'promise', // (personaId, id, 'me' | 'sites' | 'profile')
  profileVouches: 'promise', // (url) -> { readable, known: [...], others: [...] }, each checked
  tabPersona: 'promise', // -> the id of the Persona the caller's Space uses, or null
  watch: 'readable', // 'changed'
};
