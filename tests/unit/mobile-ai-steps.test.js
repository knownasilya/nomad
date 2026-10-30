// The phone AI panel's step list (mobile/lib/aiSteps.ts), from the Provider's tool events.

import { describe, it, expect } from 'vitest'
import { applyToolEvent, finishSteps } from '../../mobile/lib/aiSteps.ts'

const run = (events) => events.reduce(applyToolEvent, [])

describe('applyToolEvent', () => {
  it('runs a step with an id until its end event', () => {
    const steps = run([
      { phase: 'start', id: 'a', name: 'execute', summary: 'Running code' },
      { phase: 'start', id: 'b', parentId: 'a', name: 'readDriveFile', summary: 'Reading /a' },
    ])
    expect(steps.map((x) => x.done)).toEqual([false, false])
    const ended = applyToolEvent(steps, { phase: 'end', id: 'b', name: 'readDriveFile' })
    expect(ended.map((x) => x.done)).toEqual([false, true])
    expect(applyToolEvent(ended, { phase: 'end', id: 'a' }).map((x) => x.done)).toEqual([true, true])
  })

  it('marks a failed tool', () => {
    const steps = run([
      { phase: 'start', id: 'a', name: 'search', summary: 'Searching' },
      { phase: 'end', id: 'a', name: 'search', error: 'boom' },
    ])
    expect(steps).toEqual([{ id: 'a', label: 'Searching', done: true, error: true }])
  })

  it('ends a step without an id when the next one starts (an older Provider)', () => {
    const steps = run([
      { phase: 'start', name: 'search', summary: 'Searching' },
      { phase: 'start', name: 'execute', summary: 'Running code' },
    ])
    expect(steps.map((x) => x.done)).toEqual([true, false])
  })

  it('shows a note as done and skips writes and screenshots', () => {
    const steps = run([
      { phase: 'note', name: 'webmcp', summary: 'No access' },
      { phase: 'write', name: 'writeDriveFile', path: '/a' },
      { phase: 'screenshot', name: 'screenshotCurrentPage' },
      { phase: 'end' },
    ])
    expect(steps).toEqual([{ label: 'No access', done: true }])
  })
})

describe('finishSteps', () => {
  it('marks every step done, and keeps the list when nothing changes', () => {
    const steps = run([{ phase: 'start', id: 'a', name: 'search', summary: 'Searching' }])
    expect(finishSteps(steps)[0].done).toBe(true)
    const done = finishSteps(steps)
    expect(finishSteps(done)).toBe(done)
  })
})
