// The AI panel's step list for one turn, from the Provider's tool events (app/bg/ai/tool-events.mjs,
// shaped after AG-UI's TOOL_CALL_START / TOOL_CALL_END). A step with an id runs until the `end`
// event with that id, so a capability that `execute` calls can run inside it. A step without one
// (an older Provider) runs until the next step starts. A `note` is done as it arrives.

export interface Step { id?: string; label: string; done: boolean; error?: boolean }

// The label for a tool event, or null when the event is not a step. A 'write' event follows the
// 'start' event of the same write, and a screenshot is only for the transcript.
export function stepLabel (e: any): string | null {
  if (!e || (e.phase !== 'start' && e.phase !== 'note')) return null
  return e.summary || e.name || 'Working…'
}

export function applyToolEvent (steps: Step[], e: any): Step[] {
  if (e?.phase === 'end') {
    if (!e.id) return steps
    return steps.map((x) => (x.id === e.id ? { ...x, done: true, error: !!e.error } : x))
  }
  const label = stepLabel(e)
  if (!label) return steps
  const step: Step = { label, done: e.phase === 'note' }
  if (e.phase === 'start' && typeof e.id === 'string' && e.id) step.id = e.id
  return [...steps.map((x) => (x.id ? x : { ...x, done: true })), step]
}

// Text arrived: the tools before it are done.
export function finishSteps (steps: Step[]): Step[] {
  return steps.every((x) => x.done) ? steps : steps.map((x) => ({ ...x, done: true }))
}
