// A Job's card on the home page (ADR-0048 amendment): the `home` grant (shared/jobs.mjs), the card
// it keeps (shared/home-layout.mjs makeJobCard, withJobState), and setJobCard, the capability that
// only a Job with the grant gets (search-execute.mjs).

import { describe, it, expect } from 'vitest'
import * as hl from '../../shared/home-layout.mjs'
import { normalizeWrites, writeCaps, writePermissions, describeWrites, addedWrites, makeJob } from '../../shared/jobs.mjs'
import { buildCatalog, assertCallAllowed, search, CAPABILITIES, JOB_CAPS, dashboardGuide } from '../../app/bg/ai/search-execute.mjs'
import { handleMcpHttp, openTurn, closeTurn, TURN_HEADER } from '../../app/bg/ai/localhost-mcp.mjs'
import { jobPermitFor } from '../../app/bg/ai/vault-tools.mjs'
import { toolSummary } from '../../app/bg/ai/tool-summary.mjs'
import { programError } from '../../app/bg/ai/genui-page.js'

const JOB = { id: 'job-mwc1abc-x1y2z3', title: 'Morning briefing' }
const CARD = 'root = Stack([CardHeader("Morning briefing", "Tuesday", "sun"), TextContent("Rain after 3pm.")])'
const CARD2 = 'root = Stack([CardHeader("Morning briefing", "Wednesday", "sun"), TextContent("Sunny all day.")])'
const T0 = '2026-11-12T08:00:00.000Z'
const T1 = '2026-11-13T08:00:00.000Z'
const names = (c) => c.capabilities.map((x) => x.name)

describe('the home grant', () => {
  it('turns on setJobCard and nothing else, and keeps old records as they were', () => {
    const w = normalizeWrites({ home: true })
    expect(w).toEqual({ drives: [], notes: false, reader: false, home: true })
    expect(writeCaps(w)).toEqual(['setJobCard'])
    // It needs no permission: the capability is there only with the grant.
    expect(writePermissions(w)).toEqual([])
    expect(describeWrites(w)).toEqual(['a card on your home page'])
    expect(normalizeWrites({ notes: true, home: false })).not.toHaveProperty('home')
    expect(normalizeWrites({ home: false })).toBe(null)
  })

  it('is asked for when the AI adds it to a Job', () => {
    const prev = normalizeWrites({ notes: true })
    expect(addedWrites(prev, normalizeWrites({ notes: true, home: true }))).toEqual({
      drives: [],
      notes: false,
      reader: false,
      home: true,
    })
    expect(addedWrites(normalizeWrites({ home: true }), normalizeWrites({ home: true }))).toBe(null)
  })

  it('is kept on the Job record', () => {
    const job = makeJob({ id: JOB.id, prompt: 'Sum up my day', writes: { home: true } }, null, new Date(T0))
    expect(job.writes).toEqual({ drives: [], notes: false, reader: false, home: true })
  })
})

describe('setJobCard: who gets it', () => {
  const job = (extra) => buildCatalog({ personal: true, remote: true, job: { extra } })

  it('is a Job’s only, and only with the grant', () => {
    const cap = CAPABILITIES.find((c) => c.name === 'setJobCard')
    expect(cap.gates).toEqual({ job: true })
    expect(JOB_CAPS.has('setJobCard')).toBe(false)
    expect(names(job([]))).not.toContain('setJobCard')
    expect(() => assertCallAllowed('setJobCard', 'setJobCard', job([]))).toThrow(/not available/)
    const granted = job(writeCaps(normalizeWrites({ home: true })))
    expect(names(granted)).toContain('setJobCard')
    expect(() => assertCallAllowed('setJobCard', 'setJobCard', granted)).not.toThrow()
    // The user's own AI and a page's chat never get it: they pin cards with pinDashboardCard.
    for (const o of [{ personal: true, tab: true }, { personal: true }, { personal: false }]) {
      expect(names(buildCatalog(o))).not.toContain('setJobCard')
    }
  })

  it('doesn’t give a Job the user’s dashboard capabilities', () => {
    const granted = names(job(['setJobCard']))
    for (const n of ['getDashboard', 'pinDashboardCard', 'removeDashboardCard', 'setDashboard']) expect(granted).not.toContain(n)
    // Nor the permissions behind them.
    const permit = jobPermitFor(normalizeWrites({ home: true }))
    return Promise.all([permit('dashboardWrite'), permit('dashboardRead')]).then((r) => expect(r).toEqual([false, false]))
  })

  it('says what it is doing', () => {
    expect(toolSummary('setJobCard', { openui: CARD })).toBe('Drawing its card on your home page')
    expect(toolSummary('setJobCard', { remove: true })).toBe('Taking its card off your home page')
    expect(toolSummary('execute', { code: 'await nomad.setJobCard({ openui })' })).toBe(
      'Running code to draw its card on your home page'
    )
  })

  it('is in the dashboard guide, with saveJob’s grant', () => {
    const g = dashboardGuide().markdown
    expect(g).toContain('setJobCard')
    expect(g).toContain('home: true')
    const saveJob = CAPABILITIES.find((c) => c.name === 'saveJob')
    expect(saveJob.inputSchema.properties.writes.properties.home).toEqual({ type: 'boolean' })
  })
})

describe('the card a Job keeps', () => {
  it('names the Job and when it drew it', () => {
    const card = hl.makeJobCard(JOB, { id: 'mwcabc1234', source: CARD }, null, T0)
    expect(card).toMatchObject({
      type: hl.CARD_TYPE,
      id: 'mwcabc1234',
      title: 'Morning briefing',
      source: CARD,
      job: { id: JOB.id, title: 'Morning briefing', at: T0 },
      createdAt: T0,
    })
    expect(card).not.toHaveProperty('wide')
    expect(hl.isCard(card)).toBe(true)
    expect(programError(card.source)).toBe('')
  })

  it('is one card per Job: the next run replaces its program and keeps the user’s changes', () => {
    const first = hl.makeJobCard(JOB, { id: 'mwcabc1234', source: CARD, wide: true }, null, T0)
    expect(first.wide).toBe(true)
    const narrowed = hl.makeCard({ id: first.id, wide: false }, first, T0)
    expect(narrowed.wide).toBeUndefined()
    expect(narrowed.job).toEqual(first.job) // the user's change keeps whose card it is
    const other = hl.makeCard({ id: 'mwcxyz9876', source: CARD }, null, T0)
    expect(hl.jobCardOf([other, narrowed], JOB.id)).toBe(narrowed)
    expect(hl.jobCardOf([other], JOB.id)).toBe(null)
    // The next run: a new id is offered, the old card is kept; `wide` from the Job counts only on a new card.
    const next = hl.makeJobCard({ ...JOB, title: 'Briefing' }, { id: 'zzzzzz0000', source: CARD2, wide: true }, narrowed, T1)
    expect(next).toMatchObject({ id: first.id, source: CARD2, order: first.order, createdAt: T0, updatedAt: T1 })
    expect(next.wide).toBeUndefined()
    expect(next.job).toEqual({ id: JOB.id, title: 'Briefing', at: T1 })
    // The card's own title stays, unless the run names one.
    expect(next.title).toBe('Morning briefing')
    expect(hl.makeJobCard(JOB, { source: CARD2, title: 'Today' }, next, T1).title).toBe('Today')
  })

  it('takes no Job that isn’t one', () => {
    expect(() => hl.makeJobCard({ id: 'NOPE!' }, { id: 'mwcabc1234', source: CARD }, null, T0)).toThrow(/Not a Job/)
    expect(hl.cleanJobRef({ id: 'x' })).toBe(null)
    expect(hl.cleanJobRef(null)).toBe(null)
    expect(hl.cleanJobRef({ id: JOB.id, title: '', at: 'soon' })).toEqual({ id: JOB.id, title: 'Job' })
    // A stored card with a bad ref loses it rather than failing.
    const card = hl.makeCard({ id: 'mwcabc1234', source: CARD, job: { id: 1 } }, null, T0)
    expect(card).not.toHaveProperty('job')
  })

  it('tells the AI which cards a Job keeps', () => {
    const card = hl.makeJobCard(JOB, { id: 'mwcabc1234', source: CARD }, null, T0)
    expect(hl.homeForModel(null, [card]).cards).toEqual([
      { id: 'mwcabc1234', title: 'Morning briefing', job: { id: JOB.id, title: 'Morning briefing' }, openui: CARD },
    ])
  })
})

describe('what the page shows under a Job’s card', () => {
  const card = hl.makeJobCard(JOB, { id: 'mwcabc1234', source: CARD }, null, T0)
  const plain = hl.makeCard({ id: 'mwcxyz9876', source: CARD }, null, T0)

  it('shows the Job as it is now', () => {
    const [c, p] = hl.withJobState([card, plain], [{ ...JOB, title: 'Daily briefing', lastRun: { status: 'ok' } }])
    expect(c.job).toEqual({ id: JOB.id, title: 'Daily briefing', at: T0 })
    expect(p).toBe(plain)
  })

  it('says when it is running, when its last run failed, and when the Job is gone', () => {
    expect(hl.withJobState([card], [{ ...JOB, running: true }])[0].job.running).toBe(true)
    expect(hl.withJobState([card], [{ ...JOB, queued: true }])[0].job.running).toBe(true)
    expect(hl.withJobState([card], [{ ...JOB, lastRun: { status: 'error' } }])[0].job.failed).toBe(true)
    expect(hl.withJobState([card], [])[0].job).toEqual({ id: JOB.id, title: 'Morning briefing', at: T0, gone: true })
    expect(hl.withJobState(null, [])).toEqual([])
  })
})

// The loopback MCP (localhost-mcp.mjs) serves search and execute from the same catalog as a chat
// turn: another program on this computer gets the user's AI's catalog, and a Job's run on a CLI
// runtime (Claude) sends its turn's token and gets the Job's.
describe('over the loopback MCP', () => {
  const call = (callTool, tool, args, token = null) =>
    handleMcpHttp({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json', ...(token ? { [TURN_HEADER]: token } : {}) },
      remoteAddress: '127.0.0.1',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
      callTool,
    }).then((res) => {
      const { result } = JSON.parse(res.body)
      return { isError: result.isError, text: result.content[0].text }
    })
  // What ai.ts callLocalTool does for search: the turn's catalog, or the user's AI's.
  const outside = buildCatalog({ personal: true })
  const searchIn = async (name, args, turn) => search(args, turn ? turn.toolOpts.catalog : outside)

  it('lets another program make a Job that keeps a card, but not draw one itself', async () => {
    const saveJob = await call(searchIn, 'search', { entity: 'capability:saveJob' })
    expect(saveJob.isError).toBe(false)
    expect(saveJob.text).toContain('"home"')
    const guide = await call(searchIn, 'search', { entity: 'guide:dashboard#a-job-s-card-setjobcard' })
    expect(guide.isError).toBe(false)
    expect(guide.text).toContain('setJobCard({ openui })')
    const found = await call(searchIn, 'search', { entity: 'capability:setJobCard' })
    expect(found.isError).toBe(true)
  })

  it('gives a Job’s run on a CLI runtime its card capability through its turn', async () => {
    const catalog = buildCatalog({ personal: true, remote: true, job: { extra: writeCaps(normalizeWrites({ home: true })) } })
    const token = openTurn({ sender: null, toolOpts: { catalog, job: { id: JOB.id, title: JOB.title } } })
    try {
      const found = await call(searchIn, 'search', { entity: 'capability:setJobCard' }, token)
      expect(found.isError).toBe(false)
      expect(JSON.parse(found.text).details[0].entity).toBe('capability:setJobCard')
      expect(() => assertCallAllowed('setJobCard', 'setJobCard', catalog)).not.toThrow()
    } finally {
      closeTurn(token)
    }
  })
})
