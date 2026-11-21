// Keeps the AI from going round in circles. A model can get stuck making the same call over and
// over: reading back what it saved, listing it, reading it again, each time with the same result
// (a watched Job did that for as long as it ran, alternating listScratch and readScratch "state").
// Nothing changes between those calls, so nothing will make it stop by itself.
//
// Two guards, one per scale:
// - A turn's guard (createLoopGuard) counts every call the turn makes, and every capability an
//   execute module calls, by what it was called with and what it gave back. The third time the same
//   call gives the same result, its result tells the model so. The sixth time, the result says to
//   stop and answer, and the turn takes no more tool calls. A turn also has at most MAX_ROUNDS model
//   calls.
// - A module's guard (createModuleGuard) stops one execute module (or a Job's job.js) that loops on
//   its own: the same call with the same result MODULE_REPEAT_STOP times, or MODULE_MAX_CALLS calls
//   in all. Without it a polling loop runs forever, because every call re-arms execute's idle timer.
//
// A call whose result changed (a page that loaded, a file that was written) is a new call: only
// calls that got nowhere count. No Electron imports: unit tests load this file.

// The third time a call gives the same result, its result says so.
export const NUDGE_AT = 3
// The sixth time, the turn is told to finish, and takes no more tool calls.
export const STOP_AT = 6
// The most model calls in one turn. A long page-control Job takes a few dozen.
export const MAX_ROUNDS = 200
// One module making the same call with the same result this many times is stuck.
export const MODULE_REPEAT_STOP = 10
// The most capability calls one module makes.
export const MODULE_MAX_CALLS = 1000

const MAX_SHOWN_ARGS = 160

/**
 * A turn's guard. `top` counts a call the model made (search, execute, or a capability over the
 * loopback MCP); `inner` counts a capability an execute module called, once per execute it shows up
 * in, so a module that reads the same thing twice isn't a loop, but ten executes that each read it
 * are.
 * @param {{ nudgeAt?: number, stopAt?: number }} [opts]
 */
export function createLoopGuard({ nudgeAt = NUDGE_AT, stopAt = STOP_AT } = {}) {
  const counts = new Map()
  // Per execute (its call id): the inner calls it made, by key.
  const inside = new Map()
  let stopped = null

  const bump = (key) => {
    const n = (counts.get(key) || 0) + 1
    counts.set(key, n)
    return n
  }

  return {
    /** A capability that the execute call `parentId` ran. */
    inner(parentId, name, args, result) {
      if (!parentId) return
      let calls = inside.get(parentId)
      if (!calls) inside.set(parentId, (calls = new Map()))
      const key = 'inner\0' + callKey(name, args, result)
      if (!calls.has(key)) calls.set(key, { name, args })
    },

    /**
     * A call the model made finished with `result`. Returns { repeats, verdict, name, args }: how many
     * times this turn the call (or a capability its code ran) gave this same result, and whether that
     * is fine ('ok'), worth telling the model ('nudge'), or the end ('stop').
     */
    top(id, name, args, result) {
      let worst = { repeats: bump('top\0' + callKey(name, args, result)), name, args }
      const calls = id ? inside.get(id) : null
      if (calls) {
        inside.delete(id)
        for (const [key, call] of calls) {
          const n = bump(key)
          if (n > worst.repeats) worst = { repeats: n, name: call.name, args: call.args }
        }
      }
      const verdict = worst.repeats >= stopAt ? 'stop' : worst.repeats >= nudgeAt ? 'nudge' : 'ok'
      if (verdict === 'stop' && !stopped) stopped = { name: worst.name, args: worst.args, repeats: worst.repeats }
      return { ...worst, verdict }
    },

    /** The call that made the turn stop ({ name, args, repeats }), or null. */
    get stopped() {
      return stopped
    },

    /** Stops the turn for another reason (too many rounds). */
    stop(reason) {
      if (!stopped) stopped = { reason }
    },
  }
}

/**
 * A module's guard: `check` after each capability it calls. Throws LoopError when the module is
 * stuck, and calls `onTrip` once, for the caller to end the module: a module can catch the error
 * and carry on.
 * @param {{ repeatStop?: number, maxCalls?: number, onTrip?: (err: LoopError) => void }} [opts]
 */
export function createModuleGuard({ repeatStop = MODULE_REPEAT_STOP, maxCalls = MODULE_MAX_CALLS, onTrip = () => {} } = {}) {
  const counts = new Map()
  let calls = 0
  let tripped = null
  return {
    check(name, args, result) {
      if (tripped) throw tripped
      calls++
      const key = callKey(name, args, result)
      const n = (counts.get(key) || 0) + 1
      counts.set(key, n)
      if (n >= repeatStop) {
        tripped = new LoopError(
          `Stopped this code: it called ${showCall(name, args)} ${n} times and got the same result every time, ` +
            'so it was going round in a loop. Calling it again won’t change the result. Use what it returned, ' +
            'or finish with your answer.'
        )
      } else if (calls >= maxCalls) {
        tripped = new LoopError(
          `Stopped this code after ${calls} calls. Do the work in smaller steps, or finish with what you have.`
        )
      }
      if (tripped) {
        onTrip(tripped)
        throw tripped
      }
    },
    /** The LoopError that stopped the module, or null. */
    get tripped() {
      return tripped
    },
  }
}

export class LoopError extends Error {
  constructor(message) {
    super(message)
    this.name = 'LoopError'
  }
}

// What the model reads after a call that got it nowhere ('nudge') or that ends its turn ('stop').
export function repeatNote({ verdict, repeats, name, args }) {
  if (verdict === 'nudge') {
    return (
      `[Nomad] This is the ${ordinal(repeats)} time in this turn that ${showCall(name, args)} gave exactly this ` +
      'result. Calling it again won’t change it. Use what you already have, try a different step, or finish ' +
      'with your answer.'
    )
  }
  if (verdict === 'stop') return STOP_NOTE(name, args, repeats)
  return ''
}

const STOP_NOTE = (name, args, repeats) =>
  `[Nomad] Stopped: ${showCall(name, args)} gave the same result ${repeats} times in this turn, so you are ` +
  'going round in a loop. Don’t call any more tools. Answer now: what you found, what you did, and what is ' +
  'left undone.'

// After MAX_ROUNDS model calls: one last call, to answer.
export const ROUNDS_NOTE =
  `[Nomad] You have used ${MAX_ROUNDS} steps in this turn, the most one turn may take. Don’t call any more ` +
  'tools. Answer now: what you found, what you did, and what is left undone.'

// The turn's error when the model kept calling tools after it was told to stop.
export function stoppedMessage(stopped) {
  if (stopped?.reason === 'rounds') {
    return `The assistant stopped after ${MAX_ROUNDS} steps without finishing.`
  }
  const what = stopped?.name ? ` (${plainCall(stopped.name, stopped.args)})` : ''
  return `The assistant stopped: it kept repeating the same step${what} without getting anywhere.`
}

// The refusal a call gets once the turn was stopped (a CLI runtime runs its own loop, so it may call
// again).
export function refusedMessage() {
  return 'Stopped: this turn takes no more tool calls because it was repeating itself. Answer now with what you have.'
}

/** Adds `note` to a tool result: text, or a screenshot's { text, imageDataUrl }. */
export function withNote(result, note) {
  if (!note) return result
  if (result && typeof result === 'object' && typeof result.imageDataUrl === 'string') {
    return { ...result, text: `${result.text || ''}\n\n${note}` }
  }
  const text = typeof result === 'string' ? result : result == null ? '' : JSON.stringify(result)
  return text ? `${text}\n\n${note}` : note
}

// The key of one call and its result. Long arguments and results are hashed, not kept.
export function callKey(name, args, result) {
  return `${String(name || '')}\0${digest(stableJson(args ?? {}))}\0${digest(resultText(result))}`
}

function resultText(result) {
  if (result instanceof Error) return 'error:' + result.message
  if (typeof result === 'string') return result
  if (result && typeof result === 'object' && typeof result.imageDataUrl === 'string') {
    return `${result.text || ''}\0${digest(result.imageDataUrl)}`
  }
  return stableJson(result)
}

// JSON with object keys sorted, so { a, b } and { b, a } are the same call.
export function stableJson(value) {
  try {
    return JSON.stringify(value, (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
        : v
    ) ?? 'undefined'
  } catch {
    return String(value)
  }
}

// FNV-1a over the text, twice with different seeds, and its length.
function digest(text) {
  const s = String(text)
  let a = 0x811c9dc5
  let b = 0x01000193 ^ s.length
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x5bd1e995)
  }
  return `${s.length}:${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`
}

// A call as the model wrote it: readScratch({"key":"state"}), or "the same code" for execute.
function showCall(name, args) {
  const n = String(name || '').replace(/^mcp__nomad__/, '')
  if (n === 'execute') return 'the same execute code'
  let a = stableJson(args ?? {})
  if (a === '{}') a = ''
  if (a.length > MAX_SHOWN_ARGS) a = a.slice(0, MAX_SHOWN_ARGS) + '…'
  return `${n}(${a})`
}

// For the user: the capability's name and, for a short key or path, which one.
function plainCall(name, args) {
  const n = String(name || '').replace(/^mcp__nomad__/, '')
  if (n === 'execute') return 'the same code'
  const what = args && typeof args === 'object' ? args.key || args.path || args.url || args.ref : null
  return typeof what === 'string' && what.length <= 60 ? `${n} “${what}”` : n
}

function ordinal(n) {
  const words = ['first', 'second', 'third', 'fourth', 'fifth']
  return words[n - 1] || `${n}th`
}
