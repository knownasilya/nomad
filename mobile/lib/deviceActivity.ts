import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import type { Backend } from './useBackend'

// Whether the user is using this phone, told to the backend, which tells the user's computers in its
// device-presence HELLO (shared/device-activity.mjs). A computer then keeps a Job result, a Message or
// a Space's notice off its screen while the user is on the phone, and this phone keeps them off its
// own while they're on a computer (notifyHere). Neither used in the last two minutes: both notify.
//
// "Using" is the app on screen. The backend counts a ping as good for 30 s, so the UI pings well
// inside that while it's open, and says once when it leaves.

const PING_MS = 10e3

export function useDeviceActivity (backend: Pick<Backend, 'apps'>) {
  const appsRef = useRef(backend.apps)
  appsRef.current = backend.apps
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    const tell = (active: boolean) => { appsRef.current('activity', 'set', { active }).catch(() => {}) }
    const start = () => {
      tell(true)
      if (!timer) timer = setInterval(() => tell(true), PING_MS)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
      tell(false)
    }
    if (AppState.currentState === 'active') start()
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') start(); else stop() })
    return () => {
      sub.remove()
      if (timer) clearInterval(timer)
    }
  }, [])
}

// Whether a notification shows on this phone: always while the app is on screen; otherwise not
// when the user is on one of their computers right now. Shows when the backend can't say.
export async function notifyHere (apps: Backend['apps']): Promise<boolean> {
  if (AppState.currentState === 'active') return true
  const res = await apps<boolean>('activity', 'notifyHere').catch(() => null)
  return !res?.ok || res.value !== false
}
