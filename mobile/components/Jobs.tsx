import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, View, Text, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme, radius, type Theme } from '../lib/theme'
import type { Backend, Job, JobRun, JobsList } from '../lib/useBackend'
import { ListSection, ListRow, SwitchRow, ListEmpty } from './List'
import Icon from './Icon'
import LinkPhone from './LinkPhone'
import Markdown from './Markdown'
import ScreenHeader from './ScreenHeader'

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
// list, then one Job with its runs. The phone pauses, deletes and asks for a run; the Job's computer
// runs it when it sees the request and the run notifies as usual. Jobs are made on the computer, in
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
          <ScrollView contentContainerStyle={s.page}>
            <ListSection title='Prompt'>
              <Text style={s.prompt}>{job.prompt}</Text>
            </ListSection>
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
            <ListSection title='Runs'>
              {runs === null ? (
                <View style={s.loading}><ActivityIndicator color={t.accent} /></View>
              ) : runs.length === 0 ? (
                <ListEmpty text='No runs yet.' />
              ) : runs.map((r, i) => (
                <RunRow key={r.id} r={r} s={s} t={t} divider={i > 0} open={openRun === r.id} onToggle={() => setOpenRun(openRun === r.id ? null : r.id)} />
              ))}
            </ListSection>
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
    </Modal>
  )
}

function RunRow ({ r, s, t, divider, open, onToggle }: { r: JobRun; s: Styles; t: Theme; divider: boolean; open: boolean; onToggle: () => void }) {
  const failed = r.status === 'error'
  return (
    <View style={divider ? s.divider : undefined}>
      <Pressable style={s.runHead} onPress={onToggle} android_ripple={{ color: t.ripple }} accessibilityRole='button' accessibilityState={{ expanded: open }}>
        <Icon name={failed ? 'exclamation-circle' : 'check-circle'} size={16} color={failed ? t.danger : t.secure} />
        <View style={s.runText}>
          <Text style={s.runTitle}>{new Date(r.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</Text>
          <Text style={s.runSub} numberOfLines={open ? undefined : 1}>
            {failed ? r.error : open || !r.notification ? howRun(r) : r.notification.body}
          </Text>
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color={t.textMuted} />
      </Pressable>
      {open && !!r.output && (
        <View style={s.output}>
          <Markdown text={r.output} />
        </View>
      )}
    </View>
  )
}

function howRun (r: JobRun) {
  return `${r.trigger === 'manual' ? 'Run by hand' : 'On schedule'}${r.notification ? ' · notified' : ''}`
}

function summary (j: Job) {
  const parts = [j.enabled ? j.when : 'Paused']
  if (j.lastRun) parts.push(`${j.lastRun.status === 'error' ? 'failed' : 'ran'} ${when(j.lastRun.finishedAt)}`)
  return parts.join(' · ')
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
    output: { paddingHorizontal: 16, paddingBottom: 14, borderRadius: radius.md }
  })
}
