import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, View, Text, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme, radius, type Theme } from '../lib/theme'
import type { Backend, Job, JobRun, JobsList } from '../lib/useBackend'
import { ListSection, ListRow, SwitchRow, ListEmpty } from './List'
import Icon from './Icon'
import KeyboardInset from './KeyboardInset'
import LinkPhone from './LinkPhone'
import Markdown from './Markdown'
import ScreenHeader from './ScreenHeader'
import SearchField from './SearchField'
import { queryWords, matchesWords } from '../lib/search'

interface Props {
  visible: boolean
  onClose: () => void
  apps: Backend['apps']
  onVaultChange: Backend['onVaultChange']
  // The Job, and the run in it, to open: the ones a tapped notification is about.
  openJobId?: string
  openRunId?: string
  onOpenDevices: () => void
}

// The phone's AI Jobs (ADR-0030): prompts a computer runs by itself, on a schedule or by hand. The
// list, then one Job with its history: each run's answer or error, when it ran and how long it took,
// searchable and clearable. The phone pauses, deletes, clears the history and asks for a run; the
// Job's computer runs it when it sees the request and the run notifies as usual. Jobs are made on the computer, in
// the AI Sidebar or My Library → Jobs, or by asking the AI panel here.
export default function Jobs ({ visible, onClose, apps, onVaultChange, openJobId, openRunId, onOpenDevices }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const appsRef = useRef(apps)
  appsRef.current = apps
  const call = useCallback(((app, action, args) => appsRef.current(app, action, args)) as Backend['apps'], [])
  const [list, setList] = useState<JobsList | null>(null)
  const [noVault, setNoVault] = useState(false)
  const [error, setError] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [runs, setRuns] = useState<JobRun[] | null>(null)
  const [openRun, setOpenRun] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The open Job's history: all runs or only the failed ones, and words to find in them.
  const [filter, setFilter] = useState<'all' | 'failed'>('all')
  const [query, setQuery] = useState('')
  // A Modal gets no keyboard events on Android and isn't resized (KeyboardInset): how far the
  // keyboard covers the page, so the history's last runs can still scroll into view.
  const [keyboard, setKeyboard] = useState(0)
  const insets = useSafeAreaInsets()

  const job = list?.jobs.find((j) => j.id === jobId) || null

  const loadRuns = useCallback(async (id: string) => {
    const res = await call<JobRun[]>('jobs', 'runs', { id })
    setRuns(res.ok && res.value ? res.value : [])
  }, [call])

  const refresh = useCallback(async () => {
    setError('')
    const res = await call<JobsList>('jobs', 'list')
    if (res.noVault) { setNoVault(true); setList(null); return }
    setNoVault(false)
    if (!res.ok || !res.value) { setError(res.message || 'Couldn’t load your Jobs'); return }
    setList(res.value)
  }, [call])

  // A notification opens its Job, with its run unfolded.
  useEffect(() => {
    if (!visible) return
    refresh()
    if (openJobId) {
      setFilter('all')
      setQuery('')
      setJobId(openJobId)
      setOpenRun(openRunId || null)
      setRuns(null)
      loadRuns(openJobId)
    }
  }, [visible, openJobId, openRunId, refresh, loadRuns])

  const jobIdRef = useRef(jobId)
  jobIdRef.current = jobId
  useEffect(() => {
    if (!visible) return
    return onVaultChange(() => {
      refresh()
      if (jobIdRef.current) loadRuns(jobIdRef.current)
    })
  }, [visible, onVaultChange, refresh, loadRuns])

  const openJob = (j: Job) => {
    setFilter('all')
    setQuery('')
    setJobId(j.id)
    setRuns(null)
    setOpenRun(j.lastRun?.id || null)
    loadRuns(j.id)
  }

  // Back steps out of a Job to the list first.
  const back = () => (jobId ? setJobId(null) : onClose())

  const act = async (action: string, args: Record<string, unknown>, failed: string) => {
    setBusy(true)
    const res = await call('jobs', action, args)
    setBusy(false)
    if (!res.ok) { Alert.alert(failed, res.message || 'Unknown error'); return false }
    await refresh()
    return true
  }

  const runNow = async (j: Job) => {
    if (await act('run', { id: j.id }, 'Couldn’t ask for a run')) {
      Alert.alert('Asked for a run', `${j.deviceName} runs “${j.title}” as soon as it sees this${j.notify === 'never' ? '.' : ', and notifies you when it’s done.'}`)
    }
  }

  const clearHistory = (j: Job) => {
    const n = runs?.length || 0
    Alert.alert('Clear this Job’s history?', `Its ${n} saved ${n === 1 ? 'run goes' : 'runs go'} from all your devices. “${j.title}” stays, and runs on as before.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          if (!(await act('clearRuns', { id: j.id }, 'Couldn’t clear it'))) return
          setFilter('all')
          setQuery('')
          setOpenRun(null)
          await loadRuns(j.id)
        }
      }
    ])
  }

  const remove = (j: Job) => {
    Alert.alert('Delete this Job?', `“${j.title}” and its saved runs go from all your devices.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { if (await act('delete', { id: j.id }, 'Couldn’t delete it')) setJobId(null) } }
    ])
  }

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={back} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <ScreenHeader
          title={job ? job.title : 'AI Jobs'}
          subtitle={job ? job.when : undefined}
          onBack={back}
          actions={list ? [{ icon: 'redo-alt', label: 'Refresh', onPress: () => { refresh(); if (jobId) loadRuns(jobId) }, busy }] : undefined}
        />

        {noVault ? (
          <LinkPhone what='Jobs' onOpenDevices={onOpenDevices} />
        ) : error ? (
          <View style={s.page}><Text style={s.errText}>{error}</Text></View>
        ) : !list ? (
          <View style={s.center}><ActivityIndicator color={t.accent} /></View>
        ) : job ? (
          <ScrollView contentContainerStyle={[s.page, keyboard > insets.bottom && { paddingBottom: 32 + keyboard - insets.bottom }]} keyboardShouldPersistTaps='handled'>
            {job.source && (
              <ListSection
                title='From a drive'
                footer={job.source.live
                  ? 'Your drive: each run uses its files as they are then.'
                  : `A copy of someone else’s drive${job.source.copiedAt ? `, made ${when(job.source.copiedAt)}` : ''}.${job.source.newer ? ' The drive has a newer version: take it in My Library → Jobs on your computer.' : ''}`}
              >
                <Text style={s.prompt} selectable>{job.source.url}</Text>
              </ListSection>
            )}
            {!!job.prompt && (
              <ListSection title={job.source ? 'More instructions' : 'Prompt'}>
                <Text style={s.prompt}>{job.prompt}</Text>
              </ListSection>
            )}
            {job.canChange?.length > 0 && (
              <ListSection title='Can change' footer='It changes these on its own when it runs. Change this in My Library → Jobs on your computer.'>
                <Text style={s.prompt}>{job.canChange.join('\n')}</Text>
              </ListSection>
            )}
            <ListSection footer={`Runs on ${job.deviceName}${job.notify === 'never' ? '. Doesn’t notify.' : job.notify === 'auto' ? '. Notifies when the AI finds something.' : '. Notifies this phone after each run.'}`}>
              <ListRow
                title={job.requested ? 'Run asked for' : 'Run now'}
                subtitle={job.requested ? `Waiting for ${job.deviceName}` : undefined}
                icon='play'
                accent={!job.requested}
                disabled={busy || job.requested || !list.writable}
                onPress={() => runNow(job)}
              />
              <SwitchRow
                title='On'
                subtitle={job.enabled ? (job.nextRunAt ? `Next ${when(job.nextRunAt)}` : 'Runs when you ask') : 'Paused on every device'}
                icon='clock'
                divider
                value={job.enabled}
                disabled={busy || !list.writable}
                onValueChange={(on) => act('setEnabled', { id: job.id, enabled: on }, 'Couldn’t change it')}
              />
              <ListRow title='Delete' icon='trash' destructive divider disabled={busy || !list.writable} onPress={() => remove(job)} />
            </ListSection>
            <History
              job={job}
              runs={runs}
              filter={filter}
              setFilter={setFilter}
              query={query}
              setQuery={setQuery}
              openRun={openRun}
              setOpenRun={setOpenRun}
              canClear={!busy && list.writable}
              onClear={() => clearHistory(job)}
              s={s}
              t={t}
            />
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={s.page}>
            {!list.writable && (
              <Text style={s.hint}>This phone can’t save changes to your Vault yet. Keep your other device online until it syncs.</Text>
            )}
            {list.jobs.length === 0 ? (
              <Text style={s.empty}>
                No AI Jobs yet. Ask the AI on your computer or here, like “every morning at 8, sum up my unread Reader posts and send it to my phone”.
              </Text>
            ) : (
              <ListSection footer='Your computer runs these while it’s awake. Make and edit them in My Library → Jobs on your computer.'>
                {list.jobs.map((j, i) => (
                  <ListRow
                    key={j.id}
                    title={j.title}
                    subtitle={summary(j)}
                    subtitleLines={j.lastRun?.status === 'error' ? 2 : 1}
                    icon={j.lastRun?.status === 'error' ? 'exclamation-circle' : 'clock'}
                    iconColor={j.lastRun?.status === 'error' ? t.danger : undefined}
                    chevron
                    divider={i > 0}
                    onPress={() => openJob(j)}
                  />
                ))}
              </ListSection>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
      <KeyboardInset onChange={setKeyboard} />
    </Modal>
  )
}

// The open Job's history: a count, search and an All / Failed switch over its runs, then the runs,
// newest first, each folded to one line until tapped. Clear deletes them on every device.
function History ({ job, runs, filter, setFilter, query, setQuery, openRun, setOpenRun, canClear, onClear, s, t }: {
  job: Job; runs: JobRun[] | null; filter: 'all' | 'failed'; setFilter: (f: 'all' | 'failed') => void
  query: string; setQuery: (q: string) => void; openRun: string | null; setOpenRun: (id: string | null) => void
  canClear: boolean; onClear: () => void; s: Styles; t: Theme
}) {
  const all = runs || []
  const failed = all.filter((r) => r.status === 'error').length
  const words = queryWords(query)
  const shown = all.filter((r) => (filter !== 'failed' || r.status === 'error') && (!words.length || matchesWords(r.searchText || '', words)))
  const cleared = job.cleared?.at ? `History cleared ${when(job.cleared.at)}.` : ''
  const footer = all.length
    ? `Keeps the last ${KEEP_HISTORY} runs, the newest ${KEEP_RUNS} with their whole answer.${cleared ? ' ' + cleared : ''}`
    : cleared || undefined
  return (
    <ListSection
      title={all.length ? `History · ${all.length} ${all.length === 1 ? 'run' : 'runs'}${failed ? `, ${failed} failed` : ''}` : 'History'}
      action={all.length && canClear ? { label: 'Clear', onPress: onClear } : undefined}
      footer={footer}
    >
      {runs === null ? (
        <View style={s.loading}><ActivityIndicator color={t.accent} /></View>
      ) : all.length === 0 ? (
        <ListEmpty text='No runs yet.' />
      ) : (
        <>
          {all.length > 1 && (
            <View style={s.historyTools}>
              <SearchField value={query} onChangeText={setQuery} placeholder='Search history' />
              <View style={s.chips}>
                <Chip label={`All ${all.length}`} active={filter === 'all'} onPress={() => setFilter('all')} s={s} />
                <Chip label={`Failed ${failed}`} active={filter === 'failed'} error={failed > 0} disabled={!failed} onPress={() => setFilter('failed')} s={s} />
              </View>
            </View>
          )}
          {shown.length === 0 ? (
            <View style={all.length > 1 ? s.divider : undefined}>
              <ListEmpty text={filter === 'failed' && !words.length ? 'No failed runs.' : 'No runs match.'} />
            </View>
          ) : shown.map((r, i) => (
            <RunRow key={r.id} r={r} jobDevice={job.deviceName} s={s} t={t} divider={i > 0 || all.length > 1} open={openRun === r.id} onToggle={() => setOpenRun(openRun === r.id ? null : r.id)} />
          ))}
        </>
      )}
    </ListSection>
  )
}

function Chip ({ label, active, error, disabled, onPress, s }: { label: string; active: boolean; error?: boolean; disabled?: boolean; onPress: () => void; s: Styles }) {
  return (
    <Pressable
      style={[s.chip, active && s.chipActive, disabled && s.chipDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole='button'
      accessibilityState={{ selected: active, disabled }}
    >
      <Text numberOfLines={1} style={[s.chipText, error && !active && s.chipTextErr, active && s.chipTextActive]}>{label}</Text>
    </Pressable>
  )
}

function RunRow ({ r, jobDevice, s, t, divider, open, onToggle }: { r: JobRun; jobDevice: string; s: Styles; t: Theme; divider: boolean; open: boolean; onToggle: () => void }) {
  const failed = r.status === 'error'
  return (
    <View style={divider ? s.divider : undefined}>
      <Pressable style={s.runHead} onPress={onToggle} android_ripple={{ color: t.ripple }} accessibilityRole='button' accessibilityState={{ expanded: open }}>
        <Icon name={failed ? 'exclamation-circle' : r.stopped ? 'stop-circle' : 'check-circle'} size={16} color={failed ? t.danger : r.stopped ? t.textMuted : t.secure} />
        <View style={s.runText}>
          <Text style={s.runTitle}>{new Date(r.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</Text>
          {open
            ? <Text style={s.runSub}>{howRun(r, jobDevice)}</Text>
            : <Text style={[s.runSub, failed && s.runErr]} numberOfLines={1}>{(failed ? r.error : r.preview) || howRun(r, jobDevice)}</Text>}
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color={t.textMuted} />
      </Pressable>
      {open && failed && (
        <View style={s.errorBox}>
          <Icon name='exclamation-triangle' size={13} color={t.danger} />
          <Text style={s.errorText} selectable>{r.error || 'The Job didn’t finish'}</Text>
        </View>
      )}
      {open && !!r.output && (
        <View style={s.output}>
          <Markdown text={r.output} />
        </View>
      )}
      {open && !r.output && !!r.summary && (
        <View style={s.output}>
          <Text style={s.trimmed} selectable>{r.summary}</Text>
          <Text style={s.runSub}>An older run: only the start of its answer is kept.</Text>
        </View>
      )}
      {open && !!r.changes?.length && (
        <View style={s.output}>
          <Text style={s.runTitle}>Changed</Text>
          {r.changes.map((c, i) => (
            <Text key={i} style={s.runSub} selectable>
              {'path' in c ? `${c.path}${c.draft ? ' (in a Draft)' : ''}` : c.summary || c.tool}
            </Text>
          ))}
        </View>
      )}
    </View>
  )
}

// How much history a Job keeps (shared/jobs.mjs KEEP_HISTORY, KEEP_RUNS).
const KEEP_HISTORY = 50
const KEEP_RUNS = 10

// How a run went: by hand or on schedule, how long it took, on which device (when not the Job's
// own), and whether it notified.
function howRun (r: JobRun, jobDevice: string) {
  const parts = [r.trigger === 'manual' ? 'Run by hand' : 'On schedule']
  if (r.stopped) parts.push('stopped')
  if (r.took) parts.push(`took ${r.took}`)
  if (r.deviceName && r.deviceName !== jobDevice) parts.push(`on ${r.deviceName}`)
  if (r.notification) parts.push('notified')
  return parts.join(' · ')
}

function summary (j: Job) {
  const parts = [j.enabled ? j.when : 'Paused']
  if (j.lastRun) parts.push(`${j.lastRun.status === 'error' ? 'failed' : j.lastRun.stopped ? 'stopped' : 'ran'} ${when(j.lastRun.finishedAt)}`)
  const line = parts.join(' · ')
  // The last error, so a failing Job says why without opening it.
  return j.lastRun?.status === 'error' && j.lastRun.error ? `${line}\n${j.lastRun.error}` : line
}

// "5 min ago", "in 2 h", "Mon 08:00".
function when (iso: string) {
  const at = new Date(iso)
  const min = Math.round((at.getTime() - Date.now()) / 60_000)
  const abs = Math.abs(min)
  if (abs < 1) return 'just now'
  const span = abs < 60 ? `${abs} min` : abs < 24 * 60 ? `${Math.round(abs / 60)} h` : null
  if (span) return min < 0 ? `${span} ago` : `in ${span}`
  return `${at.toLocaleDateString([], { weekday: 'short' })} ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

type Styles = ReturnType<typeof makeStyles>

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    page: { padding: 16, paddingBottom: 32 },
    hint: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 12 },
    errText: { color: t.danger, fontSize: 14, textAlign: 'center', marginTop: 30 },
    empty: { color: t.textMuted, fontSize: 13, textAlign: 'center', marginTop: 30, lineHeight: 19 },
    prompt: { color: t.text, fontSize: 14, lineHeight: 20, padding: 16 },
    loading: { padding: 16, alignItems: 'center' },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    runHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 56, paddingVertical: 10 },
    runText: { flex: 1 },
    runTitle: { color: t.text, fontSize: 14, fontWeight: '500' },
    runSub: { color: t.textDim, fontSize: 12, marginTop: 2, lineHeight: 17 },
    runErr: { color: t.danger },
    output: { paddingHorizontal: 16, paddingBottom: 14, borderRadius: radius.md },
    trimmed: { color: t.textDim, fontSize: 14, lineHeight: 20, marginBottom: 6 },
    errorBox: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: t.danger },
    errorText: { flex: 1, color: t.danger, fontSize: 13, lineHeight: 18 },
    historyTools: { padding: 12, gap: 10 },
    chips: { flexDirection: 'row', gap: 8 },
    chip: { height: 34, justifyContent: 'center', paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: t.border },
    chipActive: { backgroundColor: t.trustBg, borderColor: t.trustBg },
    chipDisabled: { opacity: 0.5 },
    chipText: { color: t.textDim, fontSize: 13, fontWeight: '500' },
    chipTextActive: { color: t.trustText, fontWeight: '700' },
    chipTextErr: { color: t.danger }
  })
}
