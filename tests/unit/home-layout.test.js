// The home page as a document (ADR-0048): shared/home-layout.mjs, the rules for its layout and the
// cards pinned to it, and the guide that teaches the AI to make them.

import { describe, it, expect } from 'vitest'
import * as hl from '../../shared/home-layout.mjs'
import { programError } from '../../app/bg/ai/genui-page.js'
import { parseGenUi } from '../../app/lib/genui/parse.mjs'
import { HOME_WIDGETS as LIBRARY_WIDGETS } from '../../app/lib/genui/library.mjs'
import { dashboardGuide, genuiComponentsGuide, CAPABILITIES, JOB_CAPS } from '../../app/bg/ai/search-execute.mjs'
import { readsPrivate } from '../../app/bg/ai/egress.mjs'
import { VAULT_TOOL_PERMS } from '../../app/bg/ai/vault-tools.mjs'
import { sectionLimits, LIMITS, MAX_LIMIT, dashboard } from '../../shared/home-dashboard.mjs'

const SPACE = 'ab'.repeat(32)
const CARD = 'root = Stack([CardHeader("Reading list", "3 to go", "book"), TextContent("The Overstory")])'
const T0 = '2026-11-11T10:00:00.000Z'
const T1 = '2026-11-11T11:00:00.000Z'
const ORIGIN = { stage: 'sidebar', chat: 'chat1', space: SPACE }

describe('where the home page is kept', () => {
  it('is the user’s own, per Space, in the Vault', () => {
    expect(hl.layoutPath(SPACE)).toBe(`/.vault/home/spaces/${SPACE}/layout.json`)
    expect(hl.cardsPrefix(SPACE)).toBe(`/.vault/home/spaces/${SPACE}/cards/`)
    expect(hl.cardPath(SPACE, 'mwcabc1234')).toBe(`/.vault/home/spaces/${SPACE}/cards/mwcabc1234.json`)
    // A page with no Space has a home of its own.
    expect(hl.layoutPath(null)).toBe('/.vault/home/spaces/none/layout.json')
    expect(hl.layoutPath()).toBe('/.vault/home/spaces/none/layout.json')
  })

  it('takes no path from a Space key or a card id that isn’t one', () => {
    expect(() => hl.homePrefix('../../x')).toThrow(/Not a Space key/)
    expect(() => hl.homePrefix('none')).toThrow(/Not a Space key/)
    expect(() => hl.cardPath(SPACE, '../layout')).toThrow(/Not a card id/)
    expect(() => hl.cardPath(SPACE, 'A')).toThrow(/Not a card id/)
    expect(hl.isCardId(hl.newCardId())).toBe(true)
    expect(hl.isCardId(hl.newCardId(0, () => 0))).toBe(true)
    expect(hl.newCardId(1, () => 0.5)).not.toBe(hl.newCardId(2, () => 0.5))
  })
})

describe('a Space’s own home (ADR-0048 amendment)', () => {
  it('keeps a shared Space’s home page in its Space Library, the same records', () => {
    expect(hl.LIB_LAYOUT).toBe('/home/layout.json')
    expect(hl.LIB_CARDS).toBe('/home/cards/')
    expect(hl.cardFile('mwcabc1234')).toBe('mwcabc1234.json')
    expect(() => hl.cardFile('../x')).toThrow(/Not a card id/)
  })

  it('moves the home page in when the Space is shared, and only real records', () => {
    const layout = hl.makeLayout('root = Stack([HomeNotes()])', null, T0)
    const card = hl.makeCard({ id: 'mwcabc1234', source: CARD }, null, T0)
    expect(hl.shareHomePaths({ home: { layout, cards: [card, { type: 'other', id: 'mwcabc9999' }] } })).toEqual([
      { path: '/home/layout.json', value: layout },
      { path: '/home/cards/mwcabc1234.json', value: card },
    ])
    expect(hl.shareHomePaths({})).toEqual([])
    expect(hl.hasOwnHome({ layout, cards: [] })).toBe(true)
    expect(hl.hasOwnHome({ layout: hl.makeLayout(null, null, T0), cards: [card] })).toBe(true)
    // A layout put back to the default is nothing of its own.
    expect(hl.hasOwnHome({ layout: hl.makeLayout(null, layout, T1), cards: [] })).toBe(false)
    expect(hl.hasOwnHome()).toBe(false)
  })

  it('gives a household a board that draws, with its lists, calendar, photos and people', () => {
    const src = hl.householdLayout()
    expect(programError(src)).toBe('')
    const names = hl.widgetsIn(parseGenUi(src).root)
    expect(names.filter((w) => w.name === 'HomeList').map((w) => w.title)).toEqual(['Chores', 'Groceries'])
    for (const name of ['HomeGreeting', 'HomeNeedsYou', 'HomeEvents', 'HomePhotos', 'HomeMembers', 'HomeCards', 'HomePins']) {
      expect(names.some((w) => w.name === name), name).toBe(true)
    }
    // Titles are quoted, so one can't break out of its string.
    const odd = hl.householdLayout(['Say "hi"', '', 'x'.repeat(200)])
    expect(programError(odd)).toBe('')
    expect(hl.widgetsIn(parseGenUi(odd).root).filter((w) => w.name === 'HomeList').map((w) => w.title)).toEqual([
      'Say "hi"',
      'x'.repeat(hl.MAX_LIST_TITLE - 1) + '…',
    ])
  })

  it('says whose home page it is', () => {
    expect(hl.homeOwner({})).toEqual({ name: '', shared: false, people: 1, canChange: true })
    expect(hl.homeOwner({ name: 'Home', shared: true, writable: false, members: 4 })).toEqual({
      name: 'Home',
      shared: true,
      people: 4,
      canChange: false,
    })
  })
})

describe('the default layout', () => {
  it('draws, and places every part of the page once', () => {
    expect(programError(hl.DEFAULT_LAYOUT)).toBe('')
    const { root, meta } = parseGenUi(hl.DEFAULT_LAYOUT)
    expect(meta.errors).toEqual([])
    expect(root.typeName).toBe('Stack')
    for (const name of hl.DEFAULT_WIDGETS) {
      expect(hl.DEFAULT_LAYOUT.split(`${name}(`).length - 1, name).toBe(1)
      expect(hl.placesWidget(hl.DEFAULT_LAYOUT, name)).toBe(true)
    }
    // The board is the dashboard as it was: cards packed in three columns.
    const board = root.props.children[3]
    expect(board.typeName).toBe('Columns')
    expect(board.props.count).toBe(3)
    expect(board.props.children.map((c) => c.typeName)).toEqual([
      'HomeNotifications',
      'HomeJobs',
      'HomeEvents',
      'HomeNotes',
      'HomeFiles',
      'HomeCards',
    ])
  })

  it('names the widgets the library has', () => {
    expect([...hl.HOME_WIDGETS].sort()).toEqual([...LIBRARY_WIDGETS].sort())
  })

  it('is what a Space with no layout, or a broken record, shows', () => {
    expect(hl.layoutView(null)).toEqual({ source: hl.DEFAULT_LAYOUT, custom: false, canRestore: false })
    expect(hl.layoutView({ type: 'other', source: 'x' }).custom).toBe(false)
    expect(hl.layoutView({ type: hl.LAYOUT_TYPE, source: '' }).source).toBe(hl.DEFAULT_LAYOUT)
    expect(hl.layoutSource({ type: hl.LAYOUT_TYPE, source: 'root = Stack([HomeNotes()])' })).toBe('root = Stack([HomeNotes()])')
  })
})

describe('programs', () => {
  it('stores a program without its fence', () => {
    expect(hl.cleanSource('```openui-lang\nroot = Stack([])\n```', 100)).toBe('root = Stack([])')
    expect(hl.cleanSource('  root = Stack([])\r\n', 100)).toBe('root = Stack([])')
    expect(() => hl.cleanSource('   ', 100, 'The card')).toThrow(/The card is empty/)
    expect(() => hl.cleanSource('x'.repeat(101), 100, 'The layout')).toThrow(/The layout is 101 characters; the most is 100/)
  })

  it('finds a widget only where it is called', () => {
    expect(hl.placesWidget('root = Stack([HomeCards()])', 'HomeCards')).toBe(true)
    expect(hl.placesWidget('root = Stack([HomeCards ()])', 'HomeCards')).toBe(true)
    expect(hl.placesWidget('root = Stack([TextContent("HomeCards() go here")])', 'HomeCards')).toBe(false)
    expect(hl.placesWidget('root = Stack([MyHomeCards()])', 'HomeCards')).toBe(false)
    expect(hl.placesWidget('root = Stack([HomeNotes()])', 'HomeCards')).toBe(false)
  })

  it('finds every widget in a parsed layout, also in a tab that isn’t open', () => {
    const { root } = parseGenUi(`root = Stack([HomeGreeting(), tabs])
tabs = Tabs([today, mine])
today = TabItem("today", "Today", [HomeNotes(10), HomeJobs()])
mine = TabItem("cards", "My cards", [Columns([HomeCards()], 2)])`)
    expect(hl.widgetsIn(root)).toEqual([
      { name: 'HomeGreeting' },
      { name: 'HomeNotes', limit: 10 },
      { name: 'HomeJobs' },
      { name: 'HomeCards' },
    ])
    expect(hl.widgetsIn(parseGenUi(hl.DEFAULT_LAYOUT).root).map((w) => w.name)).toEqual(hl.DEFAULT_WIDGETS)
    // A HomeList names its Note.
    expect(hl.widgetsIn(parseGenUi('root = Stack([HomeList("Chores", 5), HomeList("  Groceries ")])').root)).toEqual([
      { name: 'HomeList', limit: 5, title: 'Chores' },
      { name: 'HomeList', title: 'Groceries' },
    ])
    // Text that names a widget places nothing, and no program places nothing.
    expect(hl.widgetsIn(parseGenUi('root = Stack([TextContent("HomeCards() go here")])').root)).toEqual([])
    expect(hl.widgetsIn(null)).toEqual([])
  })

  it('names a card after its heading when it comes without a title', () => {
    expect(hl.cardTitle('', CARD)).toBe('Reading list')
    expect(hl.cardTitle('  My  books ', CARD)).toBe('My books')
    expect(hl.cardTitle(null, 'root = Stack([Header("Trip \\"plan\\"")])')).toBe('Trip "plan"')
    expect(hl.cardTitle(null, 'root = Stack([TextContent("Hello", "large-heavy")])')).toBe('Hello')
    expect(hl.cardTitle(null, 'root = Stack([Stat("Users", "12")])')).toBe('Users')
    expect(hl.cardTitle(null, 'root = Stack([BarChart(["a"], [Series("s", [1])])])')).toBe('Card')
    expect(hl.cardTitle('x'.repeat(200), CARD)).toHaveLength(hl.MAX_TITLE)
  })
})

describe('cards', () => {
  const make = (fields, prev, now = T0) => hl.makeCard({ id: 'mwcabc1234', source: CARD, ...fields }, prev, now)

  it('makes a card record', () => {
    const rec = make({ title: 'Books' })
    expect(rec).toEqual({
      type: hl.CARD_TYPE,
      id: 'mwcabc1234',
      title: 'Books',
      source: CARD,
      order: Date.parse(T0),
      createdAt: T0,
      updatedAt: T0,
    })
    expect(hl.isCard(rec)).toBe(true)
    expect(() => hl.makeCard({ id: 'mwcabc1234' })).toThrow(/empty/)
    expect(() => hl.makeCard({ id: '../x', source: CARD })).toThrow(/Not a card id/)
    expect(() => make({ source: 'x'.repeat(hl.MAX_CARD_SOURCE + 1) })).toThrow(/the most is/)
  })

  it('keeps what a change leaves out: its place, when it was made, its width, its chats', () => {
    const first = hl.withOrigin(make({ title: 'Books', wide: true }), ORIGIN, { made: true, now: T0 })
    const next = hl.makeCard({ id: first.id, source: CARD + '\n' }, first, T1)
    expect(next).toMatchObject({ title: 'Books', order: first.order, createdAt: T0, updatedAt: T1, wide: true })
    expect(next.ai).toEqual([{ stage: 'sidebar', chat: 'chat1', space: SPACE, at: T0, made: true }])
    // A new title, and narrow again.
    const renamed = hl.makeCard({ id: first.id, title: 'Shelf', wide: false }, first, T1)
    expect(renamed.title).toBe('Shelf')
    expect(renamed.wide).toBeUndefined()
  })

  it('records the chat that made or changed it, ids only', () => {
    const made = hl.withOrigin(make({}), ORIGIN, { made: true, now: T0 })
    const changed = hl.withOrigin(made, { stage: 'sidebar', chat: 'chat2' }, { now: T1 })
    expect(changed.ai.map((o) => [o.chat, !!o.made])).toEqual([
      ['chat2', false],
      ['chat1', true],
    ])
    expect(hl.withOrigin(made, null)).toBe(made)
    // Not an origin (a sidebar one names its chat): the record is left as it is.
    expect(hl.withOrigin(make({}), { chat: 'chat1' }).ai).toBeUndefined()
  })

  it('shows them in order, and leaves out what isn’t a card', () => {
    const a = make({ id: 'aaaaaa1', order: 3 })
    const b = make({ id: 'bbbbbb1', order: 1 })
    const c = make({ id: 'cccccc1', order: 2 })
    expect(hl.sortCards([a, b, c, null, { type: hl.CARD_TYPE, id: 'x' }, { ...a, type: 'nomad/note' }]).map((x) => x.id)).toEqual([
      'bbbbbb1',
      'cccccc1',
      'aaaaaa1',
    ])
    // The same place: the id decides, so every Device shows the same order.
    expect(hl.sortCards([make({ id: 'zzzzzz1', order: 1 }), b]).map((x) => x.id)).toEqual(['bbbbbb1', 'zzzzzz1'])
  })

  it('moves a card one place by swapping two records', () => {
    const list = [make({ id: 'aaaaaa1', order: 1 }), make({ id: 'bbbbbb1', order: 2 }), make({ id: 'cccccc1', order: 3 })]
    const apply = (changed) => hl.sortCards(list.map((c) => changed.find((x) => x.id === c.id) || c)).map((c) => c.id)
    const later = hl.moveCard(list, 'aaaaaa1', 1, T1)
    expect(later.map((c) => [c.id, c.order, c.updatedAt])).toEqual([
      ['aaaaaa1', 2, T1],
      ['bbbbbb1', 1, T1],
    ])
    expect(apply(later)).toEqual(['bbbbbb1', 'aaaaaa1', 'cccccc1'])
    expect(apply(hl.moveCard(list, 'cccccc1', -1))).toEqual(['aaaaaa1', 'cccccc1', 'bbbbbb1'])
    // Nowhere to go.
    expect(hl.moveCard(list, 'aaaaaa1', -1)).toEqual([])
    expect(hl.moveCard(list, 'cccccc1', 1)).toEqual([])
    expect(hl.moveCard(list, 'nope123', 1)).toEqual([])
    // Two cards made in the same millisecond still swap.
    const tie = [make({ id: 'aaaaaa1', order: 5 }), make({ id: 'bbbbbb1', order: 5 })]
    const moved = hl.moveCard(tie, 'aaaaaa1', 1)
    expect(hl.sortCards(tie.map((c) => moved.find((x) => x.id === c.id) || c)).map((c) => c.id)).toEqual(['bbbbbb1', 'aaaaaa1'])
  })
})

describe('the layout', () => {
  const A = 'root = Stack([HomeGreeting(), HomeNotes()])'
  const B = 'root = Stack([HomeGreeting(), HomeEvents(), HomeCards()])'

  it('keeps the layout it replaces, one step back', () => {
    const first = hl.makeLayout(A, null, T0)
    expect(first).toEqual({ type: hl.LAYOUT_TYPE, source: A, updatedAt: T0, previous: { source: null, updatedAt: T0 } })
    expect(hl.layoutView(first)).toEqual({ source: A, custom: true, canRestore: true })
    const second = hl.makeLayout(B, first, T1)
    expect(second.previous).toEqual({ source: A, updatedAt: T0 })
    // The same layout again changes nothing but the time: the step back stays.
    expect(hl.makeLayout(B, second, T1).previous).toEqual({ source: A, updatedAt: T0 })
  })

  it('goes back to the default, and can come back', () => {
    const custom = hl.makeLayout(A, null, T0)
    const reset = hl.makeLayout(null, custom, T1)
    expect(reset).toMatchObject({ source: null, previous: { source: A, updatedAt: T0 } })
    expect(hl.isLayout(reset)).toBe(true)
    expect(hl.layoutView(reset)).toEqual({ source: hl.DEFAULT_LAYOUT, custom: false, canRestore: true })
    const back = hl.restoreLayout(reset, T1)
    expect(back).toMatchObject({ source: A, previous: { source: null } })
    // Restoring twice is where the user was.
    expect(hl.restoreLayout(back, T1)).toMatchObject({ source: null, previous: { source: A } })
    expect(hl.restoreLayout(null)).toBeNull()
    expect(hl.restoreLayout({ type: hl.LAYOUT_TYPE, source: A, updatedAt: T0 })).toBeNull()
  })

  it('refuses a layout that is empty or too long', () => {
    expect(() => hl.makeLayout('', null)).toThrow(/The layout is empty/)
    expect(() => hl.makeLayout('x'.repeat(hl.MAX_LAYOUT_SOURCE + 1), null)).toThrow(/the most is 40000/)
  })
})

describe('what the AI reads and is taught', () => {
  it('gives the model the layout, the cards and where they show', () => {
    const card = hl.makeCard({ id: 'mwcabc1234', source: CARD, wide: true }, null, T0)
    expect(hl.homeForModel(null, [card])).toEqual({
      space: { shared: false },
      layout: 'default',
      openui: hl.DEFAULT_LAYOUT,
      cards: [{ id: 'mwcabc1234', title: 'Reading list', wide: true, openui: CARD }],
      cardsShown: 'where the layout places HomeCards()',
      maxCards: hl.MAX_CARDS,
    })
    const custom = hl.makeLayout('root = Stack([HomeNotes()])', null, T0)
    expect(hl.homeForModel(custom, [])).toMatchObject({ layout: 'custom', cards: [], cardsShown: 'after the layout, which has no HomeCards()' })
  })

  it('has a guide with the widgets, the default layout and examples that draw', () => {
    const g = dashboardGuide()
    expect(g.id).toBe('dashboard')
    expect(g.markdown.match(/^## /gm).length).toBe(1)
    for (const name of hl.HOME_WIDGETS) expect(g.markdown).toContain(`${name}(`)
    expect(g.markdown).toContain(hl.DEFAULT_LAYOUT)
    expect(g.markdown).toContain(String(hl.MAX_CARDS))
    const programs = [...g.markdown.matchAll(/```\n([\s\S]*?)\n```/g)].map((m) => m[1])
    expect(programs.length).toBe(4)
    for (const p of programs) expect(programError(p), p).toBe('')
    // It teaches a Space's own home, and that a shared one is everyone's.
    expect(g.markdown).toContain(hl.householdLayout())
    expect(g.markdown).toMatch(/shared Space has one for everyone in it/)
  })

  it('tells the model whose home page it is, and whether the user may change it', () => {
    expect(hl.homeForModel(null, [], { name: 'Work', shared: false }).space).toEqual({ name: 'Work', shared: false })
    const shared = hl.homeForModel(null, [], { name: 'The Flat', shared: true, writable: true, members: 3 }).space
    expect(shared).toMatchObject({ name: 'The Flat', shared: true, people: 3, canChange: true })
    expect(shared.note).toMatch(/all 3 people in it see this home page/)
    const alone = hl.homeForModel(null, [], { shared: true, writable: true, members: 1 }).space
    expect(alone.note).toMatch(/everyone who joins it sees/)
    const viewer = hl.homeForModel(null, [], { name: 'The Flat', shared: true, writable: false, members: 3 }).space
    expect(viewer).toMatchObject({ canChange: false })
    expect(viewer.note).toMatch(/can only view it/)
  })

  it('has a guide with the arguments of the components the every-turn prompt only names', () => {
    const g = genuiComponentsGuide()
    expect(g.id).toBe('genui-components')
    expect(g.markdown.match(/^## /gm).length).toBe(1)
    for (const name of ['Grid(', 'Accordion(', 'Avatar(', 'List(', 'Form(', 'Slider(', 'Calendar(']) expect(g.markdown).toContain(`\n${name}`)
    expect(g.markdown).toContain('rocket') // the icon names
    expect(g.markdown).not.toContain('HomeNotes(')
  })

  it('gives the capabilities to the user’s own AI only, behind two permissions', () => {
    const names = ['getDashboard', 'pinDashboardCard', 'removeDashboardCard', 'setDashboard']
    for (const name of names) {
      const cap = CAPABILITIES.find((c) => c.name === name)
      expect(cap, name).toBeTruthy()
      expect(cap.gates).toEqual({ personal: true })
      // A Job runs with nobody watching: the home page isn't its to change.
      expect(JOB_CAPS.has(name)).toBe(false)
    }
    expect(VAULT_TOOL_PERMS.getDashboard).toBe('dashboardRead')
    expect(VAULT_TOOL_PERMS.pinDashboardCard).toBe('dashboardWrite')
    expect(VAULT_TOOL_PERMS.removeDashboardCard).toBe('dashboardWrite')
    expect(VAULT_TOOL_PERMS.setDashboard).toBe('dashboardWrite')
    // Cards hold what earlier chats put there (ADR-0037).
    expect(readsPrivate('getDashboard')).toBe(true)
    expect(readsPrivate('pinDashboardCard')).toBe(false)
  })
})

describe('rows a layout asks for', () => {
  it('takes a whole number from 1 to the most, for the sections a layout sizes', () => {
    expect(sectionLimits(null)).toEqual(LIMITS)
    expect(sectionLimits({ notes: 10, events: 3 })).toMatchObject({ notes: 10, events: 3, assets: LIMITS.assets })
    expect(sectionLimits({ notes: 500 }).notes).toBe(MAX_LIMIT)
    expect(sectionLimits({ notes: 0, events: -2, assets: 'many', next: 2.6 })).toMatchObject({
      notes: LIMITS.notes,
      events: LIMITS.events,
      assets: LIMITS.assets,
      next: 3,
    })
    // Needs you is never cut short by a layout.
    expect(sectionLimits({ waiting: 1 }).waiting).toBe(LIMITS.waiting)
  })

  it('gives the dashboard that many', () => {
    const notes = Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`,
      body: `# Note ${i}`,
      updatedAt: new Date(Date.parse(T0) - i * 60000).toISOString(),
    }))
    expect(dashboard({ notes }, { now: '2026-11-11T10:00' }).notes).toHaveLength(LIMITS.notes)
    expect(dashboard({ notes }, { now: '2026-11-11T10:00', limits: { notes: 10 } }).notes).toHaveLength(10)
    expect(dashboard({ notes }, { now: '2026-11-11T10:00', limits: { notes: 2 } }).notes).toHaveLength(2)
  })
})
