import { useMemo, useState } from 'react'
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme, radius, type Theme } from '../lib/theme'
import type { LogEntry } from '../lib/types'

interface Props {
  visible: boolean
  onClose: () => void
  url: string
  logs: LogEntry[]
  source: string
  onClearLogs: () => void
  onViewSource: () => void
}

// A lightweight in-app inspector for the active tab: a live console (captured
// from the page) and a view-source pane. Full DevTools (elements/network) are
// available by enabling remote inspection — see the note in the Console tab.
export default function DevTools ({ visible, onClose, url, logs, source, onClearLogs, onViewSource }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [tab, setTab] = useState<'console' | 'source'>('console')

  const color = (level: string) => (level === 'error' ? t.danger : level === 'warn' ? t.secure : t.textDim)

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={onClose} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <View style={s.header}>
          <Text style={s.title}>Developer tools</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10} style={s.close}><Text style={s.closeText}>✕</Text></TouchableOpacity>
        </View>
        <Text numberOfLines={1} style={s.url}>{url || 'about:blank'}</Text>

        <View style={s.tabs}>
          <TabBtn label={`Console${logs.length ? ` (${logs.length})` : ''}`} active={tab === 'console'} onPress={() => setTab('console')} s={s} />
          <TabBtn label='Source' active={tab === 'source'} onPress={() => { setTab('source'); onViewSource() }} s={s} />
          {tab === 'console' && logs.length > 0 && (
            <TouchableOpacity style={s.clear} onPress={onClearLogs}><Text style={s.clearText}>Clear</Text></TouchableOpacity>
          )}
        </View>

        {tab === 'console' ? (
          <ScrollView style={s.body} contentContainerStyle={s.bodyPad}>
            {logs.length === 0 ? (
              <Text style={s.empty}>No console output yet. Logs and errors from the page appear here.{'\n\n'}For full DevTools (elements, network), enable remote inspection: connect the device and open chrome://inspect (Android) or Safari ▸ Develop (iOS).</Text>
            ) : (
              logs.map((l, i) => (
                <View key={i} style={s.logRow}>
                  <Text style={[s.logLevel, { color: color(l.level) }]}>{l.level}</Text>
                  <Text style={[s.logText, { color: color(l.level) }]}>{l.text}</Text>
                </View>
              ))
            )}
          </ScrollView>
        ) : (
          <ScrollView style={s.body} contentContainerStyle={s.bodyPad} horizontal={false}>
            <Text style={s.source}>{source || 'Loading source…'}</Text>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  )
}

function TabBtn ({ label, active, onPress, s }: { label: string; active: boolean; onPress: () => void; s: Styles }) {
  return (
    <TouchableOpacity style={[s.tab, active && s.tabActive]} onPress={onPress}>
      <Text style={[s.tabText, active && s.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  )
}

type Styles = ReturnType<typeof makeStyles>

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 48 },
    title: { color: t.text, fontSize: 18, fontWeight: '700' },
    close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    closeText: { color: t.textDim, fontSize: 18 },
    url: { color: t.textMuted, fontSize: 12, paddingHorizontal: 16, paddingBottom: 8, fontFamily: 'monospace' },
    tabs: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border, paddingBottom: 8 },
    tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.md },
    tabActive: { backgroundColor: t.trustBg },
    tabText: { color: t.textDim, fontSize: 13, fontWeight: '500' },
    tabTextActive: { color: t.trustText, fontWeight: '700' },
    clear: { marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 6 },
    clearText: { color: t.accent, fontSize: 13 },
    body: { flex: 1 },
    bodyPad: { padding: 14 },
    empty: { color: t.textMuted, fontSize: 13, lineHeight: 19 },
    logRow: { flexDirection: 'row', gap: 8, paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
    logLevel: { fontSize: 10, fontFamily: 'monospace', width: 38, textTransform: 'uppercase' },
    logText: { flex: 1, fontSize: 12, fontFamily: 'monospace' },
    source: { color: t.textDim, fontSize: 11, fontFamily: 'monospace', lineHeight: 16 }
  })
}
