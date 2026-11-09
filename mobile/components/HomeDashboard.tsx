import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme, radius, space, type Theme } from '../lib/theme'
import { formatTime } from '../lib/timeOfDay'
import type { AppName, AppsResult } from '../lib/useBackend'
import { ListSection, ListRow } from './List'
import Icon, { type IconName } from './Icon'

// The home tab as a dashboard, like desktop's nomad://desktop: notifications, what's coming up on the
// calendar, the Jobs that run next, and the newest Notes and files. The backend works it all out
// (RPC_APPS `home`/`dashboard`, rules in shared/home-dashboard.mjs); this draws it. A section with
// nothing in it isn't shown, and nothing is shown while this phone isn't linked.

export interface DashNotification { kind: 'job' | 'failed' | 'space' | 'message'; id: string; title: string; body: string; from?: string; at: string; jobId?: string; personaId?: string; with?: string }
export interface DashJob { id: string; title: string; at: string; when: string; deviceName: string; requested: boolean }
export interface DashEvent { id: string; title: string; day: string; dayLabel: string; allDay: boolean; start: string; end: string | null; ongoing: boolean; location: string; feed: string; color: string | null }
export interface DashNote { id: string; title: string; snippet: string; updatedAt: string }
export interface DashAsset { id: string; name: string; kind: string; icon: string; mime: string; thumb: boolean; addedAt: string; by: string }
export interface Dashboard {
  greeting: string
  notifications: DashNotification[]
  jobs: { running: { id: string; title: string; queued: boolean }[]; next: DashJob[]; total: number; paused: number }
  events: DashEvent[]
  notes: DashNote[]
  assets: DashAsset[]
  unreadMessages: number
}

type Apps = <T = unknown>(app: AppName, action: string, args?: Record<string, unknown>) => Promise<AppsResult<T>>

export interface HomeDashboardProps {
  apps: Apps
  onVaultChange: (listener: () => void) => () => void
  space?: string
  onGreeting?: (text: string | null) => void
  onOpenJob: (jobId?: string) => void
  onOpenMessages: (personaId?: string, other?: string) => void
  onOpenCalendar: (day?: string) => void
  onOpenNote: (id?: string) => void
  onOpenAsset: (id?: string) => void
}

const NOTIFY_ICONS: Record<DashNotification['kind'], IconName> = {
  job: 'robot',
  failed: 'exclamation-triangle',
  space: 'users',
  message: 'comment'
}

const pad = (n: number) => String(n).padStart(2, '0')
// This phone's wall time, 'YYYY-MM-DDTHH:MM': the backend can't tell the phone's zone.
const wallNow = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const DAY_MS = 24 * 60 * 60 * 1000
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const clock = (d: Date) => formatTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`)

// "just now", "5 min ago", "2 h ago", "Yesterday", "3 days ago", "12 Nov".
export function ago (iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, (now - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(new Date(t))) / DAY_MS)
  if (days < 1) return `${Math.floor(s / 3600)} h ago`
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  const d = new Date(t)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

// "now", "in 5 min", "in 2 h", "Tomorrow, 8:00 AM", "Wed, 8:00 AM", "12 Nov".
export function until (iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = (t - now) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `in ${Math.ceil(s / 60)} min`
  const d = new Date(t)
  const days = Math.round((startOfDay(d) - startOfDay(new Date(now))) / DAY_MS)
  if (days < 1) return s < 6 * 3600 ? `in ${Math.round(s / 3600)} h` : `Today, ${clock(d)}`
  if (days === 1) return `Tomorrow, ${clock(d)}`
  if (days < 7) return `${DAYS[d.getDay()]}, ${clock(d)}`
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export default function HomeDashboard ({ apps, onVaultChange, space: spaceKey, onGreeting, onOpenJob, onOpenMessages, onOpenCalendar, onOpenNote, onOpenAsset }: HomeDashboardProps) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [, setTick] = useState(0)
  const asked = useRef(new Set<string>())

  const load = useCallback(async () => {
    const res = await apps<Dashboard>('home', 'dashboard', { space: spaceKey, now: wallNow() })
    if (res.ok && res.value) setDash(res.value)
    else if (res.noVault) setDash(null)
  }, [apps, spaceKey])

  useEffect(() => { load() }, [load])
  useEffect(() => onGreeting?.(dash ? dash.greeting : null), [dash, onGreeting])
  // Another Device's change, a new Job run or a Message: load again, once for a burst.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = onVaultChange(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(load, 500)
    })
    return () => { off(); if (timer) clearTimeout(timer) }
  }, [onVaultChange, load])
  // Keep "in 5 min" true, and look again when the app comes back to the front.
  useEffect(() => {
    const every = setInterval(() => setTick((n) => n + 1), 60e3)
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') load() })
    return () => { clearInterval(every); sub.remove() }
  }, [load])

  // Thumbnails for the files shown, once each.
  useEffect(() => {
    for (const a of dash?.assets || []) {
      if (!a.thumb || asked.current.has(a.id)) continue
      asked.current.add(a.id)
      apps<string | null>('assets', 'read', { id: a.id, thumb: true, space: spaceKey }).then((res) => {
        if (res.ok && res.value) setThumbs((m) => ({ ...m, [a.id]: 'data:image/jpeg;base64,' + res.value }))
      }).catch(() => {})
    }
  }, [dash, apps, spaceKey])

  if (!dash) return null
  const { notifications, events, notes, assets } = dash
  const next = dash.jobs.next

  const openNotification = (n: DashNotification) => {
    if (n.kind === 'message') onOpenMessages(n.personaId, n.with)
    else if (n.kind === 'job' || n.kind === 'failed') onOpenJob(n.jobId)
  }

  let lastDay = ''
  return (
    <View style={s.wrap}>
      {notifications.length > 0 && (
        <ListSection
          title='Notifications'
          action={dash.unreadMessages ? { label: 'Messages', onPress: () => onOpenMessages() } : undefined}
        >
          {notifications.map((n, i) => (
            <ListRow
              key={n.id}
              divider={i > 0}
              left={<Lead icon={NOTIFY_ICONS[n.kind]} tone={n.kind} />}
              title={n.title}
              subtitle={(n.from ? `${n.from}: ` : '') + n.body}
              subtitleLines={2}
              right={<Text style={s.meta}>{ago(n.at)}</Text>}
              onPress={n.kind === 'space' ? undefined : () => openNotification(n)}
            />
          ))}
        </ListSection>
      )}

      {events.length > 0 && (
        <ListSection title='Coming up' action={{ label: 'Calendar', onPress: () => onOpenCalendar() }}>
          {events.map((e, i) => {
            const head = e.day !== lastDay ? e.dayLabel : null
            lastDay = e.day
            return (
              <View key={e.id + e.start}>
                {head ? <Text style={[s.day, i > 0 && s.dayDivider]}>{head}</Text> : null}
                <Pressable
                  onPress={() => onOpenCalendar(e.day)}
                  android_ripple={{ color: t.ripple }}
                  accessibilityRole='button'
                  accessibilityLabel={`${e.title}, ${e.dayLabel}, ${e.allDay ? 'all day' : formatTime(e.start.slice(11, 16))}`}
                  style={s.event}
                >
                  <Text style={[s.time, e.ongoing && !e.allDay && s.timeNow]}>
                    {e.allDay ? 'All day' : formatTime(e.start.slice(11, 16))}
                  </Text>
                  <View style={[s.bar, e.color ? { backgroundColor: e.color } : null]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.eventTitle} numberOfLines={1}>{e.title}</Text>
                    {e.location || e.feed || e.ongoing
                      ? <Text style={s.sub} numberOfLines={1}>{[e.ongoing && !e.allDay ? 'Now' : '', e.location, e.feed].filter(Boolean).join(' · ')}</Text>
                      : null}
                  </View>
                </Pressable>
              </View>
            )
          })}
        </ListSection>
      )}

      {next.length > 0 && (
        <ListSection title='AI Jobs up next' action={{ label: 'All Jobs', onPress: () => onOpenJob() }}>
          {next.map((j, i) => (
            <ListRow
              key={j.id}
              divider={i > 0}
              left={<Lead icon='clock' tone='job' />}
              title={j.title}
              subtitle={[j.when, j.deviceName && `on ${j.deviceName}`].filter(Boolean).join(' · ')}
              right={<Text style={s.meta}>{until(j.at)}</Text>}
              onPress={() => onOpenJob(j.id)}
            />
          ))}
        </ListSection>
      )}

      {notes.length > 0 && (
        <ListSection title='Latest notes' action={{ label: 'Notes', onPress: () => onOpenNote() }}>
          {notes.map((n, i) => (
            <ListRow
              key={n.id}
              divider={i > 0}
              title={n.title}
              subtitle={n.snippet || undefined}
              right={<Text style={s.meta}>{ago(n.updatedAt)}</Text>}
              onPress={() => onOpenNote(n.id)}
            />
          ))}
        </ListSection>
      )}

      {assets.length > 0 && (
        <ListSection title='Latest files' action={{ label: 'Assets', onPress: () => onOpenAsset() }}>
          <View style={s.files}>
            {assets.map((a) => (
              <Pressable
                key={a.id}
                style={s.file}
                onPress={() => onOpenAsset(a.id)}
                accessibilityRole='button'
                accessibilityLabel={a.name}
              >
                <View style={s.fileThumb}>
                  {thumbs[a.id]
                    ? <Image source={{ uri: thumbs[a.id] }} style={s.fileImg} />
                    : <Icon name={a.icon as IconName} size={20} color={t.textMuted} />}
                </View>
                <Text style={s.fileName} numberOfLines={1}>{a.name}</Text>
              </Pressable>
            ))}
          </View>
        </ListSection>
      )}
    </View>
  )
}

// A round tinted icon at the start of a row.
function Lead ({ icon, tone }: { icon: IconName; tone: DashNotification['kind'] }) {
  const t = useTheme()
  const color = tone === 'failed' ? t.danger : tone === 'space' ? t.secure : tone === 'message' ? '#d6336c' : t.accent
  return (
    <View style={{ width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color + '1f' }}>
      <Icon name={icon} size={13} color={color} />
    </View>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    wrap: { marginTop: 22 },
    meta: { color: t.textMuted, fontSize: 12 },
    day: { color: t.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: 2 },
    dayDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border, marginTop: space.xs },
    event: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.lg, paddingVertical: 6 },
    time: { width: 64, color: t.textDim, fontSize: 13, fontVariant: ['tabular-nums'] },
    timeNow: { color: t.accent, fontWeight: '700' },
    bar: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: t.accent, marginVertical: 4 },
    eventTitle: { color: t.text, fontSize: 15, fontWeight: '500' },
    sub: { color: t.textMuted, fontSize: 12, marginTop: 1 },
    files: { flexDirection: 'row', flexWrap: 'wrap', padding: space.sm },
    file: { width: '25%', padding: space.xs, alignItems: 'stretch' },
    fileThumb: { aspectRatio: 1, borderRadius: radius.sm, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    fileImg: { width: '100%', height: '100%' },
    fileName: { color: t.textDim, fontSize: 11, marginTop: 4, textAlign: 'center' }
  })
}
