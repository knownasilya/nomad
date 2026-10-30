// Page control: the AI Sidebar clicks, types and scrolls on the page in the user's tab (ADR-0028).
// These are the rules that need no Electron: which pages and fields are off limits, which clicks
// wait for the user's OK, how long "allow on this site" lasts, the keys pressKey knows, and what the
// model sees of a control. bg/ui/page-control.js runs the actions. Unit tests load this file.

// The capabilities. snapshotPage only reads; the rest act on the page.
export const PAGE_ACTIONS = [
  'snapshotPage',
  'clickElement',
  'typeText',
  'pressKey',
  'selectOption',
  'scrollPage',
  'clickAt',
]

// The site's permission, kept in sitedata as the time the grant ends. 1 is Allow and 0 is Deny,
// picked in the site-info panel.
export const PAGE_CONTROL_PERM = 'aiPageControl'
// A click the user confirms first. Its param makes each one a new question.
export const PAGE_ACTION_PERM = 'aiPageAction'
export const GRANT_DAYS = 30
const DAY = 24 * 60 * 60 * 1000

export const MAX_TEXT = 5000
export const SCROLL_DIRECTIONS = ['down', 'up', 'left', 'right', 'top', 'bottom']

export function isPageAction(name) {
  return PAGE_ACTIONS.includes(name)
}

// When a grant made now ends.
export function grantUntil(now = Date.now()) {
  return now + GRANT_DAYS * DAY
}

// What the stored value says: 'allow', 'deny', or 'ask' (none yet, or the 30 days ran out).
export function storedGrant(value, now = Date.now()) {
  if (value == null || value === '') return 'ask'
  const v = Number(value)
  if (Number.isNaN(v)) return 'ask'
  if (v === 0) return 'deny'
  if (v === 1) return 'allow'
  return v > now ? 'allow' : 'ask'
}

// Why the AI may not control this page, or null. Never nomad:// pages, the private drive, or
// anything that isn't a web or hyper:// page.
export function pageOffLimits(url) {
  let u
  try {
    u = new URL(String(url || ''))
  } catch {
    return 'There is no page open in this tab.'
  }
  if (u.protocol === 'hyper:' && u.hostname === 'private') {
    return "You can't control pages in the user's private drive."
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'hyper:') {
    return `You can only control web and hyper:// pages, and this tab shows ${u.protocol}// page.`
  }
  return null
}

// The site a grant is for: scheme and host.
export function siteOf(url) {
  try {
    const u = new URL(String(url))
    return `${u.protocol}//${u.host}`
  } catch {
    return ''
  }
}

const PASSWORD_AC = /(^|\s)(current-password|new-password|one-time-code)(\s|$)/
const PAYMENT_AC = /(^|\s)cc-/
const PAYMENT_NAME = /(card.?(number|num|no\b)|cc.?(num|number)|\bcvv|\bcvc|\bcsc\b|security.?code)/i

// Why the AI may not type into or click a control, or null: password and payment fields are the
// user's to fill, and a file input opens a file picker on the user's computer.
export function blockedReason(control) {
  const c = control || {}
  const type = lower(c.type)
  const ac = lower(c.autocomplete)
  if (type === 'password' || PASSWORD_AC.test(ac)) return 'password'
  if (PAYMENT_AC.test(ac) || PAYMENT_NAME.test(`${c.nameAttr || ''} ${c.id || ''}`)) return 'payment'
  if (type === 'file') return 'file'
  return null
}

export function blockedMessage(reason) {
  switch (reason) {
    case 'password':
      return "That's a password field. Only the user types passwords: ask them to fill it in."
    case 'payment':
      return "That's a payment field. Only the user types card details: ask them to fill it in."
    case 'file':
      return 'That opens a file picker on the user\'s computer. Ask the user to choose the file.'
    default:
      return "You can't use that control."
  }
}

const RISKY =
  /\b(buy|purchase|pay|checkout|check out|place (your |my )?order|order now|subscribe|donate|send|post|publish|tweet|delete|remove|unsubscribe|transfer|withdraw|book now|reserve)\b/i

// The words that make a click one the user confirms first (it spends money, sends or posts
// something, or deletes something), or null.
export function riskyWords(name) {
  const m = RISKY.exec(String(name || ''))
  return m ? m[0] : null
}

// A control as the model sees it. `tag`, `type` and the field's own attributes stay here: they are
// what blockedReason reads, not something the model needs.
export function forModel(control) {
  const c = control || {}
  const out = { ref: c.ref, role: c.role || 'generic', name: clip(c.name, 100) }
  const blocked = blockedReason(c)
  if (blocked) out.blocked = blocked
  else if (c.value != null && c.value !== '') out.value = clip(c.value, 200)
  if (c.href) out.href = clip(c.href, 200)
  if (c.checked != null) out.checked = c.checked
  if (c.expanded != null) out.expanded = c.expanded
  if (c.selected) out.selected = true
  if (c.disabled) out.disabled = true
  if (c.focused) out.focused = true
  if (!c.inView) out.offscreen = true
  return out
}

// snapshotPage's result: the page, then its controls in reading order. `onlyInView` is the short
// form an action returns: the controls on screen now.
export function snapshotForModel(snap, { onlyInView = false } = {}) {
  const s = snap || {}
  const all = Array.isArray(s.controls) ? s.controls : []
  const shown = onlyInView ? all.filter((c) => c.inView) : all
  const out = {
    url: s.url || null,
    title: s.title || '',
    controls: shown.map(forModel),
  }
  if (!onlyInView && Array.isArray(s.headings) && s.headings.length) out.headings = s.headings.map((h) => clip(h, 100))
  if (onlyInView && shown.length < all.length) {
    out.note = 'Only the controls on screen are listed. snapshotPage lists them all.'
  } else if (s.more) {
    out.more = `${s.more} more controls are further down the page. Scroll, then snapshot again.`
  }
  if (s.scroll) out.scroll = s.scroll
  return out
}

// What a control is called in the sidebar's list of steps and in a confirm: button “Sign in”.
export function describeControl(control) {
  const c = control || {}
  const name = clip(String(c.name || '').trim(), 60)
  const role = c.role && c.role !== 'generic' ? c.role : 'element'
  return name ? `${role} “${name}”` : role
}

const KEYS = {
  enter: 'Enter',
  return: 'Enter',
  tab: 'Tab',
  escape: 'Escape',
  esc: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  space: 'Space',
  arrowup: 'Up',
  up: 'Up',
  arrowdown: 'Down',
  down: 'Down',
  arrowleft: 'Left',
  left: 'Left',
  arrowright: 'Right',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
}
const MODIFIERS = {
  shift: 'shift',
  ctrl: 'control',
  control: 'control',
  alt: 'alt',
  option: 'alt',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
}
// What a key types, for Electron's 'char' event. Keys missing here type nothing.
const CHARS = { Enter: '\r', Space: ' ' }

// pressKey's `key`: a key name ("Enter", "ArrowDown", "a"), with modifiers joined by + ("Control+A").
// Returns Electron's { keyCode, modifiers, char }, or throws.
export function parseKey(input) {
  const raw = String(input ?? '')
  if (!raw.trim()) throw new Error('Pass `key`, e.g. "Enter", "Escape", "ArrowDown" or "Control+A"')
  // "+" on its own, or as the last part ("Shift++"), is the plus key.
  const parts = raw === '+' ? ['+'] : raw.endsWith('++') ? [...raw.slice(0, -2).split('+'), '+'] : raw.split('+')
  const modifiers = []
  for (const part of parts.slice(0, -1)) {
    const m = MODIFIERS[part.trim().toLowerCase()]
    if (!m) throw new Error(`Unknown modifier "${part}". Use Shift, Control, Alt or Meta.`)
    if (!modifiers.includes(m)) modifiers.push(m)
  }
  const last = parts[parts.length - 1]
  const name = last.length === 1 ? last : last.trim()
  let keyCode = KEYS[name.toLowerCase()]
  if (!keyCode) {
    if ([...name].length !== 1) throw new Error(`Unknown key "${name}"`)
    keyCode = name
  }
  // With Control, Alt or Meta held, a key is a shortcut and types nothing.
  const shortcut = modifiers.some((m) => m !== 'shift')
  const char = shortcut ? null : CHARS[keyCode] || (keyCode.length === 1 ? keyCode : null)
  return { keyCode, modifiers, char }
}

// The `ref` argument: a control's number from snapshotPage.
export function refArg(args) {
  const ref = Number(args?.ref)
  if (!Number.isInteger(ref) || ref < 1) throw new Error('Pass `ref`, the number of a control from snapshotPage')
  return ref
}

export function textArg(args) {
  if (typeof args?.text !== 'string') throw new Error('Pass the text to type as `text`')
  if (args.text.length > MAX_TEXT) throw new Error(`Type at most ${MAX_TEXT} characters at a time`)
  return args.text
}

export function directionArg(args) {
  const d = args?.direction == null ? 'down' : String(args.direction).toLowerCase()
  if (!SCROLL_DIRECTIONS.includes(d)) throw new Error(`direction is one of ${SCROLL_DIRECTIONS.join(', ')}`)
  return d
}

// clickAt's x and y are pixels in the last screenshot. The page's own coordinates, or throws.
export function screenshotPoint(args, shot) {
  if (!shot) throw new Error('Take a screenshot first (screenshotCurrentPage). x and y are pixels in it.')
  const x = Number(args?.x)
  const y = Number(args?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Pass `x` and `y`, pixels in the last screenshot')
  if (x < 0 || y < 0 || x > shot.width || y > shot.height) {
    throw new Error(`That point is outside the screenshot, which is ${shot.width}×${shot.height} pixels`)
  }
  return { x: (x * shot.cssWidth) / shot.width, y: (y * shot.cssHeight) / shot.height }
}

function lower(v) {
  return String(v || '').toLowerCase()
}

function clip(v, n) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
