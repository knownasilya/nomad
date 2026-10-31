import { useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTheme, type Theme } from '../lib/theme'
import IconButton from './IconButton'
import type { Backend } from '../lib/useBackend'
import { dismissJustUpdated, useDesktopUpdates, useJustUpdated } from '../lib/deviceUpdates'

// Right after the phone updated itself: a strip at the bottom of the browser offering to update the user's
// computers that still run an older Nomad. Tapping Update asks each of them to install the newest
// release and restart (lib/deviceUpdates.ts); the strip then follows how it goes until it is done.
export default function DesktopUpdateBanner ({ apps }: { apps: Backend['apps'] }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const updatedTo = useJustUpdated()
  const { desktops, request, error } = useDesktopUpdates(apps, !!updatedTo)
  const [asked, setAsked] = useState<string[]>([])

  if (!updatedTo) return null
  const behind = desktops.filter((d) => d.behind && !asked.includes(d.key))
  const following = desktops.filter((d) => asked.includes(d.key))
  if (!behind.length && !following.length) return null

  const names = (list: typeof desktops) => list.map((d) => d.name).join(' and ')
  const updateAll = async () => {
    const keys = behind.map((d) => d.key)
    setAsked((a) => [...a, ...keys])
    for (const key of keys) await request(key)
  }

  if (following.length && !behind.length) {
    const busy = following.some((d) => d.busy)
    return (
      <View style={s.banner}>
        <View style={s.row}>
          {busy ? <ActivityIndicator size='small' color={t.accent} /> : null}
          <View style={s.text}>
            {following.map((d) => (
              <Text key={d.key} style={s.title} numberOfLines={2}>
                {`${d.name}: ${d.message || (d.behind ? 'Asked to update' : `Updated to ${d.version}`)}`}
              </Text>
            ))}
            {error ? <Text style={s.error}>{error}</Text> : null}
          </View>
          {!busy ? <IconButton icon='times' label='Dismiss' onPress={dismissJustUpdated} size={15} color={t.textMuted} style={s.close} /> : null}
        </View>
      </View>
    )
  }

  return (
    <View style={s.banner}>
      <View style={s.row}>
        <View style={s.text}>
          <Text style={s.title} numberOfLines={1}>{`Nomad updated to ${updatedTo}`}</Text>
          <Text style={s.sub} numberOfLines={2}>
            {`${names(behind)} ${behind.length === 1 ? `runs ${behind[0].version}` : 'run an older version'}. Update and restart ${behind.length === 1 ? 'it' : 'them'} too?`}
          </Text>
        </View>
        <TouchableOpacity onPress={updateAll} hitSlop={6} accessibilityRole='button'>
          <Text style={s.action}>Update</Text>
        </TouchableOpacity>
        <IconButton icon='times' label='Dismiss' onPress={dismissJustUpdated} size={15} color={t.textMuted} style={s.close} />
      </View>
    </View>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    banner: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border, backgroundColor: t.surface, paddingHorizontal: 16, paddingVertical: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    text: { flex: 1 },
    title: { color: t.text, fontSize: 13, fontWeight: '600' },
    sub: { color: t.textDim, fontSize: 12, marginTop: 2, lineHeight: 17 },
    error: { color: t.danger, fontSize: 12, marginTop: 2, lineHeight: 17 },
    action: { color: t.accent, fontSize: 15, fontWeight: '600' },
    close: { width: 40, height: 40, marginVertical: -8, marginRight: -10 }
  })
}
