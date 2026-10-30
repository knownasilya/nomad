// The lifecycle of one tool call on a chat turn's emitter, shaped after AG-UI's tool call events
// (https://docs.ag-ui.com/concepts/events): a `start` event (TOOL_CALL_START) and an `end` event
// (TOOL_CALL_END) that share an `id` (toolCallId). A call made from inside another one (a
// capability that `execute` runs) names that call as `parentId`. The `end` event carries `error`
// when the call failed. The AI Sidebar and the phone's AI panel mark a step done on its `end`; an
// older Provider sends no `end`, so a step without an `id` is done once the next one starts.
import { randomUUID } from 'crypto';
import { toolSummary } from './tool-summary.mjs';

export function newToolCallId() {
  return 'call_' + randomUUID();
}

// Emits `start`, runs `run()`, then emits `end`, and returns or rethrows what `run()` did. With no
// emitter it only runs.
export async function trackToolCall(emitter, call = {}, run) {
  if (!emitter) return run();
  const { id, parentId, name, args } = /** @type {any} */ (call);
  const toolCallId = id || newToolCallId();
  emitter.emit('tool', {
    phase: 'start',
    id: toolCallId,
    ...(parentId ? { parentId } : {}),
    name,
    summary: toolSummary(name, args || {}),
  });
  try {
    const result = await run();
    emitter.emit('tool', { phase: 'end', id: toolCallId, name });
    return result;
  } catch (err) {
    emitter.emit('tool', {
      phase: 'end',
      id: toolCallId,
      name,
      error: err?.message || String(err),
    });
    throw err;
  }
}
