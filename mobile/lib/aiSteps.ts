// The AI panel's step list for one turn, from the Provider's tool events (app/bg/ai/tool-events.mjs,
// shaped after AG-UI's TOOL_CALL_START / TOOL_CALL_END), and how long the model thought. A copy of
// shared/ai-steps.mjs, which the desktop sidebar uses (the phone's bundle can't reach shared/):
// tests/unit/ai-steps.test.js runs the same cases on both, so change them together.
//
// A step with an id runs until the `end` event with that id, so a capability that `execute` calls
// can run inside it (`child`). A step without one (an older Provider) runs until the next step
// starts. A `note` is done as it arrives. An answer keeps its steps as SavedSteps.

export interface Step { id?: string; name?: string; label: string; done: boolean; error?: boolean; why?: string; child?: boolean }
export interface SavedStep { label: string; error?: boolean; child?: boolean }

// A saved answer keeps at most this many steps, the newest.
export const MAX_SAVED_STEPS = 40

export function applyToolEvent (steps: Step[], e: any): Step[] {
  if (!e) return steps
  if (e.phase === 'end') {
    if (!e.id) return steps
    return steps.map((x) =>
      x.id === e.id
        ? { ...x, done: true, ...(e.error ? { error: true, why: String(e.error).slice(0, 300) } : {}) }
        : x
    )
  }
  if (e.phase === 'detail') {
    // A page action names the control once it has found it ("Clicking button “Sign in”").
    if (!e.summary) return steps
    if (e.id) return steps.map((x) => (x.id === e.id ? { ...x, label: String(e.summary) } : x))
    const last = steps[steps.length - 1]
    return last && last.name === e.name
      ? [...steps.slice(0, -1), { ...last, label: String(e.summary) }]
      : steps
  }
  if (e.phase !== 'start' && e.phase !== 'note') return steps
  const step: Step = {
    label: String(e.summary || e.name || 'Working…').slice(0, 200),
    done: e.phase === 'note'
  }
  if (e.name) step.name = String(e.name)
  if (e.phase === 'start' && typeof e.id === 'string' && e.id) step.id = e.id
  if (e.parentId) step.child = true
  return [...steps.map((x) => (x.id || x.done ? x : { ...x, done: true })), step]
}

// Text arrived (or the answer ended): the tools before it are done.
export function finishSteps (steps: Step[]): Step[] {
  return steps.every((x) => x.done) ? steps : steps.map((x) => ({ ...x, done: true }))
}

// The steps as an answer keeps them: { label, error?, child? }, the newest MAX_SAVED_STEPS.
export function savedSteps (steps: Array<Step | SavedStep> | undefined | null): SavedStep[] {
  return (Array.isArray(steps) ? steps : [])
    .filter((x) => x && typeof x.label === 'string' && x.label)
    .slice(-MAX_SAVED_STEPS)
    .map((x) => ({
      label: x.label.slice(0, 200),
      ...(x.error ? { error: true } : {}),
      ...(x.child ? { child: true } : {})
    }))
}

// "Used 3 tools", "Used 1 tool · 1 failed". A child step is one the code ran inside another, so
// only the top-level ones are counted, unless there are none.
export function stepsLabel (steps: Array<Step | SavedStep> | undefined | null): string {
  const list = Array.isArray(steps) ? steps : []
  const top = list.filter((x) => !x.child)
  const n = top.length || list.length
  const failed = list.filter((x) => x.error).length
  return `Used ${n} tool${n === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}`
}

// The reasoning's label once the model stopped thinking: "Thought for 4s", "Thought for 1m 5s".
// Under a second is "Thought for a moment"; an answer saved before the time was kept is "Thoughts".
export function thoughtLabel (ms: unknown): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return 'Thoughts'
  if (ms < 1000) return 'Thought for a moment'
  const s = Math.round(ms / 1000)
  if (s < 60) return `Thought for ${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return `Thought for ${m}m${r ? ` ${r}s` : ''}`
}

export interface ThinkClock { think: () => void; stop: () => number; readonly thinking: boolean; readonly ms: number }

// Times a turn's thinking. Reasoning can come in several stretches (between tool calls); each
// stretch runs from its first reasoning chunk to the next thing the model does.
export function thinkClock (now: () => number = () => Date.now()): ThinkClock {
  let total = 0
  let since: number | null = null
  return {
    think () {
      if (since === null) since = now()
    },
    stop () {
      if (since !== null) {
        total += now() - since
        since = null
      }
      return total
    },
    get thinking () {
      return since !== null
    },
    get ms () {
      return total + (since !== null ? now() - since : 0)
    }
  }
}
