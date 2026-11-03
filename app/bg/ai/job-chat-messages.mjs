// A Job run the user watches (Run with me, ADR-0038) is also a chat in their AI Sidebar. These are
// the pure rules for that chat: the session it starts as, how each event of the run's turn adds to
// its messages, and how it ends. app/bg/ai/job-chat.js keeps the live runs and saves them.
//
// A Job's chat is an ordinary sidebar session (chat-store.js) with a `job` field, { id, title }, so
// the sidebar's history and the AI page's chat list mark it as automated. Its first message is the
// prompt the Job sent, marked `fromJob`, since the user didn't type it. The answer has no `files`:
// the run records what it changed itself, and a Job's writes can be staged in a Draft, which the
// sidebar's Revert doesn't know about.

const MAX_TITLE = 80;

// { id, title } for a session's `job`, or null when it isn't one.
export function jobOf(data) {
  const job = data?.job;
  if (!job || typeof job !== 'object' || typeof job.id !== 'string' || !job.id) return null;
  return { id: job.id, title: typeof job.title === 'string' ? job.title.slice(0, MAX_TITLE) : '' };
}

// The session a watched run starts as: the Job's prompt as the first message.
export function jobChatStart(job, prompt) {
  const title =
    String(job?.title || '')
      .trim()
      .slice(0, MAX_TITLE) || 'Job';
  const text = String(prompt || '').trim() || `Run the Job “${title}”`;
  return {
    title,
    job: { id: String(job?.id || ''), title },
    messages: [{ role: 'user', content: text, fromJob: true }],
  };
}

// The answer the run is writing: the last message when it's an assistant's, else a new one.
function withAnswer(messages) {
  const last = messages[messages.length - 1];
  if (last && last.role === 'assistant') return [messages.slice(0, -1), last];
  return [messages, { role: 'assistant', content: '', reasoning: '' }];
}

// One event of the run's turn ('chunk', 'reasoning' or 'tool', as the chat stream sends them) on
// the session's messages. Returns new messages, or the same array when the event adds nothing.
export function applyJobEvent(messages, type, e) {
  if (type === 'chunk' || type === 'reasoning') {
    const text = typeof e?.text === 'string' ? e.text : '';
    if (!text) return messages;
    const [rest, answer] = withAnswer(messages);
    const key = type === 'chunk' ? 'content' : 'reasoning';
    return [...rest, { ...answer, [key]: (answer[key] || '') + text }];
  }
  if (type === 'tool' && e?.phase === 'private') {
    const [rest, answer] = withAnswer(messages);
    return answer.privateData ? messages : [...rest, { ...answer, privateData: true }];
  }
  if (type === 'tool' && e?.phase === 'screenshot' && typeof e.imageDataUrl === 'string') {
    const [rest, answer] = withAnswer(messages);
    return [...rest, { ...answer, images: [...(answer.images || []), e.imageDataUrl] }];
  }
  return messages;
}

// The session's messages once the run ended: an error takes the answer's place, a stopped run with
// no answer says so, and a Job with no prompt (only job.js) answers with its module's result.
export function jobChatEnd(messages, { error = null, stopped = false, output = '' } = {}) {
  const [rest, answer] = withAnswer(messages);
  const content = (answer.content || '').trim();
  if (error && !stopped) {
    return [...rest, { role: 'error', content: `Error: ${error}` }];
  }
  if (!content) {
    const text = stopped ? '_Stopped._' : String(output || '').trim();
    if (!text && !answer.reasoning && !answer.images?.length) return rest;
    return [...rest, { ...answer, content: text }];
  }
  return [...rest, answer];
}
