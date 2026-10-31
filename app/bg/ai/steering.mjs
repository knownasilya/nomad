// Steering: messages the user sends while a chat turn is still running. The AI Sidebar keeps its
// input open during a turn; a message sent then waits here and goes into the agent loop at its
// next step, so the user can redirect the assistant without stopping it.
//
// - The local loop (runChat) adds the waiting messages as a user message before its next model
//   call: after a round of tool results, or when the model would otherwise end the turn.
// - A CLI runtime (Claude) runs its own loop. Its tool calls come back through the loopback MCP,
//   so the waiting messages ride on the next search/execute result instead (withSteer). Anything
//   still waiting when the CLI ends starts one more CLI call.
// - A turn sent to another Device over the AI Bridge forwards each message there (forward(), a
//   STEER frame), where that Device's own steering takes it. A message the other Device never
//   read (an older Provider drops STEER) is sent as the next turn when this one ends.
//
// Every delivery emits a `steer` event ({ ids, texts }) on the turn's emitter, so the sidebar can
// put the message in the transcript where the model read it.

export const MAX_STEER_CHARS = 20_000;
export const MAX_STEER_QUEUE = 20;

export function createSteering() {
  const queue = [];
  let closed = false;
  let forwarder = null;
  return {
    get closed() {
      return closed;
    },
    get size() {
      return queue.length;
    },
    // false when the turn can't take it any more (ended, aborted, remote) or the input is bad.
    push(id, text) {
      if (closed) return false;
      if (typeof id !== 'string' || !id || id.length > 100) return false;
      if (typeof text !== 'string' || !text.trim()) return false;
      if (queue.length >= MAX_STEER_QUEUE || queue.some((m) => m.id === id))
        return false;
      const item = { id, text: text.trim().slice(0, MAX_STEER_CHARS) };
      if (forwarder) forwarder({ type: 'steer', ...item });
      else queue.push(item);
      return true;
    },
    // Takes back a message the loop hasn't read yet. A forwarded one is asked back from the other
    // Device, which may already have read it; its STEERED then still names it.
    remove(id) {
      if (forwarder) {
        forwarder({ type: 'unsteer', id });
        return true;
      }
      const i = queue.findIndex((m) => m.id === id);
      if (i === -1) return false;
      queue.splice(i, 1);
      return true;
    },
    take() {
      return queue.splice(0, queue.length);
    },
    // The loop's last look before the turn ends: what's waiting, or, when nothing is, close so a
    // message sent from here on is refused (and the sidebar sends it as the next turn) instead of
    // being left unread.
    takeOrClose() {
      if (!queue.length) closed = true;
      return this.take();
    },
    close() {
      closed = true;
      forwarder = null;
      return queue.splice(0, queue.length);
    },
    // The turn runs elsewhere: send what's waiting, and each later message, through `fn`.
    forward(fn) {
      forwarder = fn;
      for (const item of queue.splice(0, queue.length))
        fn({ type: 'steer', ...item });
    },
  };
}

// Takes what's waiting and tells the UI it was delivered. [] when nothing was.
export function deliverSteer(steering, emitter, { final = false } = {}) {
  if (!steering) return [];
  const items = final ? steering.takeOrClose() : steering.take();
  if (items.length) {
    emitter?.emit('steer', {
      ids: items.map((m) => m.id),
      texts: items.map((m) => m.text),
    });
  }
  return items;
}

// Adds the user's messages to the loop's history as one user message. When the history already
// ends with a user message (the user steered before the first model call), the text joins it, so
// roles still alternate for chat templates that insist on that.
export function addSteerMessages(history, items) {
  if (!items.length) return history;
  const text = items.map((m) => m.text).join('\n\n');
  const last = history[history.length - 1];
  if (last && last.role === 'user' && typeof last.content === 'string') {
    history[history.length - 1] = {
      ...last,
      content: `${last.content}\n\n${text}`,
    };
  } else if (last && last.role === 'user' && Array.isArray(last.content)) {
    history[history.length - 1] = {
      ...last,
      content: [...last.content, { type: 'text', text }],
    };
  } else {
    history.push({ role: 'user', content: text });
  }
  return history;
}

// The note a CLI model reads at the end of a tool result.
export function steerNote(items) {
  const body = items.map((m) => m.text).join('\n\n');
  return (
    '\n\n<user-message>\nThe user sent this while you were working. Take it into account from ' +
    `here on; it may change what they want.\n\n${body}\n</user-message>`
  );
}

// A search/execute result with the waiting messages added, for a CLI turn's loopback MCP call.
export function withSteer(result, steering, emitter) {
  const items = deliverSteer(steering, emitter);
  if (!items.length) return result;
  const note = steerNote(items);
  if (
    result &&
    typeof result === 'object' &&
    typeof result.imageDataUrl === 'string'
  ) {
    return { ...result, text: (result.text || 'Screenshot captured.') + note };
  }
  const text =
    typeof result === 'string' ? result : JSON.stringify(result ?? '');
  return text + note;
}

// Two user messages in a row (a message steered in before the assistant said anything) go to the
// runtime as one, so roles still alternate. For the AI Sidebar's transcript ({ role, content }).
export function mergeUserTurns(history) {
  const out = [];
  for (const m of history) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.role === 'user' &&
      m.role === 'user' &&
      typeof prev.content === 'string' &&
      typeof m.content === 'string'
    ) {
      out[out.length - 1] = {
        ...prev,
        content: [prev.content, m.content].filter(Boolean).join('\n\n'),
      };
    } else {
      out.push(m);
    }
  }
  return out;
}
