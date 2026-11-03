// nomad.inbox: the Persona Inbox, direct messages to the user's Personas (ADR-0036). nomad:// pages
// only (internalOnly): no page API reads or sends messages (§7.1).
export default {
  summary: 'promise', // -> { vaultReady, personas: [...], conversations: [...], requests: [...], blocked: [...] }
  thread: 'promise', // (personaId, profileUrl) -> { other, title, thumb, contact, reachable, records }
  lookup: 'promise', // (profileUrl) -> { profileUrl, title, thumb, isPerson, published }
  parseLink: 'promise', // (messageLink) -> { profileUrl, replyTo } | null
  send: 'promise', // ({ personaId, to, text, inReplyTo?, link? })
  accept: 'promise', // (personaId, profileUrl)
  ignore: 'promise', // (personaId, profileUrl)
  block: 'promise', // (personaId, profileUrl)
  unblock: 'promise', // (personaId, profileUrl)
  markRead: 'promise', // (personaId, profileUrl)
  retry: 'promise', // (personaId, profileUrl, id?)
  deleteConversation: 'promise', // (personaId, profileUrl)
  setMode: 'promise', // (personaId, 'off' | 'link' | 'anyone')
  rotate: 'promise', // (personaId) — Change inbox address
  messageLink: 'promise', // (personaId) -> nomad://messages/new?… | null
  tabPersona: 'promise', // () -> the Persona a Conversation started from the caller's Space uses
  getNotify: 'promise', // -> bool
  setNotify: 'promise', // (bool)
  watch: 'readable', // 'changed'
};
