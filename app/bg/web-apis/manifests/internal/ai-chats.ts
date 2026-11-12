// The AI page's chats (nomad://ai/chats): the AI Sidebar's saved sessions, to list, search, rename,
// delete and reopen. Internal-only, for nomad:// pages. See bg/ai-chats.ts.
export default {
  list: 'promise', // ({ query? }) -> { chats: [{ id, title, named, updatedAt, messageCount, preview, snippet? }], lastId }
  load: 'promise', // (id) -> { id, title, messages, updatedAt } | null
  rename: 'promise', // (id, name) -> the title shown; '' goes back to the first message
  remove: 'promise', // (id)
  open: 'promise', // (id, { space? }) opens it in the AI Sidebar of the caller's window, in that Space
  origins: 'promise', // (ai list of a Note or Asset) -> what it shows for the chats that made it (ADR-0047)
  driveOrigins: 'promise', // (driveUrl, path?) -> the same for a drive
  openNew: 'promise', // ({ draft? }) opens the AI Sidebar on a new chat; `draft` is put in its input, not sent
};
