// Parent and child do not see the same message object.
// The parent `message` event is the payload. The child's parentPort event is
// `{ data, ports }` (Electron.MessageEvent), which has no `type`.

export function unwrapMessage(message) {
  if (!message || typeof message !== 'object') return null
  const inner = message.data
  if (inner && typeof inner === 'object' && typeof inner.type === 'string') {
    if (message.type == null || message.type === 'message') return inner
  }
  if (typeof message.type === 'string') return message
  return null
}

export function timeoutMessage(heard, stderr) {
  const why = heard
    ? 'execute timed out waiting for the module to finish'
    : 'execute timed out before the module reported back'
  const extra = String(stderr || '').trim()
  return extra ? `${why}: ${extra}` : why
}
