import { describe, it, expect } from 'vitest'
import EventEmitter from 'events'
import { trackToolCall } from '../../app/bg/ai/tool-events.mjs'

function recorder() {
  const emitter = new EventEmitter()
  const events = []
  emitter.on('tool', (e) => events.push(e))
  return { emitter, events }
}

describe('trackToolCall', () => {
  it('sends start and end with the same id around the call', async () => {
    const { emitter, events } = recorder()
    const result = await trackToolCall(emitter, { id: 'call_1', name: 'search', args: { query: 'notes' } }, async () => 'ok')
    expect(result).toBe('ok')
    expect(events.map((e) => [e.phase, e.id, e.name])).toEqual([
      ['start', 'call_1', 'search'],
      ['end', 'call_1', 'search'],
    ])
    expect(typeof events[0].summary).toBe('string')
    expect(events[1].error).toBeUndefined()
  })

  it('makes an id when the runtime gave none, and names the parent call', async () => {
    const { emitter, events } = recorder()
    await trackToolCall(emitter, { parentId: 'call_1', name: 'readDriveFile', args: { path: '/a' } }, async () => 'x')
    expect(events[0].id).toMatch(/^call_/)
    expect(events[0].parentId).toBe('call_1')
    expect(events[1].id).toBe(events[0].id)
  })

  it('ends a failed call with its error and rethrows', async () => {
    const { emitter, events } = recorder()
    await expect(
      trackToolCall(emitter, { id: 'call_2', name: 'execute' }, async () => {
        throw new Error('nope')
      })
    ).rejects.toThrow('nope')
    expect(events[1]).toEqual({ phase: 'end', id: 'call_2', name: 'execute', error: 'nope' })
  })

  it('only runs the call without an emitter', async () => {
    expect(await trackToolCall(null, { name: 'search' }, async () => 3)).toBe(3)
  })
})
