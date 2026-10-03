// Forks one utility process per execute. The process is killed on timeout, abort,
// or completion. While a capability call is in flight (a permission prompt, a drive
// read) the timeout is paused so the user can answer.

import { app, utilityProcess } from 'electron'
import { join } from 'path'
import { timeoutMessage, unwrapMessage } from './execute-messages.mjs'

const IDLE_MS = 20_000

export function executeInUtilityProcess({ code, params, invoke, signal }) {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(join(app.getAppPath(), 'bg/ai/execute-worker.mjs'), [], {
      serviceName: 'nomad-ai-execute',
      stdio: 'pipe',
    })
    let settled = false
    let heard = false
    let stderr = ''
    let timer = null
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + String(chunk)).slice(-2000)
      })
    }

    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      fn(value)
    }
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => finish(reject, new Error(timeoutMessage(heard, stderr))), IDLE_MS)
    }
    const onAbort = () => finish(reject, abortError())
    if (signal) {
      if (signal.aborted) {
        finish(reject, abortError())
        return
      }
      signal.addEventListener('abort', onAbort)
    }
    arm()

    child.on('message', async (message) => {
      const msg = unwrapMessage(message)
      if (!msg || settled) return
      heard = true
      if (msg.type === 'call') {
        clearTimeout(timer)
        try {
          const value = await invoke(msg)
          if (settled) return
          arm()
          child.postMessage({ type: 'callResult', callId: msg.callId, ok: true, value })
        } catch (err) {
          if (settled) return
          arm()
          child.postMessage({
            type: 'callResult',
            callId: msg.callId,
            ok: false,
            error: err && err.message ? err.message : String(err),
          })
        }
        return
      }
      if (msg.type === 'done') {
        if (msg.ok) finish(resolve, msg.value)
        else finish(reject, new Error(msg.error || 'execute failed'))
      }
    })
    child.on('exit', (code) => {
      if (!settled) finish(reject, new Error(`execute process exited (${code})`))
    })
    child.once('spawn', () => {
      if (settled) return
      child.postMessage({ type: 'run', code, params: params == null ? {} : params })
    })
  })
}

function abortError() {
  const err = new Error('execute aborted')
  err.name = 'AbortError'
  return err
}
