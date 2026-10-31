// The AI page's chat search (nomad://ai/chats): a session's preview line, and whether it matches a
// search and where. Pure, for chat-store.js and the tests.

const textOf = (m) => (m && typeof m.content === 'string' ? m.content : '');

export function searchWords(query) {
  return String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

// The start of the last thing said, on one line.
export function previewOf(messages) {
  for (let i = (messages || []).length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user' && m?.role !== 'assistant') continue;
    const text = textOf(m).replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 160);
  }
  return '';
}

// null when the session doesn't have every word (in its title or its messages, together); else a
// bit of the first message with one of the words, or '' when only the title has them.
export function matchSession(title, messages, words) {
  const texts = (messages || [])
    .filter((m) => m?.role === 'user' || m?.role === 'assistant')
    .map((m) => textOf(m).replace(/\s+/g, ' ').trim());
  const all = [String(title || ''), ...texts].join('\n').toLowerCase();
  if (!words.every((w) => all.includes(w))) return null;
  for (const text of texts) {
    const lower = text.toLowerCase();
    let at = -1;
    let len = 0;
    for (const w of words) {
      const i = lower.indexOf(w);
      if (i !== -1 && (at === -1 || i < at)) {
        at = i;
        len = w.length;
      }
    }
    if (at === -1) continue;
    const start = Math.max(0, at - 50);
    const end = Math.min(text.length, at + len + 90);
    return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  }
  return '';
}
