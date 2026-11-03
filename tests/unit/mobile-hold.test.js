// A touch and hold with an action (the phone's tab count: a new tab) runs when the finger lifts,
// and never when the system takes the touch for its back gesture (mobile/lib/hold.ts).

import { describe, it, expect } from 'vitest'
import { createHold } from '../../mobile/lib/hold.ts'

const counted = () => {
  let runs = 0
  const hold = createHold(() => { runs++ })
  return { hold, runs: () => runs }
}

describe('touch and hold', () => {
  it('runs when the finger lifts after a hold', () => {
    const { hold, runs } = counted()
    hold.start(); hold.held()
    expect(runs()).toBe(0)
    hold.end()
    expect(runs()).toBe(1)
  })

  it('runs nothing for a tap', () => {
    const { hold, runs } = counted()
    hold.start(); hold.end()
    expect(runs()).toBe(0)
  })

  it('runs nothing when a back swipe from the edge takes the touch after the hold', () => {
    const { hold, runs } = counted()
    hold.start(); hold.held(); hold.cancel(); hold.end()
    expect(runs()).toBe(0)
  })

  it('runs once per hold', () => {
    const { hold, runs } = counted()
    hold.start(); hold.held(); hold.end(); hold.end()
    hold.start(); hold.end()
    expect(runs()).toBe(1)
  })
})
