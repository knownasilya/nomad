import type { IconName } from '../components/Icon'
import type { AiPromptRequest } from './useBackend'

// What the phone's prompt for a relayed AI permission says (ADR-0013 §6): the agentic turn runs on
// the desktop Provider, but the human is here on the phone. A modifyDrive prompt names the target
// drive (title + URL) so the user knows exactly what's being edited; the caller resolves that from
// the `modifyDrive:<hexDriveKey>` permission. The Notes and Reader permissions (ADR-0019) each say
// what the AI wants; the Provider asks each once per turn. The icons are desktop's (PERM_ICONS in
// app/lib/permissions.ts).

export interface AiPromptText {
  icon: IconName
  title: string
  message: string
  // The request an aiSendData or aiSecretUse prompt is for, one line each; `warn` marks the lines
  // about the user's secrets.
  request: { text: string; warn?: boolean }[]
}

const VAULT_PROMPTS: Record<string, { icon: IconName; title: string; message: string }> = {
  notesRead: { icon: 'sticky-note', title: 'Allow AI to read your Notes?', message: 'The AI running on your other device wants to read your Notes.' },
  notesWrite: { icon: 'sticky-note', title: 'Allow AI to edit your Notes?', message: 'The AI running on your other device wants to create or change your Notes.' },
  readerRead: { icon: 'rss', title: 'Allow AI to read your Reader?', message: 'The AI running on your other device wants to read the feeds you follow and their posts.' },
  readerWrite: { icon: 'rss', title: 'Allow AI to change your Reader?', message: 'The AI running on your other device wants to follow or unfollow feeds, or mark posts read.' },
  modsRead: { icon: 'magic', title: 'Allow AI to read your Mods?', message: 'The AI running on your other device wants to read your Mods: your own styles and scripts for sites.' },
  modsWrite: { icon: 'magic', title: 'Allow AI to change your Mods?', message: 'The AI running on your other device wants to create or change your Mods. A Mod can run a script on every page of its site.' },
  assetsWrite: { icon: 'folder-open', title: 'Allow AI to save to Assets?', message: 'The AI running on your other device wants to save a file to your Assets. In a shared Space, everyone in it sees the file.' },
  calendarRead: { icon: 'calendar-alt', title: 'Allow AI to read your calendar?', message: 'The AI running on your other device wants to read your calendar, your household’s, and the calendars you follow.' },
  contactsRead: { icon: 'address-book', title: 'Allow AI to read your contacts?', message: 'The AI running on your other device wants to read this Space’s contacts: names, phone numbers, emails and addresses.' },
  jobsRead: { icon: 'clock', title: 'Allow AI to see your Jobs?', message: 'The AI running on your other device wants to see your AI Jobs and their results.' },
  jobsWrite: { icon: 'clock', title: 'Allow AI to change your Jobs?', message: 'The AI running on your other device wants to create, change or run your AI Jobs. A Job runs a prompt by itself, reads your Notes and Reader, and notifies this phone.' },
  aiCreateDrive: { icon: 'hdd', title: 'Allow AI to make a drive?', message: 'The AI running on your other device wants to make a new drive in your library on that computer.' },
  memoryWrite: { icon: 'brain', title: 'Allow AI to remember things?', message: 'The AI running on your other device wants to remember something about you for later chats, or forget something. You can see and change what it remembers on the AI page on your computer.' }
}

export function aiPromptText (permission: string, drive?: { name: string; url: string } | null, request?: AiPromptRequest | null): AiPromptText {
  const vault = VAULT_PROMPTS[permission]
  if (vault) return { ...vault, request: [] }

  // The AI using one of the user's secrets (ADR-0033): `aiSecretUse:<NAME>`. The secret stays on
  // the computer; the phone only says yes or no.
  const secret = /^aiSecretUse:([A-Z][A-Z0-9_]{1,63})$/.exec(permission)
  if (secret) {
    return {
      icon: 'key',
      title: `Allow AI to use ${secret[1]}?`,
      message: `The AI running on your other device wants to send requests with your secret ${secret[1]}, to the sites you allowed for it. It never sees the secret itself.`,
      request: requestLines(request)
    }
  }

  // The AI sending a request to a site after it read the user's private data in this chat
  // (ADR-0037): `aiSendData:<host>`. The request could carry that data there. A newer Provider also
  // sends the request that asks (`request`), so the prompt names its URL and what it sends.
  const send = /^aiSendData:([^\s]{1,300})$/.exec(permission)
  if (send) {
    return {
      icon: 'paper-plane',
      title: `Allow AI to contact ${send[1]}?`,
      message: `The AI running on your other device wants to send a request to ${send[1]}. It has read your private data in this chat (your Notes, Reader, files or a page), and the request could carry some of it there. Allow only if you asked it to use this site.`,
      request: requestLines(request)
    }
  }

  const name = drive?.name || 'this drive'
  const url = drive?.url || ''
  return {
    icon: 'folder-open',
    title: 'Allow AI to edit?',
    message: `The AI running on your other device wants to make changes to this drive:\n\n${name}${url ? `\n${url}` : ''}`,
    request: []
  }
}

// The request in a phone prompt: method and URL, then what else it sends, in a few lines.
export function requestLines (r?: AiPromptRequest | null): { text: string; warn?: boolean }[] {
  if (!r || typeof r.url !== 'string' || (!r.url && !r.secrets?.length)) return []
  const url = !r.url ? '(the URL is your secret)' : r.url.length > 300 ? r.url.slice(0, 300) + '…' : r.url
  const lines: { text: string; warn?: boolean }[] = [{ text: r.kind === 'tab' ? `Open ${url}` : `${r.method || 'GET'} ${url}` }]
  const bodyLength = r.bodyLength || (r.body ? r.body.length : 0)
  if (bodyLength) lines.push({ text: `With a body of ${bodyLength.toLocaleString()} characters` })
  if (Array.isArray(r.headers) && r.headers.length) lines.push({ text: `Headers: ${r.headers.map((h) => h.name).join(', ')}` })
  if (Array.isArray(r.secrets) && r.secrets.length) {
    lines.push({ text: `Sends your ${r.secrets.length > 1 ? 'secrets' : 'secret'} ${r.secrets.join(', ')}`, warn: true })
    for (const d of r.secretDetails || []) {
      if (d.sentAs) lines.push({ text: `${d.name} goes in ${d.sentAs}${d.hosts?.length ? `, only to ${d.hosts.join(', ')}` : ''}`, warn: true })
    }
  }
  return lines
}
