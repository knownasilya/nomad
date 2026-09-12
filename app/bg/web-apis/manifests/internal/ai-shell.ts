// The shell-chrome AI sidebar's RPC surface (app/fg/shell-window/ai-sidebar.js). Internal-only —
// unlike manifests/external/ai.ts (window.nomad.ai, callable from any page), this is reachable only
// from the trusted nomad://shell-window renderer itself. See bg/ai-shell.ts for the implementation.
export default {
  chat: 'readable',
  listModels: 'promise',
  modelInfo: 'promise',
  listTools: 'promise',
  getActiveDriveInfo: 'promise',
  notifyAgentWroteFile: 'promise',
  listSessions: 'promise',
  loadSession: 'promise',
  newSession: 'promise',
  saveSession: 'promise',
  deleteSession: 'promise',
  getLastSessionId: 'promise',
  getSitePrefs: 'promise',
  saveSitePrefs: 'promise',
};
