import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Modal, View, Text, TextInput, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme, radius, space, type Theme } from '../lib/theme'
import type { Backend, CalendarDrive, CalendarEvent, CalendarFeed, CalendarList, CalendarOccurrence, CalendarRepeat } from '../lib/useBackend'
import { ListSection, ListRow, SwitchRow, ListEmpty } from './List'
import ActionSheet from './ActionSheet'
import BottomSheet from './BottomSheet'
import IconButton from './IconButton'
import LinkPhone from './LinkPhone'
import ScreenHeader from './ScreenHeader'
import { TimeField, TimePicker } from './TimePicker'
import { formatTime, isTime, minutesOf, shiftEnd, timeFrom } from '../lib/timeOfDay'

interface Props {
  visible: boolean
  onClose: () => void
  apps: Backend['apps']
  onVaultChange: Backend['onVaultChange']
  space?: string // the active Space's Root Drive key: a Space keeps a calendar of its own (ADR-0042)
  spaceName?: string
  openDay?: string // YYYY-MM-DD, e.g. from a link in an AI answer
  onOpenDevices: () => void
  drives?: string[] // the Space's drives (hyper:// roots): the Follow sheet offers the calendar drives among them
  onOpenUrl?: (url: string) => void // open a calendar drive in a tab
}

// The phone's calendar (ADR-0042), the same records as desktop's nomad://calendar: a month to pick a
// day, that day's events, the two weeks after it, and the iCal feeds this calendar follows. In a
// shared Space, its events are the household's: everyone who can edit adds and changes them, and
// each says who added it. Feed events are read-only. A feed's file is fetched here when its copy is
// old and nobody else has (calendar/feedFetched); usually a computer has. A calendar drive
// (walled.garden/calendar) is followed the same way; the backend reads it (calendar/fetchDrive).

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const FREQS: { key: CalendarRepeat['freq'] | 'none'; label: string }[] = [
  { key: 'none', label: 'Once' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' }
]
const FETCH_TIMEOUT = 20e3
const MAX_BYTES = 5 * 1024 * 1024

const pad = (n: number) => String(n).padStart(2, '0')
const dayString = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = () => dayString(new Date())
// Days as UTC dates, so adding one never meets a clock change.
const asDate = (day: string) => new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)))
const fromDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
const addDays = (day: string, n: number) => { const d = asDate(day); d.setUTCDate(d.getUTCDate() + n); return fromDate(d) }
const weekday = (day: string) => asDate(day).getUTCDay()
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && fromDate(asDate(s)) === s
const dayLabel = (day: string) => `${DAY_NAMES[weekday(day)]} ${+day.slice(8, 10)} ${MONTHS[+day.slice(5, 7) - 1].slice(0, 3)}`
// The first day of the six weeks that show `month` ('YYYY-MM'), from a Sunday.
const gridStart = (month: string) => { const first = month + '-01'; return addDays(first, -weekday(first)) }

// What a row says about when: "All day", "9:30 AM", "6:00 PM to 7:30 PM".
function timeOf (o: { start: string; end?: string; allDay: boolean }, day: string) {
  if (o.allDay) return 'All day'
  const start = o.start.slice(0, 10) === day ? formatTime(o.start.slice(11, 16)) : 'Until'
  const end = o.end && o.end.slice(0, 10) === day ? formatTime(o.end.slice(11, 16)) : ''
  return start === 'Until' ? (end ? `Until ${end}` : 'All day') : end ? `${start} to ${end}` : start
}

// The last day an occurrence covers: a timed one that ends at midnight ends the day before.
function lastDay (o: { start: string; end?: string; allDay: boolean }) {
  const start = o.start.slice(0, 10)
  if (!o.end) return start
  const end = o.end.slice(0, 10)
  return !o.allDay && end > start && o.end.slice(11, 16) === '00:00' ? addDays(end, -1) : end
}

// Whether an occurrence is on `day` (it may have started before and run through it).
const onDay = (o: CalendarOccurrence, day: string) => o.start.slice(0, 10) <= day && lastDay(o) >= day

interface Draft {
  id: string | null
  title: string
  day: string
  endDay: string
  allDay: boolean
  startTime: string
  endTime: string
  freq: CalendarRepeat['freq'] | 'none'
  interval: string
  until: string
  location: string
  notes: string
  inSpace: boolean
}

export default function Calendar ({ visible, onClose, apps, onVaultChange, space, spaceName, openDay, onOpenDevices, drives, onOpenUrl }: Props) {
  const t = useTheme()
  const s = useMemo(() => makeStyles(t), [t])
  const appsRef = useRef(apps)
  appsRef.current = apps
  const call = useCallback(((app, action, args = {}) => appsRef.current(app, action, { space, ...args })) as Backend['apps'], [space])
  const [selected, setSelected] = useState(today())
  const [month, setMonth] = useState(today().slice(0, 7))
  const [list, setList] = useState<CalendarList | null>(null)
  const [noVault, setNoVault] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftError, setDraftError] = useState('')
  const [picking, setPicking] = useState<'start' | 'end' | null>(null) // the time picker open in the editor
  const [feedSheet, setFeedSheet] = useState(false)
  const [feedUrl, setFeedUrl] = useState('')
  const [feedInSpace, setFeedInSpace] = useState(true)
  const [feedMenu, setFeedMenu] = useState<CalendarFeed | null>(null)
  // The Space's calendar drives the calendar could follow, looked for when the Follow sheet opens.
  const [calDrives, setCalDrives] = useState<CalendarDrive[]>([])
  const [readOnly, setReadOnly] = useState<CalendarOccurrence | null>(null)
  const fetching = useRef(new Set<string>())

  // The six weeks on screen, and the two weeks after the selected day.
  const range = useMemo(() => {
    const from = gridStart(month)
    const to = addDays(from, 42)
    const after = addDays(selected, 15)
    return { from: selected < from ? selected : from, to: after > to ? after : to }
  }, [month, selected])

  const refresh = useCallback(async () => {
    const res = await call<CalendarList>('calendar', 'list', range)
    if (res.noVault) { setNoVault(true); setList(null); return }
    setNoVault(false)
    if (!res.ok || !res.value) { setError(res.message || 'Couldn’t load the calendar'); return }
    setError('')
    setList(res.value)
  }, [call, range])

  // Fetch the feeds whose copy is old, one at a time, and keep what each gave.
  const fetchDue = useCallback(async (feeds: CalendarFeed[], force = false) => {
    let changed = false
    for (const f of feeds) {
      if ((!f.due && !force) || fetching.current.has(f.id)) continue
      fetching.current.add(f.id)
      if (f.kind === 'drive') {
        // A calendar drive: the backend reads it and keeps the copy.
        await call('calendar', 'fetchDrive', { id: f.id })
        fetching.current.delete(f.id)
        changed = true
        continue
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
      let text = ''
      let error = ''
      try {
        const res = await fetch(f.url, { signal: controller.signal, headers: { Accept: 'text/calendar, text/plain;q=0.5, */*;q=0.1' }, credentials: 'omit' })
        if (!res.ok) throw new Error(`The feed answered ${res.status}`)
        text = (await res.text()).slice(0, MAX_BYTES)
      } catch (err) {
        error = controller.signal.aborted ? 'The feed took too long to answer' : (err as Error)?.message || String(err)
      } finally {
        clearTimeout(timer)
      }
      await call('calendar', 'feedFetched', { id: f.id, text, error })
      fetching.current.delete(f.id)
      changed = true
    }
    if (changed) refresh()
  }, [call, refresh])

  useEffect(() => {
    if (!visible) return
    if (openDay && isDay(openDay)) { setSelected(openDay); setMonth(openDay.slice(0, 7)) }
  }, [visible, openDay])

  useEffect(() => { if (visible) refresh() }, [visible, refresh])
  useEffect(() => { if (visible) return onVaultChange(refresh) }, [visible, onVaultChange, refresh])
  const listFeeds = list?.feeds
  useEffect(() => { if (visible && listFeeds?.some((f) => f.due)) fetchDue(listFeeds) }, [visible, listFeeds, fetchDue])

  const canWriteSpace = !!list?.canWriteSpace && !!space
  const shared = !!list?.shared
  const placeName = spaceName || 'this Space'

  const occurrences = list?.occurrences || []
  const busyDays = useMemo(() => {
    const out = new Set<string>()
    for (const o of occurrences) {
      const end = lastDay(o)
      for (let d = o.start.slice(0, 10), n = 0; d <= end && n < 42; d = addDays(d, 1), n++) out.add(d)
    }
    return out
  }, [occurrences])
  const ofDay = occurrences.filter((o) => onDay(o, selected))
  const upcoming = useMemo(() => {
    const days: { day: string; items: CalendarOccurrence[] }[] = []
    for (let i = 1; i <= 14; i++) {
      const day = addDays(selected, i)
      const items = occurrences.filter((o) => o.start.slice(0, 10) === day)
      if (items.length) days.push({ day, items })
    }
    return days
  }, [occurrences, selected])

  const goMonth = (n: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 + n, 1))
    setMonth(fromDate(d).slice(0, 7))
  }
  const goToday = () => { setSelected(today()); setMonth(today().slice(0, 7)) }

  // The editor: a new event on the selected day, or one of the user's or the Space's.
  const newEvent = () => {
    setDraftError('')
    setPicking(null)
    setDraft({ id: null, title: '', day: selected, endDay: selected, allDay: false, startTime: '09:00', endTime: '10:00', freq: 'none', interval: '1', until: '', location: '', notes: '', inSpace: canWriteSpace })
  }
  // A new start time moves the end with it, so the event keeps its length.
  const setStartTime = (startTime: string) => {
    if (!draft) return
    const days = isDay(draft.day) && isDay(draft.endDay)
    const end = days ? shiftEnd({ startDay: draft.day, startTime: draft.startTime, endDay: draft.endDay, endTime: draft.endTime }, draft.day, startTime) : null
    setDraft({ ...draft, startTime, ...(end || {}) })
  }
  // "1 h" in the end time's picker: the end is that long after the start, maybe the next day.
  const setLength = (minutes: number) => {
    if (!draft || !isTime(draft.startTime)) return
    const end = minutesOf(draft.startTime) + minutes
    setDraft({ ...draft, endTime: timeFrom(end), endDay: end >= 24 * 60 && isDay(draft.day) ? addDays(draft.day, 1) : draft.day })
  }
  const editEvent = (ev: CalendarEvent) => {
    setDraftError('')
    setPicking(null)
    const allDay = !!ev.allDay
    setDraft({
      id: ev.id,
      title: ev.title,
      day: ev.start.slice(0, 10),
      endDay: (ev.end || ev.start).slice(0, 10),
      allDay,
      startTime: allDay ? '09:00' : ev.start.slice(11, 16),
      endTime: allDay || !ev.end ? '' : ev.end.slice(11, 16),
      freq: ev.repeat?.freq || 'none',
      interval: String(ev.repeat?.interval || 1),
      until: ev.repeat?.until || '',
      location: ev.location || '',
      notes: ev.notes || '',
      inSpace: !!ev.space
    })
  }
  const openOccurrence = (o: CalendarOccurrence) => {
    if (o.feed) { setReadOnly(o); return }
    const ev = list?.events.find((e) => e.id === o.id)
    if (!ev) return
    if (ev.space && !canWriteSpace) { setReadOnly(o); return }
    editEvent(ev)
  }

  const save = async () => {
    if (!draft) return
    const d = draft
    if (!d.title.trim()) { setDraftError('Give it a title'); return }
    if (!isDay(d.day)) { setDraftError('The day is YYYY-MM-DD, like 2026-11-10'); return }
    if (d.endDay && !isDay(d.endDay)) { setDraftError('The end day is YYYY-MM-DD'); return }
    if (!d.allDay && !isTime(d.startTime)) { setDraftError('Pick a start time'); return }
    if (!d.allDay && d.endTime && !isTime(d.endTime)) { setDraftError('Pick an end time, or No end time'); return }
    if (d.until && !isDay(d.until)) { setDraftError('“Until” is a day, YYYY-MM-DD'); return }
    const start = d.allDay ? d.day : `${d.day}T${d.startTime}`
    const endDay = d.endDay || d.day
    const end = d.allDay ? (endDay > d.day ? endDay : undefined) : d.endTime ? `${endDay}T${d.endTime}` : undefined
    const repeat = d.freq === 'none'
      ? null
      : { freq: d.freq, interval: Math.max(1, Math.floor(Number(d.interval) || 1)), ...(d.until ? { until: d.until } : {}), ...(d.freq === 'weekly' ? { byDay: [weekday(d.day)] } : {}) }
    // A weekly event made on desktop can repeat on several days: keep them.
    const prev = d.id ? list?.events.find((e) => e.id === d.id) : null
    if (repeat && d.freq === 'weekly' && prev?.repeat?.freq === 'weekly' && prev.repeat.byDay?.length) (repeat as CalendarRepeat).byDay = prev.repeat.byDay
    const event = { id: d.id || undefined, title: d.title.trim(), start, end, allDay: d.allDay, location: d.location.trim(), notes: d.notes.trim(), repeat, inSpace: d.inSpace }
    setBusy(true)
    const res = await call<CalendarEvent>('calendar', 'save', { event })
    setBusy(false)
    if (!res.ok) { setDraftError(res.message || 'Couldn’t save it'); return }
    setDraft(null)
    setSelected(d.day)
    setMonth(d.day.slice(0, 7))
    refresh()
  }

  const remove = () => {
    if (!draft?.id) return
    const id = draft.id
    Alert.alert('Delete this event?', `“${draft.title}” goes from ${draft.inSpace && shared ? `${placeName}’s calendar, for everyone in it` : 'your calendar on all your devices'}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const res = await call('calendar', 'delete', { id })
          if (!res.ok) { Alert.alert('Couldn’t delete it', res.message || 'Unknown error'); return }
          setDraft(null)
          refresh()
        }
      }
    ])
  }

  const drivesKey = (drives || []).join(' ')
  useEffect(() => {
    if (!feedSheet || !drivesKey) { setCalDrives([]); return }
    let cancelled = false
    call<CalendarDrive[]>('calendar', 'drives', { urls: drivesKey.split(' ') }).then((res) => {
      if (!cancelled && res.ok && Array.isArray(res.value)) setCalDrives(res.value)
    })
    return () => { cancelled = true }
  }, [feedSheet, drivesKey, call])

  // Follow an iCal link or a calendar drive.
  const follow = async (link = feedUrl.trim()) => {
    const url = link.trim()
    if (!url) return
    setBusy(true)
    const res = await call<CalendarFeed>('calendar', 'saveFeed', { feed: { url, inSpace: feedInSpace && canWriteSpace } })
    setBusy(false)
    if (!res.ok || !res.value) { Alert.alert('Couldn’t follow it', res.message || 'Unknown error'); return }
    setFeedSheet(false)
    setFeedUrl('')
    const feed = res.value as CalendarFeed
    // A drive's copy was kept as it was followed.
    if (feed.kind === 'drive') refresh()
    else await fetchDue([{ ...feed, due: true }], true)
  }

  const unfollow = (f: CalendarFeed) => {
    Alert.alert('Stop following this calendar?', `${f.name}’s events go from ${f.space && shared ? `${placeName}’s calendar, for everyone in it` : 'your calendar'}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop following',
        style: 'destructive',
        onPress: async () => {
          const res = await call('calendar', 'deleteFeed', { id: f.id })
          if (!res.ok) { Alert.alert('Couldn’t remove it', res.message || 'Unknown error'); return }
          refresh()
        }
      }
    ])
  }

  const back = () => (draft ? setDraft(null) : onClose())
  const writable = !!list?.writable

  const row = (o: CalendarOccurrence, day: string, i: number) => (
    <ListRow
      key={o.id + o.start}
      title={o.title}
      subtitle={[timeOf(o, day), o.location, o.feed ? o.feed.name : o.by ? `Added by ${o.by}` : ''].filter(Boolean).join(' · ')}
      icon={o.feed ? 'calendar-alt' : o.repeats ? 'redo-alt' : 'calendar-day'}
      iconColor={o.feed ? t.textMuted : t.accent}
      divider={i > 0}
      chevron={!o.feed}
      onPress={() => openOccurrence(o)}
    />
  )

  const start = gridStart(month)
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)))
  const now = today()

  return (
    <Modal visible={visible} animationType='slide' onRequestClose={back} presentationStyle='fullScreen'>
      <SafeAreaView style={s.root} edges={['top', 'bottom']}>
        <ScreenHeader
          title='Calendar'
          subtitle={space ? (shared ? `${placeName}, shared` : placeName) : undefined}
          onBack={back}
          actions={list ? [
            { icon: 'calendar-day', label: 'Today', onPress: goToday },
            { icon: 'plus', label: 'New event', onPress: newEvent, disabled: !writable }
          ] : undefined}
        />

        {noVault ? (
          <LinkPhone what='Calendar' onOpenDevices={onOpenDevices} />
        ) : error ? (
          <View style={s.page}><Text style={s.errText}>{error}</Text></View>
        ) : !list ? (
          <View style={s.center}><ActivityIndicator color={t.accent} /></View>
        ) : (
          <ScrollView contentContainerStyle={s.page}>
            <View style={s.monthBar}>
              <IconButton icon='chevron-left' label='Previous month' onPress={() => goMonth(-1)} size={16} />
              <Text style={s.monthTitle} accessibilityRole='header'>{MONTHS[+month.slice(5, 7) - 1]} {month.slice(0, 4)}</Text>
              <IconButton icon='chevron-right' label='Next month' onPress={() => goMonth(1)} size={16} />
            </View>
            <View style={s.grid}>
              <View style={s.week}>
                {DAY_NAMES.map((n) => <Text key={n} style={s.weekday}>{n.slice(0, 1)}</Text>)}
              </View>
              {weeks.map((week) => (
                <View key={week[0]} style={s.week}>
                  {week.map((day) => {
                    const isSel = day === selected
                    const other = day.slice(0, 7) !== month
                    return (
                      <Pressable
                        key={day}
                        style={s.cell}
                        onPress={() => { setSelected(day); if (other) setMonth(day.slice(0, 7)) }}
                        accessibilityRole='button'
                        accessibilityLabel={`${dayLabel(day)}${busyDays.has(day) ? ', has events' : ''}`}
                        accessibilityState={{ selected: isSel }}
                      >
                        <View style={[s.num, day === now && s.numToday, isSel && s.numSel]}>
                          <Text style={[s.numText, other && s.numOther, day === now && s.numTodayText, isSel && s.numSelText]}>{+day.slice(8, 10)}</Text>
                        </View>
                        <View style={[s.dot, busyDays.has(day) && s.dotOn]} />
                      </Pressable>
                    )
                  })}
                </View>
              ))}
            </View>

            <ListSection title={selected === now ? `Today, ${dayLabel(selected)}` : dayLabel(selected)} action={writable ? { label: 'Add', onPress: newEvent } : undefined}>
              {ofDay.length ? ofDay.map((o, i) => row(o, selected, i)) : <ListEmpty text='Nothing on this day.' />}
            </ListSection>

            {upcoming.length > 0 && (
              <ListSection title='The next two weeks'>
                {upcoming.map(({ day, items }, gi) => (
                  <View key={day} style={gi > 0 && s.groupDivider}>
                    <Text style={s.groupTitle}>{dayLabel(day)}</Text>
                    {items.map((o, i) => row(o, day, i))}
                  </View>
                ))}
              </ListSection>
            )}

            <ListSection
              title='Calendars you follow'
              action={writable ? { label: 'Follow', onPress: () => { setFeedInSpace(canWriteSpace); setFeedSheet(true) } } : undefined}
              footer='iCal links from a school, a club or another calendar app, and calendar drives. Their events show here but are changed where they come from.'
            >
              {list.feeds.length ? list.feeds.map((f, i) => (
                <ListRow
                  key={f.id}
                  title={f.name}
                  subtitle={f.error ? f.error : [f.kind === 'drive' ? 'Drive' : '', f.fetchedAt ? `${f.count} event${f.count === 1 ? '' : 's'}` : 'Not fetched yet', f.space ? (shared ? `Shared in ${placeName}` : `Only in ${placeName}`) : ''].filter(Boolean).join(' · ')}
                  icon={f.kind === 'drive' ? 'hdd' : 'calendar-alt'}
                  iconColor={f.error ? t.danger : t.textDim}
                  divider={i > 0}
                  onPress={() => setFeedMenu(f)}
                />
              )) : <ListEmpty text='None yet.' />}
            </ListSection>
          </ScrollView>
        )}

        {/* The event editor */}
        <BottomSheet visible={!!draft} onClose={() => setDraft(null)} style={s.sheet}>
          {draft && (
            <ScrollView keyboardShouldPersistTaps='handled'>
              <Text style={s.sheetTitle}>{draft.id ? 'Edit event' : 'New event'}</Text>
              <TextInput style={s.input} value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} placeholder='Title' placeholderTextColor={t.textMuted} autoFocus={!draft.id} />
              <View style={s.switchCard}>
                <SwitchRow title='All day' value={draft.allDay} onValueChange={(allDay) => setDraft({ ...draft, allDay })} />
              </View>
              <View style={s.fieldRow}>
                <Field label='Day' t={t} s={s}><TextInput style={s.input} value={draft.day} onChangeText={(day) => setDraft({ ...draft, day, endDay: draft.endDay === draft.day ? day : draft.endDay })} placeholder='YYYY-MM-DD' placeholderTextColor={t.textMuted} keyboardType='numbers-and-punctuation' /></Field>
                {!draft.allDay && <Field label='Time' t={t} s={s}><TimeField label='Starts at' value={draft.startTime} open={picking === 'start'} onPress={() => setPicking(picking === 'start' ? null : 'start')} placeholder='Pick a time' /></Field>}
              </View>
              {!draft.allDay && picking === 'start' && (
                <TimePicker label='Start time' value={draft.startTime} onChange={setStartTime} onDone={() => setPicking(null)} />
              )}
              <View style={s.fieldRow}>
                <Field label={draft.allDay ? 'Last day' : 'Ends'} t={t} s={s}><TextInput style={s.input} value={draft.endDay} onChangeText={(endDay) => setDraft({ ...draft, endDay })} placeholder='YYYY-MM-DD' placeholderTextColor={t.textMuted} keyboardType='numbers-and-punctuation' /></Field>
                {!draft.allDay && <Field label='At' t={t} s={s}><TimeField label='Ends at' value={draft.endTime} open={picking === 'end'} onPress={() => setPicking(picking === 'end' ? null : 'end')} /></Field>}
              </View>
              {!draft.allDay && picking === 'end' && (
                <TimePicker
                  label='End time'
                  value={draft.endTime}
                  start={isTime(draft.startTime) ? draft.startTime : undefined}
                  onChange={(endTime) => setDraft({ ...draft, endTime, endDay: draft.endDay || draft.day })}
                  onLength={setLength}
                  onClear={() => { setDraft({ ...draft, endTime: '' }); setPicking(null) }}
                  onDone={() => setPicking(null)}
                />
              )}
              <Text style={s.label}>Repeats</Text>
              <View style={s.chips}>
                {FREQS.map((f) => (
                  <Pressable key={f.key} style={[s.chip, draft.freq === f.key && s.chipOn]} onPress={() => setDraft({ ...draft, freq: f.key })} accessibilityRole='button' accessibilityState={{ selected: draft.freq === f.key }}>
                    <Text style={[s.chipText, draft.freq === f.key && s.chipTextOn]}>{f.label}</Text>
                  </Pressable>
                ))}
              </View>
              {draft.freq !== 'none' && (
                <View style={s.fieldRow}>
                  <Field label='Every' t={t} s={s}><TextInput style={s.input} value={draft.interval} onChangeText={(interval) => setDraft({ ...draft, interval })} keyboardType='number-pad' /></Field>
                  <Field label='Until (optional)' t={t} s={s}><TextInput style={s.input} value={draft.until} onChangeText={(until) => setDraft({ ...draft, until })} placeholder='YYYY-MM-DD' placeholderTextColor={t.textMuted} keyboardType='numbers-and-punctuation' /></Field>
                </View>
              )}
              <TextInput style={s.input} value={draft.location} onChangeText={(location) => setDraft({ ...draft, location })} placeholder='Where' placeholderTextColor={t.textMuted} />
              <TextInput style={[s.input, s.notes]} value={draft.notes} onChangeText={(notes) => setDraft({ ...draft, notes })} placeholder='Notes' placeholderTextColor={t.textMuted} multiline />
              {canWriteSpace && !draft.id && (
                <View style={s.switchCard}>
                  <SwitchRow
                    title={shared ? `Share with ${placeName}` : `Only in ${placeName}`}
                    subtitle={draft.inSpace ? (shared ? 'Everyone in this Space sees it and can change it' : 'Shows only in this Space') : 'Yours, in every Space'}
                    value={draft.inSpace}
                    onValueChange={(inSpace) => setDraft({ ...draft, inSpace })}
                  />
                </View>
              )}
              {!!draftError && <Text style={s.errText}>{draftError}</Text>}
              <View style={s.actions}>
                {draft.id && <Pressable style={[s.btn, s.btnDanger]} onPress={remove} accessibilityRole='button'><Text style={s.btnDangerText}>Delete</Text></Pressable>}
                <View style={{ flex: 1 }} />
                <Pressable style={s.btn} onPress={() => setDraft(null)} accessibilityRole='button'><Text style={s.btnText}>Cancel</Text></Pressable>
                <Pressable style={[s.btn, s.btnPrimary]} onPress={save} disabled={busy} accessibilityRole='button'><Text style={s.btnPrimaryText}>{busy ? 'Saving…' : 'Save'}</Text></Pressable>
              </View>
            </ScrollView>
          )}
        </BottomSheet>

        {/* Follow an iCal feed */}
        <BottomSheet visible={feedSheet} onClose={() => setFeedSheet(false)} style={s.sheet}>
          <Text style={s.sheetTitle}>Follow a calendar</Text>
          <Text style={s.hint}>Paste an iCal link (https:// or webcal://), like the one a school or a club shares, or a calendar drive’s hyper:// address.</Text>
          <TextInput style={s.input} value={feedUrl} onChangeText={setFeedUrl} placeholder='iCal link or hyper:// drive' placeholderTextColor={t.textMuted} autoCapitalize='none' autoCorrect={false} keyboardType='url' autoFocus={!calDrives.length} />
          {calDrives.length > 0 && (
            <View style={s.switchCard}>
              {calDrives.map((d, i) => (
                <ListRow
                  key={d.url}
                  title={d.name}
                  subtitle='Calendar drive in this Space'
                  icon='hdd'
                  iconColor={d.color || t.textDim}
                  divider={i > 0}
                  disabled={busy}
                  right={<Text style={s.linkText}>Follow</Text>}
                  onPress={() => follow(d.url)}
                />
              ))}
            </View>
          )}
          {canWriteSpace && (
            <View style={s.switchCard}>
              <SwitchRow title={shared ? `Share with ${placeName}` : `Only in ${placeName}`} value={feedInSpace} onValueChange={setFeedInSpace} />
            </View>
          )}
          <View style={s.actions}>
            <View style={{ flex: 1 }} />
            <Pressable style={s.btn} onPress={() => setFeedSheet(false)} accessibilityRole='button'><Text style={s.btnText}>Cancel</Text></Pressable>
            <Pressable style={[s.btn, s.btnPrimary]} onPress={() => follow()} disabled={busy || !feedUrl.trim()} accessibilityRole='button'><Text style={s.btnPrimaryText}>{busy ? 'Following…' : 'Follow'}</Text></Pressable>
          </View>
        </BottomSheet>

        {/* A feed's actions */}
        <ActionSheet
          visible={!!feedMenu}
          onClose={() => setFeedMenu(null)}
          title={feedMenu?.name}
          subtitle={feedMenu?.url}
          groups={[[
            ...(feedMenu?.kind === 'drive' && onOpenUrl ? [{ label: 'Open the drive', icon: 'external-link-alt', onPress: () => { const url = feedMenu.url; setFeedMenu(null); onOpenUrl(url) } }] : []),
            { label: feedMenu?.kind === 'drive' ? 'Read it now' : 'Fetch it now', icon: 'redo-alt', disabled: !writable, onPress: () => feedMenu && fetchDue([{ ...feedMenu, due: true }], true) },
            { label: 'Stop following', icon: 'trash', destructive: true, disabled: !writable || (!!feedMenu?.space && !canWriteSpace), onPress: () => feedMenu && unfollow(feedMenu) }
          ]]}
        />

        {/* An event this person can't change: from a feed, or a Space they only view */}
        <BottomSheet visible={!!readOnly} onClose={() => setReadOnly(null)} style={s.sheet}>
          {readOnly && (
            <View>
              <Text style={s.sheetTitle}>{readOnly.title}</Text>
              <Text style={s.body}>{dayLabel(readOnly.start.slice(0, 10))}, {timeOf(readOnly, readOnly.start.slice(0, 10))}</Text>
              {!!readOnly.location && <Text style={s.body}>At {readOnly.location}</Text>}
              {!!readOnly.notes && <Text style={s.body}>{readOnly.notes}</Text>}
              <Text style={s.hint}>{readOnly.feed ? `From ${readOnly.feed.name}. ${readOnly.feed.kind === 'drive' ? 'Change it in the drive.' : 'Change it where it comes from.'}` : `Added by ${readOnly.by || 'someone'} in ${placeName}. You can view this Space’s calendar, but not change it.`}</Text>
            </View>
          )}
        </BottomSheet>
      </SafeAreaView>
    </Modal>
  )
}

function Field ({ label, children, s }: { label: string; children: ReactNode; t: Theme; s: ReturnType<typeof makeStyles> }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      {children}
    </View>
  )
}

function makeStyles (t: Theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    page: { padding: space.lg, paddingBottom: 48 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    errText: { color: t.danger, fontSize: 13, lineHeight: 19, marginVertical: space.sm },
    monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs },
    monthTitle: { color: t.text, fontSize: 17, fontWeight: '700' },
    grid: { backgroundColor: t.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, paddingVertical: space.sm, marginBottom: space.xl },
    week: { flexDirection: 'row' },
    weekday: { flex: 1, textAlign: 'center', color: t.textMuted, fontSize: 11, fontWeight: '600', paddingBottom: space.xs },
    cell: { flex: 1, alignItems: 'center', paddingVertical: 3, minHeight: 44 },
    num: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
    numToday: { borderWidth: 1.5, borderColor: t.accent },
    numSel: { backgroundColor: t.accent, borderColor: t.accent },
    numText: { color: t.text, fontSize: 14, fontVariant: ['tabular-nums'] },
    numOther: { color: t.textMuted },
    numTodayText: { color: t.accent, fontWeight: '700' },
    numSelText: { color: t.onAccent, fontWeight: '700' },
    dot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
    dotOn: { backgroundColor: t.accent },
    groupDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    groupTitle: { color: t.textDim, fontSize: 12, fontWeight: '600', paddingHorizontal: space.lg, paddingTop: space.md },
    sheet: { backgroundColor: t.surface, padding: space.lg, paddingBottom: space.lg, maxHeight: '90%' },
    sheetTitle: { color: t.text, fontSize: 17, fontWeight: '700', marginBottom: space.md },
    hint: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginVertical: space.sm },
    body: { color: t.text, fontSize: 14, lineHeight: 20, marginBottom: space.xs },
    label: { color: t.textDim, fontSize: 12, fontWeight: '600', marginBottom: space.xs },
    input: { backgroundColor: t.inputBg, color: t.text, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, paddingHorizontal: space.md, minHeight: 44, fontSize: 15, marginBottom: space.md },
    notes: { minHeight: 72, paddingTop: space.sm, textAlignVertical: 'top' },
    fieldRow: { flexDirection: 'row', gap: space.md },
    field: { flex: 1 },
    switchCard: { backgroundColor: t.bg, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, marginBottom: space.md, overflow: 'hidden' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
    chip: { borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, paddingHorizontal: space.md, minHeight: 36, justifyContent: 'center' },
    chipOn: { backgroundColor: t.accent, borderColor: t.accent },
    chipText: { color: t.text, fontSize: 13 },
    chipTextOn: { color: t.onAccent, fontWeight: '600' },
    actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
    btn: { borderRadius: radius.pill, paddingHorizontal: 18, minHeight: 40, justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: t.border },
    btnText: { color: t.text, fontSize: 14, fontWeight: '600' },
    btnPrimary: { backgroundColor: t.accent, borderColor: t.accent },
    btnPrimaryText: { color: t.onAccent, fontSize: 14, fontWeight: '600' },
    btnDanger: { borderColor: t.danger },
    btnDangerText: { color: t.danger, fontSize: 14, fontWeight: '600' },
    linkText: { color: t.accent, fontSize: 14, fontWeight: '600' }
  })
}
