import { useEffect, useMemo, useState } from 'react'
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { radius, useTheme, type Theme } from '../lib/theme'
import type { HostingMsg } from '../lib/useBackend'

interface Props {
  visible: boolean
  onClose: () => void
  hosting: (action: 'get' | 'set' | 'count' | 'settings', opts?: { dailyLimitMB?: number }) => Promise<HostingMsg>
  // Reports the latest hosted state so the caller can sync the foreground service.
  onStatus: (msg: HostingMsg) => void
}

function fmtMB (bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)
}

// Daily hosting budget: hosting costs the phone real bandwidth (mirroring content in and
// serving peers out), so the user can cap the metered bytes per day. At the cap, hosting
// pauses (drives stop announcing/mirroring, the hosted list is kept) and resumes on the
// next day — or immediately if the cap is raised.
export default function HostingSettings ({ visible, onClose, hosting, onStatus }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [status, setStatus] = useState<HostingMsg | null>(null)
  const [limitInput, setLimitInput] = useState('')

  useEffect(() => {
    if (!visible) return
    hosting('settings').then((r) => {
      if (!r.ok) return
      setStatus(r)
      setLimitInput(r.dailyLimitMB ? String(r.dailyLimitMB) : '')
      onStatus(r)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const save = async () => {
    const mb = Math.max(0, Math.floor(Number(limitInput) || 0)) // blank/invalid → 0 = unlimited
    const r = await hosting('settings', { dailyLimitMB: mb })
    if (r.ok) {
      setStatus(r)
      setLimitInput(r.dailyLimitMB ? String(r.dailyLimitMB) : '')
      onStatus(r)
    }
    onClose()
  }

  const count = status?.count ?? 0
  const usage = status?.usageBytes ?? 0
  const limit = status?.dailyLimitMB ?? 0

  return (
    <Modal visible={visible} transparent animationType='fade' onRequestClose={onClose}>
      <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.sheet} onPress={() => {}}>
          <Text style={s.title}>Hosting</Text>
          <Text style={s.line}>
            {count === 0 ? 'Not hosting any drives.' : count === 1 ? 'Hosting 1 drive.' : `Hosting ${count} drives.`}
          </Text>
          <Text style={s.line}>
            Used today: {fmtMB(usage)} MB{limit > 0 ? ` of ${limit} MB` : ''}
          </Text>
          {status?.paused ? (
            <Text style={[s.line, { color: t.danger }]}>
              Paused — today’s limit is used up. Hosting resumes tomorrow.
            </Text>
          ) : null}
          <Text style={s.label}>Daily limit (MB, empty = no limit)</Text>
          <TextInput
            style={s.input}
            value={limitInput}
            onChangeText={setLimitInput}
            keyboardType='number-pad'
            placeholder='No limit'
            placeholderTextColor={t.textMuted}
          />
          <View style={s.row}>
            <TouchableOpacity style={s.btn} onPress={onClose}>
              <Text style={s.btnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.btnPrimary]} onPress={save}>
              <Text style={[s.btnText, { color: '#fff' }]}>Save</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
    sheet: { backgroundColor: t.surface, borderRadius: radius.lg, padding: 20, gap: 8 },
    title: { color: t.text, fontSize: 18, fontWeight: '700', marginBottom: 4 },
    line: { color: t.textDim, fontSize: 14 },
    label: { color: t.textMuted, fontSize: 13, marginTop: 10 },
    input: {
      color: t.text,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 16
    },
    row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
    btn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: radius.md },
    btnPrimary: { backgroundColor: t.accent },
    btnText: { color: t.text, fontSize: 15, fontWeight: '600' }
  })
}
