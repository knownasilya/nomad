// Utility-process entry. The parent posts { type: 'run', code, params }.
// Capability calls go back to the parent as { type: 'call' } and wait for callResult.
// The module never sees the parent process: its only bridge is nomad:runtime.

import { runModule } from './search-execute.mjs'

let seq = 0
const pending = new Map()

function unwrap(event) {
  // Electron delivers parentPort messages as { data, type: 'message' }.
  if (event && event.data && event.data.type && event.type === 'message') return event.data
  return event
}

function callParent(payload) {
  const callId = ++seq
  return new Promise((resolve, reject) => {
    pending.set(callId, { resolve, reject })
    process.parentPort.postMessage({ type: 'call', callId, ...payload })
  })
}

process.parentPort.on('message', async (event) => {
  const msg = unwrap(event)
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'callResult') {
    const waiter = pending.get(msg.callId)
    if (!waiter) return
    pending.delete(msg.callId)
    if (msg.ok) waiter.resolve(msg.value)
    else waiter.reject(new Error(msg.error || 'call failed'))
    return
  }
  if (msg.type !== 'run') return
  try {
    const value = await runModule(msg.code, msg.params, (call) => callParent(call))
    process.parentPort.postMessage({ type: 'done', ok: true, value })
  } catch (err) {
    process.parentPort.postMessage({ type: 'done', ok: false, error: err && err.message ? err.message : String(err) })
  }
})
