// The backend's log, for the phone's Logs page (Settings → Logs), like desktop's General Logs.
//
// Every console line from the Bare worklet is kept in memory (the last MAX_ENTRIES) and appended
// to <dir>/backend.log as JSON lines. At startup the previous session's file is moved to
// backend.prev.log, so after a crash the Logs page can still show what led up to it: Bare prints an
// uncaught exception with console.error and then aborts, and error lines are written to disk
// synchronously, so that last line is in the file too.
//
// fs and join are injected (bare-fs / bare-path in the app) so this runs under Node in tests.

const MAX_ENTRIES = 1000
const MAX_FILE_BYTES = 512 * 1024 // a previous session's log is cut to its last half MB
const MAX_LINE = 4000
const FLUSH_MS = 1000

export function createLogStore ({ fs, join, dir }) {
  const file = join(dir, 'backend.log')
  const prevFile = join(dir, 'backend.prev.log')
  const entries = []
  let seq = 0
  let pending = ''
  let timer = null

  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (fs.existsSync(file)) fs.renameSync(file, prevFile)
  } catch {}

  function flush () {
    if (timer) { clearTimeout(timer); timer = null }
    if (!pending) return
    const out = pending
    pending = ''
    try { fs.appendFileSync(file, out) } catch {}
  }

  function add (level, args) {
    const entry = { id: ++seq, t: Date.now(), level, msg: format(args) }
    entries.push(entry)
    if (entries.length > MAX_ENTRIES) entries.shift()
    pending += JSON.stringify(entry) + '\n'
    // An error may be the last thing before an abort, so it goes to disk now.
    if (level === 'error') flush()
    else if (!timer) timer = setTimeout(flush, FLUSH_MS)
    return entry
  }

  // Entries newer than `since` (an entry id), oldest first.
  function since (id = 0) {
    return entries.filter((e) => e.id > id)
  }

  // The previous session's entries, oldest first. Empty on the first run.
  function previous () {
    try {
      if (!fs.existsSync(prevFile)) return []
      let text = fs.readFileSync(prevFile).toString()
      if (text.length > MAX_FILE_BYTES) text = text.slice(text.length - MAX_FILE_BYTES)
      const out = []
      for (const line of text.split('\n')) {
        if (!line) continue
        try { out.push(JSON.parse(line)) } catch {}
      }
      return out
    } catch {
      return []
    }
  }

  return { add, since, previous, flush }
}

// console-style formatting: %s %d %i %f %o %O %j take the next argument, the rest are joined with
// spaces. An Error shows its stack.
export function format (args) {
  const list = Array.from(args)
  let out = ''
  if (typeof list[0] === 'string' && /%[sdifoOj%]/.test(list[0])) {
    const fmt = list.shift()
    out = fmt.replace(/%([sdifoOj%])/g, (m, k) => {
      if (k === '%') return '%'
      if (!list.length) return m
      const v = list.shift()
      if (k === 'd' || k === 'i') return String(parseInt(v, 10))
      if (k === 'f') return String(parseFloat(v))
      if (k === 's') return typeof v === 'string' ? v : show(v)
      return show(v)
    })
  }
  const rest = list.map(show).join(' ')
  out = out ? (rest ? `${out} ${rest}` : out) : rest
  return out.length > MAX_LINE ? out.slice(0, MAX_LINE) + '…' : out
}

function show (v) {
  if (typeof v === 'string') return v
  if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`
  if (v === undefined) return 'undefined'
  if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`
  if (typeof v === 'bigint') return `${v}n`
  if (ArrayBuffer.isView(v)) return `<${v.byteLength} bytes>`
  try {
    return JSON.stringify(v, replacer) ?? String(v)
  } catch {
    return String(v)
  }
}

// Keeps bytes and bigints readable inside logged objects.
function replacer (k, x) {
  if (typeof x === 'bigint') return `${x}n`
  if (ArrayBuffer.isView(x)) return `<${x.byteLength} bytes>`
  if (x && x.type === 'Buffer' && Array.isArray(x.data)) return `<${x.data.length} bytes>`
  if (x instanceof Error) return x.stack || x.message
  return x
}
