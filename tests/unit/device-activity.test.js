// The rules for which of the user's Devices shows a notification (shared/device-activity.mjs).

import { describe, it, expect } from 'vitest'
import { ACTIVE_WINDOW_MS, RESEND_MS, TIE_MS, activityFrame, readActivity, lastActiveFrom, needsResend, notifyHere } from '../../shared/device-activity.mjs'

const NOW = 10_000_000

describe('activity frames', () => {
  it('say how long ago, never a time', () => {
    expect(activityFrame(NOW - 4321, NOW)).toEqual({ idleMs: 4321 })
    expect(activityFrame(NOW + 50, NOW)).toEqual({ idleMs: 0 })
    expect(activityFrame(null, NOW)).toBeNull()
  })

  it('are read onto the receiver’s clock', () => {
    expect(lastActiveFrom({ idleMs: 3000 }, 500_000)).toBe(497_000)
    expect(lastActiveFrom({ idleMs: 'x' }, 500_000)).toBeNull()
    expect(readActivity({ idleMs: -5 })).toBeNull()
    expect(readActivity([1])).toBeNull()
    expect(readActivity({ idleMs: 1e15 }).idleMs).toBeLessThan(1e10)
  })

  it('are sent again once the time moved by RESEND_MS', () => {
    expect(needsResend(NOW, null)).toBe(true)
    expect(needsResend(NOW, NOW - RESEND_MS + 1)).toBe(false)
    expect(needsResend(NOW, NOW - RESEND_MS)).toBe(true)
    expect(needsResend(null, NOW)).toBe(false)
  })
})

describe('notifyHere', () => {
  it('shows when no other Device is connected or says anything', () => {
    expect(notifyHere({ self: null, others: [], now: NOW })).toBe(true)
    expect(notifyHere({ self: NOW - 3_600_000, others: [null, NaN], now: NOW })).toBe(true)
  })

  it('shows on every Device when nobody used one in the window', () => {
    const others = [NOW - ACTIVE_WINDOW_MS, NOW - 10 * ACTIVE_WINDOW_MS]
    expect(notifyHere({ self: NOW - 5 * ACTIVE_WINDOW_MS, others, now: NOW })).toBe(true)
  })

  it('skips on the idle Device while another is in use', () => {
    // On the desktop: the phone is in the user's hand, the desktop untouched for 10 minutes.
    expect(notifyHere({ self: NOW - 600_000, others: [NOW - 2000], now: NOW })).toBe(false)
    // Never used since it started, and the other one is.
    expect(notifyHere({ self: null, others: [NOW - 2000], now: NOW })).toBe(false)
  })

  it('shows on the Device in use', () => {
    expect(notifyHere({ self: NOW, others: [NOW - 60_000], now: NOW })).toBe(true)
  })

  it('goes to the one used last when both were used in the window', () => {
    // Put the phone down 90 s ago and went back to the computer.
    expect(notifyHere({ self: NOW - 90_000, others: [NOW - 5000], now: NOW })).toBe(false) // phone
    expect(notifyHere({ self: NOW - 5000, others: [NOW - 90_000], now: NOW })).toBe(true) // computer
  })

  it('shows on both when they were used about as recently', () => {
    expect(notifyHere({ self: NOW - TIE_MS, others: [NOW], now: NOW })).toBe(true)
    expect(notifyHere({ self: NOW, others: [NOW - TIE_MS], now: NOW })).toBe(true)
  })

  it('never has both skip, from each one’s own view', () => {
    // Each sees the other a little late (the last HELLO), never early.
    for (const [a, b] of [[NOW - 1000, NOW - 40_000], [NOW - 30_000, NOW - 31_000], [NOW, NOW]]) {
      const aSees = notifyHere({ self: a, others: [b - 15_000], now: NOW })
      const bSees = notifyHere({ self: b, others: [a - 15_000], now: NOW })
      expect(aSees || bSees).toBe(true)
    }
  })
})
