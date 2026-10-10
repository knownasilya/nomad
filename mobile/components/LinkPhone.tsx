import { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useTheme, radius, type Theme } from '../lib/theme'

// Shown by Reader and Notes when this phone isn't linked. Both keep their data in the Vault
// (ADR-0017), so an unlinked phone has nothing to show.
export default function LinkPhone ({ what, onOpenDevices }: { what: 'Reader' | 'Notes'; onOpenDevices: () => void }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  return (
    <View style={s.page}>
      <Text style={s.heading}>Link this phone</Text>
      <Text style={s.body}>
        {what} syncs through your Vault. Link this phone to your computer to see the same {what === 'Reader' ? 'feeds' : 'notes'} on both.
      </Text>
      <TouchableOpacity style={s.btn} onPress={onOpenDevices}>
        <Text style={s.btnText}>Open Devices</Text>
      </TouchableOpacity>
    </View>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    page: { padding: 24, alignItems: 'center', marginTop: 24 },
    heading: { color: t.text, fontSize: 16, fontWeight: '700', marginBottom: 6 },
    body: { color: t.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
    btn: { backgroundColor: t.accent, borderRadius: radius.sm, paddingHorizontal: 16, paddingVertical: 10, marginTop: 16 },
    btnText: { color: t.onAccent, fontSize: 14, fontWeight: '600' }
  })
}
