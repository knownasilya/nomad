// nomad://messages — the Persona Inbox (ADR-0036): direct messages between the user's Personas and
// other people's Profile Drives.
//
// - Conversations on the left, newest first, each tagged with the Persona it belongs to when the
//   user has more than one. Requests (Messages from people who aren't Contacts) are their own tab
//   with a count; they never notify. Accept, Ignore or Block a request; the sender is never told.
// - A Conversation shows plain text only. Links are shown and open in a new tab on a click; nothing
//   in a Message loads anything by itself.
// - New message: to a Profile Drive (hyper://…/) or a message link (nomad://messages/new?…), from a
//   Persona the user picks. site-info's Message button and a message link open /new prefilled.
// - Everything comes from nomad.inbox (bg/web-apis/bg/inbox.ts); another Device's change arrives on
//   watch().
//
// Routes: /                         the list
//         /?persona=<id>&with=<url> a Conversation
//         /new?to=<url>[&box=…&mailbox=…][&persona=<id>]  a new message
//
// Vanilla JS (served as-is, no bundle), styled with the app-stdlib tokens like nomad://reader.

const state = {
  loading: true,
  error: '',
  summary: { vaultReady: false, personas: [], conversations: [], requests: [], blocked: [] },
  tab: 'inbox', // 'inbox' | 'requests'
  open: null, // { personaId, other }
  thread: null, // nomad.inbox.thread()
  compose: null, // { to, link, personaId, lookup, lookingUp, error }
  draft: '',
  sending: false,
  notice: '',
}

const titles = new Map() // profile URL -> title, as Conversations load

init().catch((err) => {
  document.getElementById('app').replaceChildren(
    el('div', { class: 'notice' }, [
      el('div', { class: 'notice-icon' }, [icon('exclamation-triangle')]),
      el('h2', {}, ['Messages failed to start']),
      el('p', {}, [err.message || String(err)]),
    ])
  )
  console.error('[messages] init error:', err)
})

async function init() {
  readRoute()
  await refresh()
  if (state.compose?.to) lookupTo()
  if (state.open) await loadThread()
  render()
  const events = nomad.inbox.watch()
  let t = null
  events.addEventListener('changed', () => {
    clearTimeout(t)
    t = setTimeout(async () => {
      await refresh()
      if (state.open) await loadThread()
      render()
    }, 150)
  })
  window.addEventListener('popstate', async () => {
    readRoute()
    if (state.open) await loadThread()
    render()
  })
}

function readRoute() {
  const u = new URL(location.href)
  state.compose = null
  state.open = null
  state.thread = null
  if (/^\/new\/?$/.test(u.pathname)) {
    state.compose = {
      to: u.searchParams.get('to') || '',
      link: u.searchParams.get('box') ? u.href : '',
      personaId: u.searchParams.get('persona') || '',
      lookup: null,
      lookingUp: false,
      error: '',
    }
    return
  }
  const persona = u.searchParams.get('persona')
  const other = u.searchParams.get('with')
  if (persona && other) state.open = { personaId: persona, other }
}

function go(url) {
  history.pushState({}, '', url)
  readRoute()
}

async function refresh() {
  try {
    state.summary = await nomad.inbox.summary()
    state.error = ''
  } catch (e) {
    state.error = e.message || String(e)
  }
  state.loading = false
  for (const c of [...state.summary.conversations, ...state.summary.requests])
    if (c.title) titles.set(c.other, c.title)
}

async function loadThread() {
  const { personaId, other } = state.open
  try {
    state.thread = await nomad.inbox.thread(personaId, other)
    if (state.thread.title) titles.set(other, state.thread.title)
    const unread = state.thread.records.some((r) => r.direction === 'in' && !r.readAt)
    if (unread && !isRequest()) nomad.inbox.markRead(personaId, other).catch(() => {})
  } catch (e) {
    state.thread = null
    state.notice = e.message || String(e)
  }
}

// Helpers
// =

function persona(id) {
  return state.summary.personas.find((p) => p.personaId === id) || null
}

function usablePersonas() {
  return state.summary.personas.filter((p) => p.usable)
}

function manyPersonas() {
  return state.summary.personas.length > 1
}

function shortKey(url) {
  const m = /^hyper:\/\/([0-9a-f]{64})/i.exec(String(url || ''))
  return m ? `${m[1].slice(0, 6)}…${m[1].slice(-4)}` : ''
}

function nameOf(url) {
  return titles.get(url) || shortKey(url)
}

function isRequest() {
  const { personaId, other } = state.open || {}
  return state.summary.requests.some((c) => c.personaId === personaId && c.other === other)
}

function when(iso) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (now - d < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function initials(name) {
  const s = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim()
  return (s.split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase()
}

// Plain text, with http(s) and hyper:// links made clickable. Nothing is fetched until a click.
function textWithLinks(text) {
  const out = []
  const re = /\b(?:https?|hyper):\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi
  let at = 0
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push(text.slice(at, m.index))
    out.push(el('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer' }, [m[0]]))
    at = m.index + m[0].length
  }
  if (at < text.length) out.push(text.slice(at))
  return out
}

// Render
// =

function render() {
  const app = document.getElementById('app')
  const scroller = app.querySelector('.thread-body')
  const atBottom = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40
  const keepDraft = document.activeElement?.matches?.('.composer textarea')
  app.replaceChildren(renderHeader(), el('div', { class: 'layout' }, [renderSidebar(), renderMain()]))
  const body = app.querySelector('.thread-body')
  if (body && atBottom) body.scrollTop = body.scrollHeight
  if (keepDraft) app.querySelector('.composer textarea')?.focus()
}

function renderHeader() {
  const unread = state.summary.conversations.reduce((n, c) => n + c.unread, 0)
  return el('header', {}, [
    el('div', { class: 'brand' }, [el('img', { src: 'asset:favicon:nomad://messages/', alt: '' }), 'Messages']),
    el('div', { class: 'status' }, [state.loading ? 'Loading…' : unread ? `${unread} unread` : '']),
    el('div', { class: 'header-actions' }, [
      el('button', { class: 'btn primary', onclick: () => { go('/new'); render() } }, [icon('pen'), ' New message']),
      el(
        'a',
        {
          class: 'icon-btn',
          href: 'nomad://library/personas',
          title: 'Inbox settings for your Personas',
          'aria-label': 'Inbox settings for your Personas',
        },
        [icon('cog')]
      ),
    ]),
  ])
}

function renderSidebar() {
  const reqs = state.summary.requests
  const list = state.tab === 'requests' ? reqs : state.summary.conversations
  return el('nav', {}, [
    el('div', { class: 'tabs', role: 'tablist' }, [
      tabButton('inbox', 'Inbox', null),
      tabButton('requests', 'Requests', reqs.length || null),
    ]),
    el(
      'div',
      { class: 'conv-list' },
      list.length
        ? list.map(renderRow)
        : [
            el('div', { class: 'empty-small' }, [
              state.tab === 'requests'
                ? 'No requests. Messages from people who aren’t your contacts wait here, without a notification.'
                : 'No conversations yet.',
            ]),
          ]
    ),
  ])
}

function tabButton(id, label, count) {
  return el(
    'button',
    {
      class: `tab${state.tab === id ? ' active' : ''}`,
      role: 'tab',
      'aria-selected': state.tab === id ? 'true' : 'false',
      onclick: () => {
        state.tab = id
        render()
      },
    },
    [label, count ? el('span', { class: 'count' }, [String(count)]) : null]
  )
}

function renderRow(c) {
  const name = c.title || nameOf(c.other)
  const active = state.open && state.open.personaId === c.personaId && state.open.other === c.other
  const last = c.last.message
  const p = persona(c.personaId)
  return el(
    'a',
    {
      class: `conv-row${active ? ' active' : ''}${c.unread ? ' unread' : ''}`,
      href: `/?persona=${encodeURIComponent(c.personaId)}&with=${encodeURIComponent(c.other)}`,
      onclick: async (e) => {
        e.preventDefault()
        go(e.currentTarget.getAttribute('href'))
        await loadThread()
        render()
      },
    },
    [
      el('div', { class: 'avatar', 'aria-hidden': 'true' }, [initials(name)]),
      el('div', { class: 'conv-text' }, [
        el('div', { class: 'conv-top' }, [
          el('span', { class: 'conv-name' }, [name]),
          el('span', { class: 'conv-when' }, [when(last.createdAt)]),
        ]),
        el('div', { class: 'conv-last' }, [
          c.last.direction === 'out' ? 'You: ' : '',
          last.text.slice(0, 120),
        ]),
        manyPersonas() && p ? el('div', { class: 'conv-persona' }, [`to ${p.label}`]) : null,
      ]),
      c.unread ? el('span', { class: 'dot', title: `${c.unread} unread`, 'aria-label': `${c.unread} unread` }) : null,
    ]
  )
}

function renderMain() {
  if (state.loading) return el('main', {}, [])
  if (state.error) return el('main', {}, [notice('exclamation-triangle', 'Messages aren’t available', state.error)])
  if (!state.summary.vaultReady)
    return el('main', {}, [notice('sync', 'Waiting for your Vault', 'This device hasn’t finished syncing your Vault yet. Messages appear once it has.')])
  if (!state.summary.personas.length)
    return el('main', {}, [
      notice('user-circle', 'Make a Persona first', 'Messages go to and from one of your Personas.', [
        el('a', { class: 'btn primary', href: 'nomad://library/personas' }, ['Open Personas']),
      ]),
    ])
  if (state.compose) return el('main', {}, [renderCompose()])
  if (state.open) return el('main', { class: 'with-thread' }, [renderThread()])
  return el('main', {}, [renderOverview()])
}

function renderOverview() {
  const on = state.summary.personas.filter((p) => p.enabled && p.mode !== 'off')
  return notice(
    'comments',
    'Your messages',
    on.length
      ? 'Pick a conversation, or write to someone new.'
      : 'Your Personas don’t take messages from new people yet. You can still write to someone, and they can answer you.',
    [
      el('button', { class: 'btn primary', onclick: () => { go('/new'); render() } }, [icon('pen'), ' New message']),
      on.length ? null : el('a', { class: 'btn', href: 'nomad://library/personas' }, ['Turn on messages']),
    ],
    el('p', { class: 'privacy' }, [
      'Messages are sealed so only your own devices can open them, and kept in your Vault. They are not end-to-end in the strongest sense: anyone who can read your Vault can read them, a stolen key opens earlier messages, and the person you write to learns your device’s network address. ',
      el('a', { href: 'https://nomad.pages.dev/docs/api/advanced/messages/', target: '_blank' }, ['What is and isn’t private']),
    ])
  )
}

function notice(iconName, title, text, actions = [], extra = null) {
  return el('div', { class: 'notice' }, [
    el('div', { class: 'notice-icon' }, [icon(iconName)]),
    el('h2', {}, [title]),
    el('p', {}, [text]),
    actions.length ? el('div', { class: 'notice-actions' }, actions) : null,
    extra,
  ])
}

// A Conversation
// =

function renderThread() {
  const t = state.thread
  if (!t) return notice('comment-slash', 'That conversation is gone', state.notice || '')
  const p = persona(t.personaId)
  const name = t.title || shortKey(t.other)
  const request = isRequest()
  const blocked = t.contact === 'blocked'
  return el('div', { class: 'thread' }, [
    el('div', { class: 'thread-head' }, [
      t.thumb
        ? el('img', { class: 'avatar img', src: `${t.other.replace(/\/$/, '')}/${t.thumb.replace(/^\//, '')}`, alt: '' })
        : el('div', { class: 'avatar', 'aria-hidden': 'true' }, [initials(name)]),
      el('div', { class: 'thread-who' }, [
        el('div', { class: 'thread-name' }, [name]),
        el('div', { class: 'thread-key' }, [
          el('a', { href: t.other, target: '_blank', title: 'Open their profile' }, [`hyper://${shortKey(t.other)}`]),
          p && manyPersonas() ? ` · with your Persona ${p.label}` : '',
        ]),
      ]),
      el('div', { class: 'thread-actions' }, [
        blocked
          ? el('button', { class: 'btn', onclick: () => act('unblock') }, ['Unblock'])
          : request
            ? null
            : el('button', { class: 'icon-btn', title: 'Block', 'aria-label': 'Block', onclick: () => act('block') }, [icon('ban')]),
        el('button', { class: 'icon-btn', title: 'Delete conversation', 'aria-label': 'Delete conversation', onclick: () => act('delete') }, [icon('trash')]),
      ]),
    ]),
    request
      ? el('div', { class: 'request-bar' }, [
          el('div', {}, [
            el('strong', {}, [`${name} isn’t one of your contacts.`]),
            ` Check the drive key (hyper://${shortKey(t.other)}) is the one you expect. They won’t know whether you accept, ignore or block them.`,
          ]),
          el('div', { class: 'request-actions' }, [
            el('button', { class: 'btn primary', onclick: () => act('accept') }, ['Accept']),
            el('button', { class: 'btn', onclick: () => act('ignore') }, ['Ignore']),
            el('button', { class: 'btn danger', onclick: () => act('block') }, ['Block']),
          ]),
        ])
      : null,
    el('div', { class: 'thread-body' }, t.records.map(renderBubble)),
    request || blocked ? null : renderComposer(t),
  ])
}

function renderBubble(r) {
  const out = r.direction === 'out'
  let meta = when(r.message.createdAt)
  let retry = null
  if (out && r.status === 'queued') meta += r.attempts ? ' · Not delivered yet, trying again' : ' · Sending…'
  else if (out && r.status === 'failed') {
    meta += ' · Not delivered'
    retry = el('button', { class: 'link-btn', onclick: () => act('retry', r.message.id) }, ['Retry'])
  } else if (out && r.status === 'delivered') meta += ' · Delivered'
  return el('div', { class: `bubble-row ${out ? 'out' : 'in'}` }, [
    el('div', { class: `bubble${r.status === 'failed' ? ' failed' : ''}` }, textWithLinks(r.message.text)),
    el('div', { class: 'bubble-meta' }, [meta, retry ? ' ' : '', retry]),
  ])
}

function renderComposer(t) {
  const area = el('textarea', {
    rows: '2',
    placeholder: t.reachable ? 'Write a message' : 'Write a message (it waits until they can be reached)',
    'aria-label': 'Message',
    maxlength: '8000',
    oninput: (e) => (state.draft = e.target.value),
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendReply()
      }
    },
  })
  area.value = state.draft
  return el('div', { class: 'composer' }, [
    area,
    el(
      'button',
      { class: 'icon-btn send', title: 'Send', 'aria-label': 'Send', disabled: state.sending || !state.draft.trim(), onclick: sendReply },
      [icon('paper-plane')]
    ),
  ])
}

async function sendReply() {
  const t = state.thread
  if (!t || !state.draft.trim() || state.sending) return
  state.sending = true
  try {
    const last = [...t.records].reverse().find((r) => r.direction === 'in')
    await nomad.inbox.send({ personaId: t.personaId, to: t.other, text: state.draft, inReplyTo: last?.message.id })
    state.draft = ''
  } catch (e) {
    alert(e.message || String(e))
  }
  state.sending = false
  await refresh()
  await loadThread()
  render()
}

async function act(what, id) {
  const { personaId, other } = state.open
  const name = nameOf(other)
  try {
    if (what === 'accept') await nomad.inbox.accept(personaId, other)
    else if (what === 'ignore') {
      await nomad.inbox.ignore(personaId, other)
      go('/')
    } else if (what === 'block') {
      if (!confirm(`Block ${name}? Their messages to this Persona are dropped from now on. They aren’t told.`)) return
      await nomad.inbox.block(personaId, other)
    } else if (what === 'unblock') await nomad.inbox.unblock(personaId, other)
    else if (what === 'delete') {
      if (!confirm(`Delete this conversation with ${name} from all your devices?`)) return
      await nomad.inbox.deleteConversation(personaId, other)
      go('/')
    } else if (what === 'retry') await nomad.inbox.retry(personaId, other, id)
  } catch (e) {
    alert(e.message || String(e))
  }
  await refresh()
  if (state.open) await loadThread()
  if (what === 'accept') state.tab = 'inbox'
  render()
}

// A new message
// =

function renderCompose() {
  const c = state.compose
  const people = usablePersonas()
  if (!c.personaId) c.personaId = people[0]?.personaId || ''
  if (c.personaId && !people.some((p) => p.personaId === c.personaId) && people[0]) c.personaId = people[0].personaId
  const to = el('input', {
    type: 'text',
    value: c.link || c.to,
    placeholder: 'hyper://… profile, or a message link',
    'aria-label': 'To',
    onchange: (e) => {
      const v = e.target.value.trim()
      if (v.startsWith('nomad://messages/new')) {
        c.link = v
        try {
          c.to = new URL(v).searchParams.get('to') || ''
        } catch {
          c.to = ''
        }
      } else {
        c.link = ''
        c.to = v
      }
      lookupTo()
    },
  })
  const text = el('textarea', {
    rows: '6',
    maxlength: '8000',
    placeholder: 'Write a message',
    'aria-label': 'Message',
    oninput: (e) => (state.draft = e.target.value),
  })
  text.value = state.draft
  const l = c.lookup
  let who = null
  if (c.lookingUp) who = el('div', { class: 'lookup' }, ['Looking up their profile…'])
  else if (c.error) who = el('div', { class: 'lookup err' }, [c.error])
  else if (l) {
    const reach = c.link || l.published
    who = el('div', { class: `lookup${reach ? '' : ' warn'}` }, [
      el('strong', {}, [l.title || 'A profile without a name']),
      ` · hyper://${shortKey(l.profileUrl)}`,
      l.isPerson ? '' : ' · This drive isn’t a profile.',
      reach
        ? ''
        : el('div', {}, [
            'They don’t take messages from new people. Ask them for a message link, or wait for them to write first.',
          ]),
    ])
  }
  return el('div', { class: 'compose' }, [
    el('h2', {}, ['New message']),
    el('label', { class: 'field' }, [el('span', {}, ['From']), people.length
      ? el(
          'select',
          {
            onchange: (e) => (c.personaId = e.target.value),
            'aria-label': 'From',
          },
          people.map((p) => el('option', { value: p.personaId, selected: p.personaId === c.personaId }, [p.label]))
        )
      : el('div', { class: 'lookup warn' }, ['None of your Personas can send right now. Check them in My Library → Personas.'])]),
    el('label', { class: 'field' }, [el('span', {}, ['To']), to]),
    who,
    el('label', { class: 'field' }, [el('span', {}, ['Message']), text]),
    el('div', { class: 'compose-actions' }, [
      el('button', { class: 'btn', onclick: () => { state.draft = ''; go('/'); render() } }, ['Cancel']),
      el(
        'button',
        {
          class: 'btn primary',
          disabled: state.sending || !c.personaId || !c.to || !(c.link || l?.published),
          onclick: sendNew,
        },
        [icon('paper-plane'), ' Send']
      ),
    ]),
  ])
}

async function lookupTo() {
  const c = state.compose
  if (!c) return
  c.lookup = null
  c.error = ''
  if (!c.to) return render()
  if (!/^hyper:\/\/[0-9a-f]{64}/i.test(c.to)) {
    c.error = 'Paste a profile’s hyper:// address or a message link.'
    return render()
  }
  c.lookingUp = true
  render()
  try {
    c.lookup = await nomad.inbox.lookup(c.to)
    if (c.lookup.title) titles.set(c.lookup.profileUrl, c.lookup.title)
  } catch (e) {
    c.error = e.message || String(e)
  }
  c.lookingUp = false
  render()
}

async function sendNew() {
  const c = state.compose
  if (!state.draft.trim()) return alert('Write something first')
  state.sending = true
  render()
  try {
    await nomad.inbox.send({ personaId: c.personaId, to: c.to, text: state.draft, link: c.link || undefined })
    state.draft = ''
    const to = c.lookup?.profileUrl || c.to
    go(`/?persona=${encodeURIComponent(c.personaId)}&with=${encodeURIComponent(to)}`)
    await refresh()
    await loadThread()
  } catch (e) {
    alert(e.message || String(e))
  }
  state.sending = false
  render()
}

// DOM
// =

function icon(name, cls = '') {
  return el('span', { class: `fas fa-fw fa-${name}${cls ? ' ' + cls : ''}`, 'aria-hidden': 'true' })
}

function el(tag, attrs, children) {
  const node = document.createElement(tag)
  for (const k in attrs || {}) {
    const v = attrs[k]
    if (k === 'class') node.className = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else if (k === 'value') node.value = v
    else if (v === true) node.setAttribute(k, '')
    else if (v != null && v !== false) node.setAttribute(k, v)
  }
  for (const c of children || []) if (c != null && c !== false) node.append(c)
  return node
}
