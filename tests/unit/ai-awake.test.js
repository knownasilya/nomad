// Keep-awake controller (app/bg/ai/awake.js) — the powerSaveBlocker hold that keeps an idle Device
// reachable as an AI Provider (ADR-0013 §7 amendment).
//
// createAwakeController is a pure DI module (no `electron` import — bg/web-apis/bg/ai.ts supplies
// the real powerSaveBlocker/powerMonitor), so these tests inject plain fakes. What's locked in here
// is the behaviour that is easy to get wrong and invisible when it breaks: the refcount across two
// independent holds, the battery gate applying to the STANDING hold only, and the Linux-only poll
// that exists because powerMonitor emits no battery events there.

import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  createAwakeController,
  readLinuxAcState,
  REASON_PROVIDER,
  REASON_TURN,
} from '../../app/bg/ai/awake.js'

function makeBlocker () {
  let seq = 0
  const started = new Set()
  return {
    starts: 0,
    stops: 0,
    start (type) {
      this.starts++
      const id = ++seq
      started.add(id)
      this.lastType = type
      return id
    },
    stop (id) { this.stops++; started.delete(id) },
    isStarted: (id) => started.has(id),
    get active () { return started.size }
  }
}

function makeMonitor (onBattery = false) {
  const listeners = new Map()
  return {
    onBattery,
    isOnBatteryPower () { return this.onBattery },
    on (ev, fn) { listeners.set(ev, [...(listeners.get(ev) || []), fn]) },
    emit (ev) { for (const fn of listeners.get(ev) || []) fn() }
  }
}

let blocker, monitor, timers
function build (opts = {}) {
  blocker = makeBlocker()
  monitor = makeMonitor(opts.onBattery)
  timers = []
  const ctl = createAwakeController({
    powerSaveBlocker: blocker,
    powerMonitor: monitor,
    platform: opts.platform || 'darwin',
    desktopEnv: opts.desktopEnv || '',
    readAcState: opts.readAcState || (() => null),
    setIntervalFn: (fn) => { const t = { fn }; timers.push(t); return t },
    clearIntervalFn: (t) => { timers = timers.filter((x) => x !== t) },
    onWillQuit: (fn) => { opts.captureQuit && opts.captureQuit(fn) }
  })
  ctl.setup()
  return ctl
}

describe('awake: holding and releasing', () => {
  beforeEach(() => { blocker = null })

  it('holds one blocker while a reason is held', () => {
    const ctl = build()
    ctl.start(REASON_PROVIDER)
    expect(blocker.active).toBe(1)
    expect(blocker.lastType).toBe('prevent-app-suspension')
    ctl.stop(REASON_PROVIDER)
    expect(blocker.active).toBe(0)
  })

  it('does not stack blockers for two reasons, and holds until the last is released', () => {
    const ctl = build()
    ctl.start(REASON_PROVIDER)
    ctl.start(REASON_TURN)
    expect(blocker.starts).toBe(1)
    ctl.stop(REASON_PROVIDER)
    expect(blocker.active).toBe(1) // the turn still needs it
    ctl.stop(REASON_TURN)
    expect(blocker.active).toBe(0)
  })

  it('ignores a duplicate start and an unknown stop', () => {
    const ctl = build()
    ctl.start(REASON_PROVIDER)
    ctl.start(REASON_PROVIDER)
    ctl.stop(REASON_TURN)
    expect(blocker.starts).toBe(1)
    expect(blocker.active).toBe(1)
  })

  it('releases everything on will-quit', () => {
    let quitFn
    const ctl = build({ captureQuit: (fn) => { quitFn = fn } })
    ctl.start(REASON_PROVIDER)
    quitFn()
    expect(blocker.active).toBe(0)
  })
})

describe('awake: the battery gate', () => {
  it('refuses the standing hold while on battery', () => {
    const ctl = build({ onBattery: true })
    ctl.start(REASON_PROVIDER)
    expect(blocker.active).toBe(0)
    expect(ctl.getStatus().paused).toBe(true)
  })

  it('still holds for an in-flight turn on battery', () => {
    const ctl = build({ onBattery: true })
    ctl.start(REASON_TURN)
    expect(blocker.active).toBe(1)
  })

  it('drops the standing hold when the power source goes to battery', () => {
    const ctl = build()
    ctl.start(REASON_PROVIDER)
    expect(blocker.active).toBe(1)
    monitor.onBattery = true
    monitor.emit('on-battery')
    expect(blocker.active).toBe(0)
  })

  it('re-acquires when plugged back in', () => {
    const ctl = build({ onBattery: true })
    ctl.start(REASON_PROVIDER)
    expect(blocker.active).toBe(0)
    monitor.onBattery = false
    monitor.emit('on-ac')
    expect(blocker.active).toBe(1)
    expect(ctl.getStatus().paused).toBe(false)
  })

  it('keeps a turn alive when the user unplugs mid-turn', () => {
    const ctl = build()
    ctl.start(REASON_PROVIDER)
    ctl.start(REASON_TURN)
    monitor.onBattery = true
    monitor.emit('on-battery')
    expect(blocker.active).toBe(1) // the turn finishes; only the standing hold drops
    ctl.stop(REASON_TURN)
    expect(blocker.active).toBe(0)
  })

  it('reads the initial power source at setup, before any event fires', () => {
    // Neither macOS event fires until a TRANSITION, so a controller that only listened would
    // wrongly hold on a machine that was already unplugged at launch.
    const ctl = build({ onBattery: true })
    expect(ctl.getStatus().onBattery).toBe(true)
  })
})

describe('awake: linux', () => {
  it('polls for battery state, because powerMonitor emits no events there', () => {
    const ctl = build({ platform: 'linux', desktopEnv: 'GNOME', readAcState: () => true })
    expect(timers.length).toBe(0) // nothing held: nothing to poll for
    ctl.start(REASON_PROVIDER)
    expect(timers.length).toBe(1)
    ctl.stop(REASON_PROVIDER)
    expect(timers.length).toBe(0)
  })

  it('acts on what the poll finds', () => {
    let onAc = true
    const ctl = build({ platform: 'linux', desktopEnv: 'GNOME', readAcState: () => onAc })
    ctl.start(REASON_PROVIDER)
    expect(blocker.active).toBe(1)
    onAc = false
    timers[0].fn()
    expect(blocker.active).toBe(0)
  })

  it('prefers sysfs over powerMonitor, which under-reports on linux', () => {
    // A flat `false` from isOnBatteryPower() would defeat the gate on exactly the machine that
    // needs it — an unplugged laptop.
    const ctl = build({ platform: 'linux', onBattery: false, readAcState: () => false })
    ctl.start(REASON_PROVIDER)
    expect(ctl.getStatus().onBattery).toBe(true)
    expect(blocker.active).toBe(0)
  })

  it('falls back to powerMonitor when sysfs cannot tell', () => {
    const ctl = build({ platform: 'linux', onBattery: true, readAcState: () => null })
    ctl.start(REASON_PROVIDER)
    expect(ctl.getStatus().onBattery).toBe(true)
  })

  it('warns on a session with no inhibit backend, but still makes the call', () => {
    const ctl = build({ platform: 'linux', desktopEnv: 'sway', readAcState: () => true })
    ctl.start(REASON_PROVIDER)
    expect(blocker.active).toBe(1) // we cannot detect the no-op, so we never skip the call
    expect(ctl.getStatus().unsupported).toMatch(/no sleep-inhibit backend/)
  })

  it('stays quiet on a session Chromium can inhibit', () => {
    const ctl = build({ platform: 'linux', desktopEnv: 'KDE', readAcState: () => true })
    expect(ctl.getStatus().unsupported).toBeNull()
  })

  it('never warns off-linux', () => {
    const ctl = build({ platform: 'darwin', desktopEnv: 'sway' })
    expect(ctl.getStatus().unsupported).toBeNull()
  })
})

describe('readLinuxAcState', () => {
  let root
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'awake-sysfs-'))
  })

  function supply (name, type, extra = {}) {
    const dir = path.join(root, name)
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'type'), type + '\n')
    for (const [k, v] of Object.entries(extra)) fs.writeFileSync(path.join(dir, k), v + '\n')
  }

  it('reports AC when the mains adapter is online', () => {
    supply('AC', 'Mains', { online: 1 })
    supply('BAT0', 'Battery', {})
    expect(readLinuxAcState(root)).toBe(true)
  })

  it('reports battery when the mains adapter is offline', () => {
    supply('AC', 'Mains', { online: 0 })
    supply('BAT0', 'Battery', {})
    expect(readLinuxAcState(root)).toBe(false)
  })

  it('treats a machine with no battery as always on AC', () => {
    // A desktop or an always-on server: the gate should never engage there.
    supply('AC', 'Mains', { online: 0 })
    expect(readLinuxAcState(root)).toBe(true)
  })

  it('returns null when it cannot tell, so the caller falls back', () => {
    supply('BAT0', 'Battery', {})
    expect(readLinuxAcState(root)).toBeNull()
    expect(readLinuxAcState(path.join(root, 'nope'))).toBeNull()
  })
})
