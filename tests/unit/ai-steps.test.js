// An AI turn's steps and thinking time: shared/ai-steps.mjs (the desktop sidebar and a Job's chat)
// and its phone copy, mobile/lib/aiSteps.ts (the phone's AI panel). Every case runs on both.

import { describe, it, expect } from 'vitest'
import * as desktop from '../../shared/ai-steps.mjs'
import * as phone from '../../mobile/lib/aiSteps.ts'

for (const [where, lib] of [['shared', desktop], ['phone', phone]]) {
  const { applyToolEvent, finishSteps, savedSteps, stepsLabel, thoughtLabel, thinkClock, MAX_SAVED_STEPS } = lib
  const run = (events) => events.reduce(applyToolEvent, [])

  describe(`applyToolEvent (${where})`, () => {
    it('runs a step with an id until its end event, and marks a call made inside another', () => {
      const steps = run([
        { phase: 'start', id: 'a', name: 'execute', summary: 'Running code' },
        { phase: 'start', id: 'b', parentId: 'a', name: 'readDriveFile', summary: 'Reading /a' },
      ])
      expect(steps.map((x) => x.done)).toEqual([false, false])
      expect(steps.map((x) => !!x.child)).toEqual([false, true])
      const ended = applyToolEvent(steps, { phase: 'end', id: 'b', name: 'readDriveFile' })
      expect(ended.map((x) => x.done)).toEqual([false, true])
      expect(applyToolEvent(ended, { phase: 'end', id: 'a' }).map((x) => x.done)).toEqual([true, true])
    })

    it('marks a failed tool, with why', () => {
      const steps = run([
        { phase: 'start', id: 'a', name: 'search', summary: 'Searching' },
        { phase: 'end', id: 'a', name: 'search', error: 'boom' },
      ])
      expect(steps).toEqual([{ id: 'a', name: 'search', label: 'Searching', done: true, error: true, why: 'boom' }])
    })

    it('ends a step without an id when the next one starts (an older Provider)', () => {
      const steps = run([
        { phase: 'start', name: 'search', summary: 'Searching' },
        { phase: 'start', name: 'execute', summary: 'Running code' },
      ])
      expect(steps.map((x) => x.done)).toEqual([true, false])
    })

    it('renames a step from its detail, by id or by name', () => {
      let steps = run([{ phase: 'start', id: 'a', name: 'clickElement', summary: 'Clicking' }])
      steps = applyToolEvent(steps, { phase: 'detail', id: 'a', summary: 'Clicking button “Sign in”' })
      expect(steps[0].label).toBe('Clicking button “Sign in”')
      steps = run([{ phase: 'start', name: 'typeText', summary: 'Typing' }])
      steps = applyToolEvent(steps, { phase: 'detail', name: 'typeText', summary: 'Typing in “Email”' })
      expect(steps[0].label).toBe('Typing in “Email”')
      expect(applyToolEvent(steps, { phase: 'detail', name: 'other', summary: 'x' })).toBe(steps)
    })

    it('shows a note as done and skips writes and screenshots', () => {
      const steps = run([
        { phase: 'note', name: 'webmcp', summary: 'No access' },
        { phase: 'write', name: 'writeDriveFile', path: '/a' },
        { phase: 'screenshot', name: 'screenshotCurrentPage' },
        { phase: 'end' },
      ])
      expect(steps).toEqual([{ name: 'webmcp', label: 'No access', done: true }])
    })
  })

  describe(`finishSteps (${where})`, () => {
    it('marks every step done, and keeps the list when nothing changes', () => {
      const steps = run([{ phase: 'start', id: 'a', name: 'search', summary: 'Searching' }])
      expect(finishSteps(steps)[0].done).toBe(true)
      const done = finishSteps(steps)
      expect(finishSteps(done)).toBe(done)
    })
  })

  describe(`savedSteps and stepsLabel (${where})`, () => {
    it('keeps the label, a failure and a child, and nothing live', () => {
      const steps = run([
        { phase: 'start', id: 'a', name: 'execute', summary: 'Running code' },
        { phase: 'start', id: 'b', parentId: 'a', name: 'listNotes', summary: 'Looking through your Notes' },
        { phase: 'end', id: 'b', error: 'No' },
      ])
      expect(savedSteps(steps)).toEqual([
        { label: 'Running code' },
        { label: 'Looking through your Notes', error: true, child: true },
      ])
      expect(savedSteps(null)).toEqual([])
      expect(savedSteps([{ label: '' }, { nope: 1 }])).toEqual([])
    })

    it('keeps only the newest steps', () => {
      const many = Array.from({ length: MAX_SAVED_STEPS + 5 }, (_, i) => ({ label: `S${i}` }))
      const kept = savedSteps(many)
      expect(kept).toHaveLength(MAX_SAVED_STEPS)
      expect(kept[0].label).toBe('S5')
    })

    it('counts the top-level tools and the failures', () => {
      expect(stepsLabel([{ label: 'a' }])).toBe('Used 1 tool')
      expect(stepsLabel([{ label: 'a' }, { label: 'b', child: true }, { label: 'c', error: true }])).toBe('Used 2 tools · 1 failed')
      expect(stepsLabel([{ label: 'b', child: true }, { label: 'c', child: true }])).toBe('Used 2 tools')
    })
  })

  describe(`thinking time (${where})`, () => {
    it('labels how long the model thought', () => {
      expect(thoughtLabel(undefined)).toBe('Thoughts')
      expect(thoughtLabel(400)).toBe('Thought for a moment')
      expect(thoughtLabel(4200)).toBe('Thought for 4s')
      expect(thoughtLabel(60_000)).toBe('Thought for 1m')
      expect(thoughtLabel(65_400)).toBe('Thought for 1m 5s')
    })

    it('adds up the stretches the model thought, not the time between them', () => {
      let t = 0
      const clock = thinkClock(() => t)
      clock.think()
      t = 1000
      clock.think() // still the same stretch
      t = 2000
      expect(clock.thinking).toBe(true)
      expect(clock.stop()).toBe(2000)
      expect(clock.thinking).toBe(false)
      t = 10_000 // a tool ran
      clock.think()
      t = 11_500
      expect(clock.ms).toBe(3500)
      expect(clock.stop()).toBe(3500)
      expect(clock.stop()).toBe(3500)
    })
  })
}
