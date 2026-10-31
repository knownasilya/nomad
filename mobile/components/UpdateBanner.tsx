import { useMemo } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTheme, type Theme } from '../lib/theme'
import IconButton from './IconButton'
import { confirmInstall, dismissUpdate, installUpdate, useUpdateState } from '../lib/updater'

// A strip at the bottom of the browser while an update is available or installing (lib/updater.ts).
// Nothing shows when there is no update.
export default function UpdateBanner () {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const state = useUpdateState()

  if (state.kind === 'idle') return null
  const failed = state.kind === 'failed'

  const title =
    state.kind === 'available' ? `Nomad ${state.release.version} is available`
      : state.kind === 'downloading' ? `Downloading ${state.release.version}… ${Math.round(state.progress * 100)}%`
        : state.kind === 'installing' ? (state.needsConfirm ? `Nomad ${state.release.version} is ready to install` : `Installing ${state.release.version}…`)
          : 'Update failed'

  return (
    <View style={s.banner}>
      <View style={s.row}>
        <View style={s.text}>
          <Text style={[s.title, failed && s.titleFailed]} numberOfLines={1}>{title}</Text>
          {state.kind === 'failed' ? <Text style={s.error}>{state.error}</Text> : null}
        </View>
        {state.kind === 'available' ? (
          <TouchableOpacity onPress={() => installUpdate(state.release)} hitSlop={6}>
            <Text style={s.action}>Update</Text>
          </TouchableOpacity>
        ) : null}
        {state.kind === 'installing' && state.needsConfirm ? (
          <TouchableOpacity onPress={confirmInstall} hitSlop={6}>
            <Text style={s.action}>Install</Text>
          </TouchableOpacity>
        ) : null}
        {state.kind === 'failed' && state.release ? (
          <TouchableOpacity onPress={() => installUpdate(state.release!)} hitSlop={6}>
            <Text style={s.action}>Retry</Text>
          </TouchableOpacity>
        ) : null}
        {state.kind === 'available' || state.kind === 'failed' ? (
          <IconButton icon='times' label='Dismiss' onPress={dismissUpdate} size={15} color={t.textMuted} style={s.close} />
        ) : null}
      </View>
      {state.kind === 'downloading' ? (
        <View style={s.track}>
          <View style={[s.bar, { width: `${Math.round(state.progress * 100)}%` }]} />
        </View>
      ) : null}
    </View>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    banner: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border, backgroundColor: t.surface, paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 18 },
    text: { flex: 1 },
    title: { color: t.text, fontSize: 13, fontWeight: '600' },
    titleFailed: { color: t.danger },
    error: { color: t.textDim, fontSize: 12, marginTop: 2, lineHeight: 17 },
    action: { color: t.accent, fontSize: 15, fontWeight: '600' },
    close: { width: 40, height: 40, marginVertical: -8, marginRight: -10 },
    track: { height: 3, borderRadius: 2, backgroundColor: t.surfaceAlt, overflow: 'hidden' },
    bar: { height: 3, backgroundColor: t.accent }
  })
}
