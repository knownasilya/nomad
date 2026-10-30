import { useMemo, useState } from 'react'
import { Modal, View, Text, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import ScreenHeader from './ScreenHeader'
import Tabs from './Tabs'
import { useTheme, type Theme } from '../lib/theme'
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

  const color = (level: string) => (level === 'error' ? t.danger : level === 'warn' ? t.warn : t.textDim)

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={onClose} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <ScreenHeader
          title='Developer tools'
          subtitle={url || 'about:blank'}
          onBack={onClose}
          actions={tab === 'console' && logs.length > 0 ? [{ icon: 'broom', label: 'Clear console', onPress: onClearLogs }] : undefined}
        />

        <Tabs
          tabs={[{ key: 'console' as const, label: `Console${logs.length ? ` (${logs.length})` : ''}` }, { key: 'source' as const, label: 'Source' }]}
          value={tab}
          onChange={(k) => { setTab(k); if (k === 'source') onViewSource() }}
        />

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

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    body: { flex: 1 },
    bodyPad: { padding: 14 },
    empty: { color: t.textMuted, fontSize: 13, lineHeight: 19 },
    logRow: { flexDirection: 'row', gap: 8, paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
    logLevel: { fontSize: 10, fontFamily: 'monospace', width: 38, textTransform: 'uppercase' },
    logText: { flex: 1, fontSize: 12, fontFamily: 'monospace' },
    source: { color: t.textDim, fontSize: 11, fontFamily: 'monospace', lineHeight: 16 }
  })
}
