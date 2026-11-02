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
  watch: 'readable', // 'changed'
};
