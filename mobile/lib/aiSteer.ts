// Steering the phone's AI while it works, like the desktop sidebar (app/bg/ai/steering.mjs). A
// message sent mid-turn waits in the panel as "queued" until the Provider's loop reads it at its
// next step; the 'steer' event then puts it in the transcript where the model read it. One the
// Provider never read is sent as the next turn when this one ends.

export interface SteerMsg { role: 'user' | 'assistant'; content: string; images?: string[]; reasoning?: string }
export interface Queued { id: string; text: string }

export function newSteerId (): string {
  return `s_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`
}

// The Provider read `texts`: the answer so far stays as it is (or goes, when nothing came of it
// yet), the messages follow it, and a new answer starts after them.
export function applySteer<M extends SteerMsg> (messages: M[], texts: string[], settle: (text: string) => string = (x) => x): M[] {
  if (!texts.length) return messages
  let base = messages
  const last = messages[messages.length - 1]
  if (last && last.role === 'assistant') {
    const content = settle(last.content)
    const empty = !content.trim() && !(last.reasoning || '').trim()
    base = empty ? messages.slice(0, -1) : [...messages.slice(0, -1), { ...last, content }]
  }
  const sent = texts.map((content) => ({ role: 'user', content }) as M)
  return [...base, ...sent, { role: 'assistant', content: '' } as M]
}

// Two user messages in a row (a message steered in before the AI said anything) go to the
// Provider as one, so roles still alternate for chat templates that insist on that.
export function mergeUserTurns<M extends SteerMsg> (history: M[]): M[] {
  const out: M[] = []
  for (const m of history) {
    const prev = out[out.length - 1]
    if (prev && prev.role === 'user' && m.role === 'user') {
      const images = [...(prev.images || []), ...(m.images || [])]
      const content = [prev.content, m.content].filter(Boolean).join('\n\n')
      out[out.length - 1] = (images.length ? { ...prev, content, images } : { ...prev, content }) as M
    } else {
      out.push(m)
    }
  }
  return out
}
