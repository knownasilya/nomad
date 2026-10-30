import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Modal, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import ScreenHeader from './ScreenHeader'
import Tabs from './Tabs'
import { radius, useTheme, type Theme } from '../lib/theme'
import { appLogsSince, type LogEntry } from '../lib/log'
import type { LogsMsg } from '../lib/useBackend'

interface Props {
  visible: boolean
  onClose: () => void
  logs: (since?: number, previous?: boolean) => Promise<LogsMsg>
}

type Source = 'app' | 'backend'
interface Row extends LogEntry { source: Source; key: string }
type Session = 'current' | 'previous'
type LevelFilter = 'all' | 'warn' | 'error'

const POLL_MS = 1500
const MAX_ROWS = 2000
const LEVEL_FILTERS: { key: LevelFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'warn', label: 'Warnings' },
  { key: 'error', label: 'Errors' }
]
const SOURCE_FILTERS: { key: 'all' | Source; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'backend', label: 'Backend' },
  { key: 'app', label: 'App' }
]

const rowsOf = (entries: LogEntry[], source: Source): Row[] =>
  entries.map((e) => ({ ...e, source, key: `${source}:${e.id}:${e.t}` }))

function keep (level: string, filter: LevelFilter) {
  if (filter === 'error') return level === 'error'
  if (filter === 'warn') return level === 'error' || level === 'warn'
  return true
}

function clock (t: number) {
  const d = new Date(t)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

// The phone's General Logs, like desktop's Settings → General Logs: the app's and the backend's
// console lines, newest first, streaming while open. "Last session" reads the backend's log from
// the previous run, which is where a crash's last lines end up.
export default function Logs ({ visible, onClose, logs }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [session, setSession] = useState<Session>('current')
  const [level, setLevel] = useState<LevelFilter>('all')
  const [source, setSource] = useState<'all' | Source>('all')
  const [paused, setPaused] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [previous, setPrevious] = useState<Row[] | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const cursor = useRef({ app: 0, backend: 0 })
  // The backend's calls are new functions on every render, so read the latest through a ref.
  const logsRef = useRef(logs)
  logsRef.current = logs

  const poll = useCallback(async () => {
    const app = appLogsSince(cursor.current.app)
    const res = await logsRef.current(cursor.current.backend)
    const backend = res.ok ? res.entries : []
    setError(res.ok ? '' : res.message || 'Couldn’t read the backend’s log')
    if (app.length) cursor.current.app = app[app.length - 1].id
    if (backend.length) cursor.current.backend = backend[backend.length - 1].id
    if (!app.length && !backend.length) return
    const added = [...rowsOf(app, 'app'), ...rowsOf(backend, 'backend')].sort((a, b) => b.t - a.t)
    setRows((prev) => [...added, ...prev].slice(0, MAX_ROWS))
  }, [])

  // Stream this session's lines while the page is open and not paused.
  useEffect(() => {
    if (!visible || session !== 'current' || paused) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      try { await poll() } catch {}
      if (!stopped) timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [visible, session, paused, poll])

  // The previous session is read once per open.
  useEffect(() => {
    if (!visible) { setPrevious(null); return }
    if (session !== 'previous' || previous) return
    logsRef.current(Number.MAX_SAFE_INTEGER, true).then((res) => {
      setPrevious(rowsOf(res.previous || [], 'backend').reverse())
      if (!res.ok) setError(res.message || 'Couldn’t read the last session’s log')
    }).catch(() => setPrevious([]))
  }, [visible, session, previous])

  const shown = useMemo(() => {
    const list = session === 'current' ? rows : previous || []
    return list.filter((r) => keep(r.level, level) && (source === 'all' || r.source === source))
  }, [session, rows, previous, level, source])

  const share = () => {
    const text = [...shown].reverse()
      .map((r) => `${new Date(r.t).toISOString()} ${r.level.toUpperCase()} [${r.source}] ${r.msg}`)
      .join('\n')
    Share.share({ message: text.length > 200000 ? text.slice(text.length - 200000) : text || 'No log lines.' }).catch(() => {})
  }

  const clear = () => {
    setRows([])
    setExpanded({})
  }

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={onClose} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <ScreenHeader
          title='Logs'
          onBack={onClose}
          actions={[
            ...(session === 'current'
              ? [
                  { icon: paused ? 'play' : 'pause', label: paused ? 'Resume' : 'Pause', onPress: () => setPaused((p) => !p) } as const,
                  { icon: 'broom', label: 'Clear', onPress: clear } as const
                ]
              : []),
            { icon: 'share-alt', label: 'Share', onPress: share }
          ]}
        />

        <Tabs
          tabs={[{ key: 'current' as Session, label: 'This session' }, { key: 'previous' as Session, label: 'Last session' }]}
          value={session}
          onChange={setSession}
        />

        <View style={s.controls}>
          <View style={s.chipRow}>
            {LEVEL_FILTERS.map((f) => (
              <TouchableOpacity key={f.key} style={[s.chip, level === f.key && s.chipActive]} onPress={() => setLevel(f.key)}>
                <Text style={[s.chipText, level === f.key && s.chipTextActive]}>{f.label}</Text>
              </TouchableOpacity>
            ))}
            <View style={s.divider} />
            {SOURCE_FILTERS.map((f) => (
              <TouchableOpacity key={f.key} style={[s.chip, source === f.key && s.chipActive]} onPress={() => setSource(f.key)}>
                <Text style={[s.chipText, source === f.key && s.chipTextActive]}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.actions}>
            <Text style={s.status}>
              {session === 'previous'
                ? (previous ? `${shown.length} lines from the last run` : 'Loading…')
                : paused ? `Paused · ${shown.length} lines` : `Streaming · ${shown.length} lines`}
            </Text>
          </View>
          {error ? <Text style={s.error}>{error}</Text> : null}
        </View>

        <FlatList
          data={shown}
          keyExtractor={(r) => r.key}
          contentContainerStyle={s.list}
          initialNumToRender={40}
          ListEmptyComponent={
            <Text style={s.empty}>
              {session === 'previous'
                ? 'Nothing saved from the last run.'
                : 'No log lines yet.'}
            </Text>
          }
          renderItem={({ item, index }) => {
            const open = !!expanded[item.key]
            return (
              <TouchableOpacity
                activeOpacity={0.7}
                style={[s.row, index > 0 && s.rowDivider]}
                onPress={() => setExpanded((e) => ({ ...e, [item.key]: !open }))}
              >
                <View style={s.rowHead}>
                  <Text style={s.time}>{clock(item.t)}</Text>
                  <Text style={[s.level, item.level === 'error' && s.levelError, item.level === 'warn' && s.levelWarn]}>{item.level}</Text>
                  <Text style={s.source}>{item.source}</Text>
                </View>
                <Text style={[s.msg, item.level === 'error' && s.msgError]} numberOfLines={open ? undefined : 4} selectable={open}>
                  {item.msg}
                </Text>
              </TouchableOpacity>
            )
          }}
        />
      </SafeAreaView>
    </Modal>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    controls: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 10 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    chip: { height: 32, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface },
    chipActive: { backgroundColor: t.trustBg, borderColor: t.trustBg },
    chipText: { color: t.textDim, fontSize: 12, fontWeight: '500' },
    chipTextActive: { color: t.trustText, fontWeight: '700' },
    divider: { width: StyleSheet.hairlineWidth, height: 18, backgroundColor: t.border, marginHorizontal: 2 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    status: { flex: 1, color: t.textMuted, fontSize: 12 },
    error: { color: t.danger, fontSize: 12 },
    list: { marginHorizontal: 16, marginBottom: 16, backgroundColor: t.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, overflow: 'hidden' },
    row: { paddingHorizontal: 12, paddingVertical: 8 },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
    time: { color: t.textMuted, fontSize: 11, fontFamily: 'monospace' },
    level: { color: t.textDim, fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', fontWeight: '700' },
    levelError: { color: t.danger },
    levelWarn: { color: t.warn },
    source: { color: t.textMuted, fontSize: 10, fontFamily: 'monospace' },
    msg: { color: t.text, fontSize: 12, lineHeight: 17, fontFamily: 'monospace' },
    msgError: { color: t.danger },
    empty: { color: t.textMuted, fontSize: 13, textAlign: 'center', padding: 30, lineHeight: 19 }
  })
}
