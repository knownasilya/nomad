import { useCallback, useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Backend, PersonasList } from './useBackend'

// 'done' once the phone has offered its Persona step (made or skipped), or found the user already
// has one. Never asked again after that; Personas makes more.
const KEY = 'hb:persona-onboarding'

// The phone's onboarding step for a Persona (ADR-0031), like the computer's setup window
// (app/userland/setup/persona.js). Personas live in the Vault, so the phone asks once it is linked
// and can write the Vault, and only if the user has none: one made on their computer reached the
// Vault before the computer added this phone as a writer, so a writable phone already sees it.
// The first Persona becomes the default, which is what the user's first Space (and every Space
// without its own) uses.
export function usePersonaOnboarding (apps: Backend['apps'], onVaultChange: Backend['onVaultChange'], space: string | null) {
  const [visible, setVisible] = useState(false)
  const pending = useRef<boolean | null>(null) // null until AsyncStorage answers
  const checking = useRef(false)
  const appsRef = useRef(apps)
  appsRef.current = apps
  const spaceRef = useRef(space)
  spaceRef.current = space

  const finish = useCallback(() => {
    pending.current = false
    setVisible(false)
    AsyncStorage.setItem(KEY, 'done').catch(() => {})
  }, [])

  const check = useCallback(async () => {
    if (!pending.current || checking.current) return
    checking.current = true
    try {
      const res = await appsRef.current<PersonasList>('personas', 'list', { space: spaceRef.current })
      if (!pending.current || !res.ok || !res.value) return // not linked yet: ask once it is
      if (res.value.personas.length) { finish(); return }
      if (res.value.writable) setVisible(true)
    } catch {} finally {
      checking.current = false
    }
  }, [finish])

  useEffect(() => {
    let live = true
    AsyncStorage.getItem(KEY).then((v) => {
      if (!live) return
      pending.current = v !== 'done'
      check()
    }).catch(() => {})
    return () => { live = false }
  }, [check])

  // Linking, and the Vault catching up after it, arrive as Vault changes.
  useEffect(() => onVaultChange(() => { check() }), [onVaultChange, check])

  return { visible, finish }
}
