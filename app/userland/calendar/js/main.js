// nomad://calendar — the Calendar: events the user adds, a shared Space's events its members add,
// and the calendars it follows: iCal feeds (the school's, a club's) and calendar drives
// (walled.garden/calendar, a drive that keeps its events as files in /events/).
//
// - A month grid; the left panel shows the picked day's events and the feeds.
// - An event is the user's (it shows in every Space) or the Space's. In a shared Space a new event
//   is shared by default, and every member sees it on their computer and phone.
// - Everything comes from nomad.vault (bg/web-apis/bg/calendar.ts; the rules are
//   shared/calendar.mjs). The page works out only the grid; bg expands repeats into `occurrences`.
//   Another Device's change arrives on watchAppData().
//
// Vanilla JS (served as-is, no bundle), styled with the app-stdlib tokens like nomad://messages.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const FREQS = [
  ['none', 'Never'],
  ['daily', 'Every day'],
  ['weekly', 'Every week'],
  ['monthly', 'Every month'],
  ['yearly', 'Every year'],
]

const pad = (n) => String(n).padStart(2, '0')
const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parseDay = (s) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
const addDays = (s, n) => {
  const d = parseDay(s)
  d.setDate(d.getDate() + n)
  return dayStr(d)
}
const today = () => dayStr(new Date())

const state = {
  month: today().slice(0, 7) + '-01', // the first day of the month shown
  selected: today(),
  data: null, // nomad.vault.listCalendar()
  drives: [], // nomad.vault.listCalendarDrives(): calendar drives in this Space not followed yet
  editing: null, // the event form, or null
  feedUrl: '',
  feedShared: true,
  busy: false,
  error: '',
}

init().catch((err) => {
  document.getElementById('app').replaceChildren(
    el('div', { class: 'notice' }, [el('h2', {}, ['Calendar failed to start']), el('p', {}, [err.message || String(err)])])
  )
  console.error('[calendar] init error:', err)
})

async function init() {
  const q = new URLSearchParams(location.search)
  // nomad://calendar/?follow=hyper://<key>/ (site-info's Follow in Calendar): the drive's address
  // goes in the Follow box, for the user to follow.
  if (/^hyper:\/\/[0-9a-z]{52,64}\/?$/i.test(q.get('follow') || '')) state.feedUrl = q.get('follow')
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.get('day') || '')) {
    state.selected = q.get('day')
    state.month = state.selected.slice(0, 7) + '-01'
  }
  await load()
  render()
  loadDrives()
  // Feeds that are due are fetched in the background, then the page loads again.
  nomad.vault
    .refreshCalendarFeeds({})
    .then(() => load().then(render))
    .catch(() => {})
  try {
    const events = nomad.vault.watchAppData()
    let t = null
    events.addEventListener('changed', () => {
      clearTimeout(t)
      t = setTimeout(() => load().then(render), 200)
    })
  } catch {}
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.editing) closeEditor()
  })
}

// The six weeks the grid shows.
function gridRange() {
  const first = parseDay(state.month)
  const start = addDays(state.month, -first.getDay())
  return { from: start, to: addDays(start, 42) }
}

async function load() {
  const { from, to } = gridRange()
  state.data = await nomad.vault.listCalendar({ from, to })
}

// The calendar drives this Space has that the calendar could follow.
async function loadDrives() {
  try {
    state.drives = (await nomad.vault.listCalendarDrives()) || []
  } catch {
    state.drives = []
  }
  render()
}

// Each day's occurrences: an all-day event over several days shows on each.
function byDay() {
  const map = new Map()
  for (const o of state.data?.occurrences || []) {
    const first = o.start.slice(0, 10)
    const last = o.allDay && o.end ? o.end.slice(0, 10) : first
    for (let d = first, n = 0; d <= last && n < 60; d = addDays(d, 1), n++) {
      if (!map.has(d)) map.set(d, [])
      map.get(d).push(o)
    }
  }
  return map
}

// ── Rendering ────────────────────────────────────────────────────────────────

function render() {
  const app = document.getElementById('app')
  const data = state.data || {}
  const days = byDay()
  const m = parseDay(state.month)
  document.title = state.editing ? `${state.editing.title.trim() || 'New event'} · Calendar` : 'Calendar'
  app.replaceChildren(
    el('header', {}, [
      el('div', { class: 'brand' }, [
        el('img', { src: 'asset:favicon:nomad://calendar/', alt: '' }),
        'Calendar',
        data.spaceName ? el('span', { class: 'space' }, [`· ${data.spaceName}`]) : null,
      ]),
      el('div', { class: 'month-nav' }, [
        el('button', { class: 'icon-btn', title: 'Previous month', 'aria-label': 'Previous month', onclick: () => moveMonth(-1) }, [icon('chevron-left')]),
        el('button', { class: 'icon-btn', title: 'Next month', 'aria-label': 'Next month', onclick: () => moveMonth(1) }, [icon('chevron-right')]),
        el('button', { class: 'btn', onclick: goToday }, ['Today']),
        el('div', { class: 'month-title' }, [`${MONTHS[m.getMonth()]} ${m.getFullYear()}`]),
      ]),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn primary', onclick: () => openEditor(null, state.selected) }, [icon('plus'), 'New event']),
    ]),
    el('div', { class: 'layout' }, [renderSide(days), renderGrid(days)]),
    ...(state.editing ? [renderEditor()] : [])
  )
}

function renderSide(days) {
  const d = parseDay(state.selected)
  const list = days.get(state.selected) || []
  const data = state.data || {}
  return el('aside', {}, [
    el('div', {}, [
      el('h2', { class: 'day-title' }, [`${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`]),
      el(
        'div',
        { class: 'agenda' },
        list.length ? list.map(renderItem) : [el('div', { class: 'empty' }, ['Nothing on this day.'])]
      ),
    ]),
    el('div', {}, [
      el('h3', { class: 'section-title' }, ['Calendars you follow']),
      el(
        'div',
        { class: 'feeds' },
        (data.feeds || []).map((f) =>
          el('div', { class: 'feed' }, [
            el('span', { class: 'dot', style: f.color ? `background:${f.color}` : null }),
            el('div', { class: 'meta' }, [
              el('div', { class: 'name', title: f.url }, [f.name]),
              f.error
                ? el('div', { class: 'sub err', title: f.error }, [`Couldn’t update: ${f.error}`])
                : el('div', { class: 'sub' }, [
                    f.kind === 'drive' ? 'Drive · ' : '',
                    `${f.count} event${f.count === 1 ? '' : 's'}`,
                    f.space ? ` · ${data.shared ? 'shared' : 'this Space'}` : ' · yours',
                  ]),
            ]),
            f.kind === 'drive'
              ? el('a', { class: 'icon-btn', href: f.url, target: '_blank', title: `Open ${f.name}`, 'aria-label': `Open ${f.name}` }, [icon('external-link-alt')])
              : null,
            el('button', { class: 'icon-btn danger', title: `Stop following ${f.name}`, 'aria-label': `Stop following ${f.name}`, onclick: () => removeFeed(f) }, [icon('times')]),
          ])
        )
      ),
      el('form', { class: 'subscribe', onsubmit: addFeed }, [
        el('input', {
          type: 'text',
          inputmode: 'url',
          spellcheck: 'false',
          placeholder: 'iCal link or hyper:// drive',
          'aria-label': 'An iCal link, or a calendar drive’s hyper:// address',
          value: state.feedUrl,
          oninput: (e) => {
            state.feedUrl = e.target.value
            // No render while typing (it would lose the caret): just turn Follow on or off.
            const btn = e.target.form?.querySelector('button[type=submit]')
            if (btn) btn.disabled = state.busy || !state.feedUrl.trim()
          },
        }),
        el('button', { class: 'btn', type: 'submit', disabled: state.busy || !state.feedUrl.trim() }, ['Follow']),
      ]),
      data.space && data.canWriteSpace
        ? el('label', { class: 'check hint' }, [
            el('input', { type: 'checkbox', checked: state.feedShared, onchange: (e) => (state.feedShared = e.target.checked) }),
            data.shared ? `Everyone in ${data.spaceName || 'this Space'} sees it` : `Only in ${data.spaceName || 'this Space'}`,
          ])
        : null,
      el('div', { class: 'hint' }, ['Paste the iCal (.ics or webcal://) link of a school, club or team calendar, or the hyper:// address of a calendar drive.']),
      renderDrives(),
      state.error && !state.editing ? el('div', { class: 'hint', style: 'color:var(--cal-err)' }, [state.error]) : null,
    ]),
  ])
}

// Calendar drives in this Space the calendar doesn't follow yet, each with Follow.
function renderDrives() {
  if (!state.drives.length) return null
  return el('div', { class: 'drive-picks' }, [
    el('h3', { class: 'section-title' }, ['Calendar drives in this Space']),
    ...state.drives.map((d) =>
      el('div', { class: 'feed' }, [
        el('span', { class: 'dot', style: d.color ? `background:${d.color}` : null }),
        el('div', { class: 'meta' }, [el('div', { class: 'name', title: d.url }, [d.name]), el('div', { class: 'sub' }, ['Drive'])]),
        el('button', { class: 'btn', disabled: state.busy, onclick: () => followDrive(d) }, ['Follow']),
      ])
    ),
  ])
}

function renderItem(o) {
  const time = o.allDay ? 'All day' : o.start.slice(11, 16)
  const sub = [o.location, o.feed && `From ${o.feed.name}`, o.repeats && 'Repeats', o.by && `Added by ${o.by}`].filter(Boolean).join(' · ')
  const readonly = !!o.feed
  return el(
    'button',
    {
      class: 'item' + (readonly ? ' readonly' : ''),
      title: readonly ? `From ${o.feed.name}. ${o.feed.kind === 'drive' ? 'Change it in the drive' : 'Change it there'}.${o.notes ? '\n\n' + o.notes : ''}` : 'Edit this event',
      onclick: readonly ? null : () => openEditor(o.id),
    },
    [el('span', { class: 'time' }, [time]), el('span', {}, [el('div', { class: 'title' }, [o.title]), sub ? el('div', { class: 'sub' }, [sub]) : null])]
  )
}

function renderGrid(days) {
  const { from } = gridRange()
  const month = state.month.slice(0, 7)
  const t = today()
  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = addDays(from, i)
    const list = days.get(d) || []
    const cls = ['day', d.slice(0, 7) !== month && 'other', d === t && 'today', d === state.selected && 'selected'].filter(Boolean).join(' ')
    const shown = list.slice(0, 3)
    cells.push(
      el('div', { class: cls, onclick: () => selectDay(d), ondblclick: () => openEditor(null, d), role: 'button', 'aria-label': `${d}, ${list.length} event${list.length === 1 ? '' : 's'}` }, [
        el('span', { class: 'num' }, [String(parseDay(d).getDate())]),
        ...shown.map((o) =>
          el(
            'button',
            {
              class: 'chip' + (o.feed ? ' feed-chip' : ''),
              title: `${o.title}${o.feed ? ` (from ${o.feed.name})` : ''}`,
              style: o.feed?.color ? `box-shadow: inset 3px 0 0 ${o.feed.color}` : null,
              onclick: (e) => {
                e.stopPropagation()
                if (o.feed) selectDay(d)
                else openEditor(o.id)
              },
            },
            [!o.allDay ? el('span', { class: 't' }, [o.start.slice(11, 16)]) : null, o.title]
          )
        ),
        list.length > shown.length ? el('span', { class: 'more' }, [`${list.length - shown.length} more`]) : null,
      ])
    )
  }
  return el('main', {}, [el('div', { class: 'weekdays' }, DAYS.map((d) => el('div', {}, [d]))), el('div', { class: 'grid' }, cells)])
}

// ── The event editor ─────────────────────────────────────────────────────────

function blankForm(day) {
  const data = state.data || {}
  return {
    id: null,
    title: '',
    allDay: false,
    startDay: day,
    startTime: '09:00',
    endDay: day,
    endTime: '10:00',
    hasEnd: true,
    freq: 'none',
    interval: 1,
    byDay: [parseDay(day).getDay()],
    until: '',
    location: '',
    notes: '',
    inSpace: !!(data.space && data.canWriteSpace),
    by: '',
    readOnly: false,
    error: '',
  }
}

function openEditor(id, day = state.selected) {
  const data = state.data || {}
  if (!id) {
    state.editing = blankForm(day)
  } else {
    const ev = (data.events || []).find((e) => e.id === id)
    if (!ev) return
    const r = ev.repeat || null
    state.editing = {
      ...blankForm(ev.start.slice(0, 10)),
      id: ev.id,
      title: ev.title,
      allDay: !!ev.allDay,
      startTime: ev.allDay ? '09:00' : ev.start.slice(11, 16),
      endDay: (ev.end || ev.start).slice(0, 10),
      endTime: ev.end && !ev.allDay ? ev.end.slice(11, 16) : ev.allDay ? '10:00' : ev.start.slice(11, 16),
      hasEnd: !!ev.end || ev.allDay,
      freq: r ? r.freq : 'none',
      interval: r ? r.interval : 1,
      byDay: r?.byDay || [parseDay(ev.start).getDay()],
      until: r?.until || '',
      location: ev.location || '',
      notes: ev.notes || '',
      inSpace: !!ev.space,
      by: ev.by || '',
      readOnly: !!ev.space && !data.canWriteSpace,
    }
  }
  render()
  setTimeout(() => document.querySelector('.dialog input[name=title]')?.focus(), 0)
}

function closeEditor() {
  state.editing = null
  render()
}

function renderEditor() {
  const e = state.editing
  const data = state.data || {}
  const set = (patch, again = false) => {
    Object.assign(e, patch, { error: '' })
    if (again) render()
  }
  const ro = e.readOnly
  return el('div', { class: 'backdrop', onclick: (ev) => ev.target === ev.currentTarget && closeEditor() }, [
    el('form', { class: 'dialog', role: 'dialog', 'aria-label': e.id ? 'Edit event' : 'New event', onsubmit: saveEvent }, [
      el('h2', {}, [e.id ? (ro ? e.title : 'Edit event') : 'New event']),
      el('div', { class: 'fields' }, [
        el('label', { for: 'ev-title' }, ['Title']),
        el('input', { id: 'ev-title', name: 'title', type: 'text', value: e.title, placeholder: 'Bins out', disabled: ro, oninput: (ev) => set({ title: ev.target.value }) }),

        el('span', {}, ['']),
        el('label', { class: 'check' }, [el('input', { type: 'checkbox', checked: e.allDay, disabled: ro, onchange: (ev) => set({ allDay: ev.target.checked }, true) }), 'All day']),

        el('label', { for: 'ev-start' }, ['Starts']),
        el('div', { class: 'row' }, [
          el('input', { id: 'ev-start', type: 'date', value: e.startDay, disabled: ro, onchange: (ev) => set({ startDay: ev.target.value, endDay: e.endDay < ev.target.value ? ev.target.value : e.endDay }, true) }),
          e.allDay ? null : el('input', { type: 'time', 'aria-label': 'Start time', value: e.startTime, disabled: ro, onchange: (ev) => set({ startTime: ev.target.value }) }),
        ]),

        el('label', { for: 'ev-end' }, ['Ends']),
        el('div', { class: 'row' }, [
          el('input', { id: 'ev-end', type: 'date', value: e.endDay, disabled: ro, onchange: (ev) => set({ endDay: ev.target.value, hasEnd: true }) }),
          e.allDay ? null : el('input', { type: 'time', 'aria-label': 'End time', value: e.endTime, disabled: ro, onchange: (ev) => set({ endTime: ev.target.value, hasEnd: true }) }),
        ]),

        el('label', { for: 'ev-repeat' }, ['Repeats']),
        el('div', { class: 'row' }, [
          el('select', { id: 'ev-repeat', disabled: ro, onchange: (ev) => set({ freq: ev.target.value }, true) }, FREQS.map(([v, label]) => el('option', { value: v, selected: e.freq === v }, [label]))),
          e.freq !== 'none'
            ? el('label', { class: 'check' }, [
                'every',
                el('input', { type: 'number', min: '1', max: '99', style: 'width:56px', value: String(e.interval), disabled: ro, 'aria-label': 'Repeat every', oninput: (ev) => set({ interval: Number(ev.target.value) || 1 }) }),
              ])
            : null,
        ]),

        e.freq === 'weekly' ? el('span', {}, ['On']) : null,
        e.freq === 'weekly'
          ? el(
              'div',
              { class: 'weekday-pick' },
              DAYS.map((name, i) =>
                el(
                  'button',
                  {
                    type: 'button',
                    class: e.byDay.includes(i) ? 'on' : '',
                    'aria-pressed': e.byDay.includes(i) ? 'true' : 'false',
                    disabled: ro,
                    onclick: () => set({ byDay: e.byDay.includes(i) ? e.byDay.filter((d) => d !== i) : [...e.byDay, i].sort() }, true),
                  },
                  [name]
                )
              )
            )
          : null,

        e.freq !== 'none' ? el('label', { for: 'ev-until' }, ['Until']) : null,
        e.freq !== 'none' ? el('input', { id: 'ev-until', type: 'date', value: e.until, disabled: ro, onchange: (ev) => set({ until: ev.target.value }) }) : null,

        el('label', { for: 'ev-where' }, ['Where']),
        el('input', { id: 'ev-where', type: 'text', value: e.location, placeholder: 'Optional', disabled: ro, oninput: (ev) => set({ location: ev.target.value }) }),

        el('label', { for: 'ev-notes' }, ['Notes']),
        el('textarea', { id: 'ev-notes', placeholder: 'Optional', disabled: ro, oninput: (ev) => set({ notes: ev.target.value }) }, [e.notes]),

        !e.id && data.space && data.canWriteSpace ? el('span', {}, ['']) : null,
        !e.id && data.space && data.canWriteSpace
          ? el('label', { class: 'check' }, [
              el('input', { type: 'checkbox', checked: e.inSpace, onchange: (ev) => set({ inSpace: ev.target.checked }) }),
              data.shared ? `Everyone in ${data.spaceName || 'this Space'} sees it` : `Only in ${data.spaceName || 'this Space'}`,
            ])
          : null,
      ]),
      e.by ? el('div', { class: 'by' }, [`Added by ${e.by}`]) : null,
      e.error ? el('div', { class: 'error' }, [e.error]) : null,
      el('div', { class: 'actions' }, [
        ro ? null : el('button', { class: 'btn primary', type: 'submit', disabled: state.busy }, ['Save']),
        el('button', { class: 'btn', type: 'button', onclick: closeEditor }, [ro ? 'Close' : 'Cancel']),
        el('div', { class: 'spacer' }),
        e.id && !ro ? el('button', { class: 'btn danger', type: 'button', onclick: deleteEvent }, [icon('trash'), 'Delete']) : null,
      ]),
    ]),
  ])
}

async function saveEvent(ev) {
  ev.preventDefault()
  const e = state.editing
  if (!e || state.busy) return
  const start = e.allDay ? e.startDay : `${e.startDay}T${e.startTime || '09:00'}`
  const end = !e.hasEnd ? '' : e.allDay ? e.endDay : `${e.endDay}T${e.endTime || e.startTime}`
  state.busy = true
  try {
    await nomad.vault.saveCalendarEvent({
      id: e.id || undefined,
      title: e.title,
      start,
      end: end && end !== start ? end : undefined,
      allDay: e.allDay,
      location: e.location,
      notes: e.notes,
      repeat: e.freq === 'none' ? null : { freq: e.freq, interval: e.interval, byDay: e.freq === 'weekly' ? e.byDay : undefined, until: e.until || undefined },
      inSpace: e.inSpace,
    })
    state.selected = e.startDay
    state.editing = null
    await load()
  } catch (err) {
    e.error = cleanError(err)
  } finally {
    state.busy = false
    render()
  }
}

async function deleteEvent() {
  const e = state.editing
  if (!e?.id || !confirm(`Delete “${e.title}”${e.freq !== 'none' ? ' and every time it repeats' : ''}?`)) return
  try {
    await nomad.vault.deleteCalendarEvent(e.id)
    state.editing = null
    await load()
  } catch (err) {
    e.error = cleanError(err)
  }
  render()
}

// ── Feeds ────────────────────────────────────────────────────────────────────

async function addFeed(ev) {
  ev.preventDefault()
  await follow(state.feedUrl.trim())
}

function followDrive(d) {
  return follow(d.url)
}

// Follow an iCal link or a calendar drive.
async function follow(url) {
  if (!url || state.busy) return
  state.busy = true
  state.error = ''
  render()
  try {
    const data = state.data || {}
    await nomad.vault.saveCalendarFeed({ url, inSpace: !!(data.space && data.canWriteSpace && state.feedShared) })
    if (url === state.feedUrl.trim()) state.feedUrl = ''
    state.drives = state.drives.filter((d) => d.url !== url)
    await load()
  } catch (err) {
    state.error = cleanError(err)
  } finally {
    state.busy = false
    render()
  }
}

async function removeFeed(f) {
  if (!confirm(`Stop following ${f.name}? Its events leave the calendar.`)) return
  try {
    await nomad.vault.deleteCalendarFeed(f.id)
    await load()
    if (f.kind === 'drive') loadDrives()
  } catch (err) {
    state.error = cleanError(err)
  }
  render()
}

// ── Navigation ───────────────────────────────────────────────────────────────

async function moveMonth(n) {
  const d = parseDay(state.month)
  d.setMonth(d.getMonth() + n)
  state.month = dayStr(d)
  await load()
  render()
}

async function goToday() {
  state.selected = today()
  state.month = state.selected.slice(0, 7) + '-01'
  await load()
  render()
}

function selectDay(d) {
  state.selected = d
  if (d.slice(0, 7) !== state.month.slice(0, 7)) {
    state.month = d.slice(0, 7) + '-01'
    load().then(render)
    return
  }
  render()
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function el(tag, attrs, children) {
  const node = document.createElement(tag)
  for (const k in attrs || {}) {
    const v = attrs[k]
    if (k === 'class') node.className = v
    else if (k.startsWith('on')) {
      if (v) node.addEventListener(k.slice(2), v)
    } else if (k === 'value') node.value = v
    else if (k === 'checked') node.checked = !!v
    else if (k === 'selected') node.selected = !!v
    else if (k === 'disabled') node.disabled = !!v
    else if (v === true) node.setAttribute(k, '')
    else if (v != null && v !== false) node.setAttribute(k, v)
  }
  for (const c of children || []) if (c != null && c !== false) node.append(c)
  return node
}

function icon(name, cls = '') {
  return el('span', { class: `fas fa-fw fa-${name}${cls ? ' ' + cls : ''}`, 'aria-hidden': 'true' })
}
