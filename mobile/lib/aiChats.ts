// The phone AI panel's past chats: the rows the backend lists (mobile/backend/lib/ai-chats.mjs, on
// the rules in shared/ai-chats.mjs), grouped by day like desktop's nomad://ai/chats.

export interface AiChatRow {
  id: string
  title: string
  named: boolean
  updatedAt: number
  messageCount: number
  preview: string
  job: { id: string; title: string } | null
  snippet?: string // with a search: the words in context
}

export interface AiChatList { chats: AiChatRow[]; lastId: string | null }

export interface AiChatData {
  id: string
  title: string
  named: boolean
  messages: Array<{ role: 'user' | 'assistant' | 'error'; content: string; images?: string[]; reasoning?: string; privateData?: boolean; files?: unknown[] }>
  updatedAt: number
  job: { id: string; title: string } | null
}

// The same shape desktop's chat-store makes, so either side can name a new chat.
export function newChatId (now = Date.now()): string {
  return now.toString(36) + Math.random().toString(36).slice(2, 7)
}

const DAY = 24 * 60 * 60 * 1000
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// "Today", "Yesterday", "Previous 7 days", "Previous 30 days", then the month.
export function chatGroupOf (ts: number, now: Date = new Date()): string {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= start) return 'Today'
  if (ts >= start - DAY) return 'Yesterday'
  if (ts >= start - 7 * DAY) return 'Previous 7 days'
  if (ts >= start - 30 * DAY) return 'Previous 30 days'
  const d = new Date(ts)
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

// Rows (newest first) in their groups, in order.
export function groupChats<R extends { updatedAt: number }> (rows: R[], now: Date = new Date()): Array<{ title: string; rows: R[] }> {
  const out: Array<{ title: string; rows: R[] }> = []
  for (const row of rows) {
    const title = chatGroupOf(row.updatedAt || 0, now)
    const last = out[out.length - 1]
    if (last && last.title === title) last.rows.push(row)
    else out.push({ title, rows: [row] })
  }
  return out
}

// "just now", "25 min ago", "3 h ago", "Yesterday", "Mon", "Oct 4".
export function chatAgo (ts: number, now: Date = new Date()): string {
  if (!ts) return ''
  const s = Math.max(0, (now.getTime() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  const group = chatGroupOf(ts, now)
  if (group === 'Today') return `${Math.floor(s / 3600)} h ago`
  if (group === 'Yesterday') return 'Yesterday'
  const d = new Date(ts)
  return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}${d.getFullYear() === now.getFullYear() ? '' : `, ${d.getFullYear()}`}`
}

// "8 messages · 25 min ago"
export function chatMeta (row: Pick<AiChatRow, 'messageCount' | 'updatedAt'>, now: Date = new Date()): string {
  const count = `${row.messageCount} ${row.messageCount === 1 ? 'message' : 'messages'}`
  const when = chatAgo(row.updatedAt, now)
  return when ? `${count} · ${when}` : count
}

// The empty panel's ideas, like the desktop sidebar's: what makes sense for the tab that is open.
export interface Suggestion { icon: 'align-left' | 'question' | 'pen' ; label: string; prompt: string }
export function chatSuggestions (url: string): Suggestion[] {
  const out: Suggestion[] = []
  if (url) out.push({ icon: 'align-left', label: 'Summarize this page', prompt: 'Summarize this page in a few bullets.' })
  out.push({ icon: 'question', label: 'What can you do?', prompt: 'What can you do for me here?' })
  if (url.startsWith('hyper://')) out.push({ icon: 'pen', label: 'Help me edit this drive', prompt: 'Help me edit this drive.' })
  return out
}

// After a failed turn: the history to send again (up to and with the last thing the person said),
// or null when there is nothing to retry.
export function retryHistory<M extends { role: string; content: string; images?: string[] }> (messages: M[]): M[] | null {
  let i = messages.length - 1
  while (i >= 0 && messages[i].role !== 'user') i--
  if (i < 0) return null
  const m = messages[i]
  if (!m.content.trim() && !m.images?.length) return null
  return messages.slice(0, i + 1)
}
