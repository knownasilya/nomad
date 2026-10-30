import { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useTheme, radius, type Theme } from '../lib/theme'

// Shown by Reader, Notes and the name sheet when this phone isn't linked. They keep their data in the
// Vault (ADR-0017, ADR-0018), so an unlinked phone has nothing to show.
const NOUN = { Reader: 'feeds', Notes: 'notes', Names: 'names', Jobs: 'AI Jobs' }

export default function LinkPhone ({ what, onOpenDevices }: { what: keyof typeof NOUN; onOpenDevices: () => void }) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  return (
    <View style={s.page}>
      <Text style={s.heading}>Link this phone</Text>
      <Text style={s.body}>
        {what} {what === 'Names' || what === 'Jobs' ? 'sync' : 'syncs'} through your Vault. Link this phone to your computer to see the same {NOUN[what]} on both.
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
    btn: { backgroundColor: t.accent, borderRadius: radius.pill, paddingHorizontal: 20, minHeight: 40, justifyContent: 'center', marginTop: 16 },
    btnText: { color: t.onAccent, fontSize: 14, fontWeight: '600' }
  })
}
