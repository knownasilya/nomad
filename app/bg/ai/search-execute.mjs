// search and execute: the two tools a Nomad chat turn offers the model.
// Capabilities, guide sections, and page tools stay behind search.
// execute runs one module whose only import is nomad:runtime.
//
// No Electron imports — unit tests and the utility-process worker both load this file.

import vm from 'node:vm'
import { API_REFERENCE } from './api-reference.mjs'

export const DOMAINS = ['capability', 'guide', 'page', 'drive']

const GUIDE_BUDGET = 12000
const MAX_HITS = 8
const MAX_CALLS = 3
const MAX_ENTITIES = 10
const MAX_CODE = 32_000
const MAX_RESULT = 100_000

// Heading prefix → stable guide id. New `##` sections still appear; the id is slugged.
const GUIDE_IDS = [
  ['nomad.page', 'nomad.page'],
  ['nomad.fs', 'nomad.fs'],
  ['nomad.shell', 'nomad.shell'],
  ['nomad.ai', 'nomad.ai'],
  ['nomad.panes', 'nomad.panes'],
  ['nomad.peersockets', 'nomad.peersockets'],
  ['Page-provided tools', 'webmcp'],
  ['After using tools', 'after-tools'],
  ['Resolving which file', 'resolve-file'],
  ['Building an SPA', 'spa'],
]

const DOMAIN_COPY = {
  capability: 'Read and write the current Drive, fetch an http(s) URL, and read or screenshot the open page.',
  guide: 'Sections of the Nomad API reference. Open one with entity guide:<id>.',
  page: 'Tools the current page registered. Open one with entity page:<name>.',
  drive:
    'Drives their owners listed for public search (what nomad://search finds), with their hyper:// URLs. ' +
    'Search by topic or words. Nothing here when the search crawler is off.',
}

export const CAPABILITIES = [
  {
    name: 'readDriveFile',
    description: 'Read the text content of a file in the current Drive.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path to the file, e.g. /index.html' } },
      required: ['path'],
    },
  },
  {
    name: 'listDriveFiles',
    description: 'List files and directories at a path in the current Drive.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory path to list, e.g. / or /src' } },
      required: ['path'],
    },
  },
  {
    name: 'fetchUrl',
    description: 'Fetch the text content of an http or https URL.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The URL to fetch (http or https only)' } },
      required: ['url'],
    },
  },
  {
    name: 'writeDriveFile',
    description: 'Write text content to a file in the current Drive. Requires user permission.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to write, e.g. /index.html' },
        content: { type: 'string', description: 'Text content to write' },
      },
      required: ['path', 'content'],
    },
    gates: { write: true },
  },
  {
    name: 'readCurrentPage',
    description:
      'Read the visible text content of the page currently open in this tab. Works on any page — ' +
      'http/https sites included, not just hyper:// Drives. For a hyper:// Drive, prefer ' +
      'readDriveFile/listDriveFiles to read its actual source files instead of the rendered page.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    gates: { renderer: true },
  },
  {
    name: 'screenshotCurrentPage',
    description:
      'Take a screenshot of the page currently open in this tab and view it — use this for ' +
      "visual questions readCurrentPage's text extraction can't answer (layout, images, " +
      'charts, how something looks).',
    inputSchema: { type: 'object', properties: {}, required: [] },
    gates: { vision: true, renderer: true },
  },
]

const RUNTIME_IMPORT = /^import\s+\{\s*nomad\s*\}\s+from\s+['"]nomad:runtime['"]\s*;?/

export function capabilityCode(name) {
  return (
    `import { nomad } from 'nomad:runtime'\n\n` +
    `export default async function main(params) {\n` +
    `\treturn await nomad.${name}(params)\n` +
    `}\n`
  )
}

export function pageToolCode(name) {
  return (
    `import { nomad } from 'nomad:runtime'\n\n` +
    `export default async function main(params) {\n` +
    `\treturn await nomad.page.${name}(params)\n` +
    `}\n`
  )
}

export function visibleCapabilities({ allowWrite = true, allowVision = false, remote = false } = {}) {
  return CAPABILITIES.filter((cap) => {
    if (cap.gates?.write && !allowWrite) return false
    if (cap.gates?.vision && !allowVision) return false
    if (cap.gates?.renderer && remote) return false
    return true
  })
}

export function splitGuides(markdown = API_REFERENCE) {
  const text = String(markdown).replace(/^\uFEFF/, '')
  const chunks = text.split(/\n(?=## )/)
  const guides = []
  const preamble = chunks[0].startsWith('## ') ? '' : chunks.shift()
  if (preamble && preamble.trim()) {
    guides.push(guideRecord('overview', 'Overview', preamble.trim()))
  }
  for (const chunk of chunks) {
    const nl = chunk.indexOf('\n')
    const heading = (nl === -1 ? chunk : chunk.slice(0, nl)).replace(/^##\s+/, '').trim()
    const body = nl === -1 ? '' : chunk.slice(nl + 1)
    const title = heading.split('—')[0].trim()
    guides.push(guideRecord(guideId(title), title, `## ${heading}\n\n${body}`.trim()))
  }
  return guides
}

function guideId(title) {
  for (const [prefix, id] of GUIDE_IDS) {
    if (title === prefix || title.startsWith(prefix)) return id
  }
  return slug(title) || 'guide'
}

function guideRecord(id, title, markdown) {
  const first = markdown.split('\n').find((line) => line.trim() && !line.startsWith('#')) || title
  return {
    id,
    title,
    summary: first.replace(/[`*]/g, '').trim().slice(0, 180),
    markdown,
  }
}

const GUIDES = splitGuides(API_REFERENCE)

export function buildCatalog(opts) {
  const { allowWrite, allowVision, remote, pageTools, listedDrives, ownerId } = opts || {}
  const caps = visibleCapabilities({ allowWrite, allowVision, remote })
  return {
    capabilities: caps,
    guides: GUIDES,
    // null hides the page domain (remote turn, or page tools not in play).
    pageTools: pageTools == null ? null : pageTools.map(pageRecord),
    // Listed drives matching this search, fetched by the host from the search crawler before it
    // calls search (listed-drives.mjs); see withListedDrives. null hides the drive domain.
    listedDrives: listedDrives == null ? null : listedDrives.map(driveRecord),
    // Reserved until Personas choose a home. Passed through and not read.
    ownerId,
  }
}

// Copy the drive domain's records into a catalog: the host fetches them per search, since which
// drives match depends on the query (needsListedDrives says which searches need them).
export function withListedDrives(catalog, listedDrives) {
  return { ...catalog, listedDrives: listedDrives == null ? null : listedDrives.map(driveRecord) }
}

// What the host should fetch from the search crawler for this search call: a query to run (''
// for all drives), or null when the call doesn't touch the drive domain.
export function needsListedDrives(input) {
  const query = typeof input?.query === 'string' ? input.query.trim() : ''
  const domain = input?.domain
  const entity = input?.entity
  if (entity != null) {
    const refs = Array.isArray(entity) ? entity : [entity]
    return refs.some((r) => typeof r === 'string' && r.startsWith('drive:')) ? '' : null
  }
  if (domain != null && domain !== 'drive') return null
  return query
}

function driveRecord(d) {
  const key = String(d.driveKey || d.name || '')
  return {
    name: key,
    title: String(d.title || 'Untitled drive'),
    description: String(d.description || ''),
    url: `hyper://${key}/`,
    type: d.type || null,
    topics: Array.isArray(d.topics) ? d.topics.map(String) : [],
    keywords: Array.isArray(d.keywords) ? d.keywords.map(String) : [],
    // The crawler's own (fuzzy) match score, so its ranking carries over.
    score: Number(d.score) || 0,
  }
}

function pageRecord(tool) {
  return {
    name: String(tool.name),
    description: String(tool.description || ''),
    inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object', properties: {} },
  }
}

export function search(input, catalog) {
  // Reserved for Personas. Accepted so a later owner id can be passed through, and unused.
  void catalog?.ownerId
  const query = typeof input?.query === 'string' ? input.query.trim() : ''
  const domain = input?.domain
  const entity = input?.entity
  if (entity != null && (query || domain)) throw new Error('pass entity on its own, without query or domain')
  if (domain != null && !DOMAINS.includes(domain)) throw new Error(`unknown domain "${domain}"`)
  if (domain === 'page' && catalog.pageTools == null) {
    throw new Error('page tools are not available in this context')
  }
  if (domain === 'drive' && catalog.listedDrives == null) {
    throw new Error('listed drives are not available in this context')
  }
  if (entity != null) return { kind: 'detail', details: entityDetails(entity, catalog) }
  if (!query && !domain) return { kind: 'index', domains: domainIndex(catalog) }
  if (domain && !query) {
    return {
      kind: 'hits',
      hits: listDomain(domain, catalog)
        .slice(0, 32)
        .map((item) => toHit(domain, item)),
    }
  }
  return { kind: 'hits', hits: rank(query, domain, catalog) }
}

function domainIndex(catalog) {
  const rows = []
  for (const domain of DOMAINS) {
    const items = listDomain(domain, catalog)
    if (domain === 'page' && catalog.pageTools == null) continue
    if (domain === 'drive' && catalog.listedDrives == null) continue
    rows.push({
      domain,
      description: DOMAIN_COPY[domain],
      count: items.length,
      samples: items.slice(0, 3).map((item) => item.name || item.id),
    })
  }
  return rows
}

function toHit(domain, item) {
  const { score, call, ...rest } = scoreHit(domain, item, [])
  void score
  void call
  return rest
}

function listDomain(domain, catalog) {
  if (domain === 'capability') return catalog.capabilities
  if (domain === 'guide') return catalog.guides
  if (domain === 'page') return catalog.pageTools || []
  if (domain === 'drive') return catalog.listedDrives || []
  return []
}

function rank(query, domain, catalog) {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1)
  const pools = domain ? [domain] : DOMAINS
  const hits = []
  for (const d of pools) {
    if (d === 'page' && catalog.pageTools == null) continue
    if (d === 'drive' && catalog.listedDrives == null) continue
    for (const item of listDomain(d, catalog)) hits.push(scoreHit(d, item, tokens))
  }
  hits.sort((a, b) => b.score - a.score || a.entity.localeCompare(b.entity))
  const matched = tokens.length ? hits.filter((h) => h.score > 0) : hits
  return matched.slice(0, MAX_HITS).map((hit, i) => {
    const { score, ...rest } = hit
    void score
    if (i < MAX_CALLS && rest.call) return rest
    const { call, ...without } = rest
    void call
    return without
  })
}

function scoreHit(domain, item, tokens) {
  if (domain === 'drive') return driveHit(item)
  const name = item.name || item.id
  const title = item.title || name
  const summary = item.description || item.summary || ''
  const body = item.markdown || ''
  const score =
    tokens.reduce((sum, token) => sum + (title.toLowerCase().includes(token) ? 3 : 0), 0) +
    tokens.reduce((sum, token) => sum + (summary.toLowerCase().includes(token) ? 2 : 0), 0) +
    tokens.reduce((sum, token) => sum + (name.toLowerCase().includes(token) ? 2 : 0), 0) +
    tokens.reduce((sum, token) => sum + (body.toLowerCase().includes(token) ? 1 : 0), 0)
  const hit = {
    entity: `${domain}:${name}`,
    type: domain,
    title,
    summary: summary.slice(0, 180),
    score,
    call: undefined,
  }
  if (domain === 'capability') hit.call = { code: capabilityCode(name), inputSchema: item.inputSchema }
  if (domain === 'page') hit.call = { code: pageToolCode(name), inputSchema: item.inputSchema }
  return hit
}

// A listed drive is already a search result: the crawler matched it (fuzzily) against this query,
// so its score carries over (doubled, to sit among capability and guide scores). There is nothing
// to execute — the model gives the user the URL.
function driveHit(item) {
  return {
    entity: `drive:${item.name}`,
    type: 'drive',
    title: item.title,
    summary: item.description.slice(0, 180),
    url: item.url,
    ...(item.topics.length ? { topics: item.topics } : {}),
    ...(item.type ? { kind: item.type } : {}),
    score: item.score * 2,
    call: undefined,
  }
}

function entityDetails(entity, catalog) {
  const refs = Array.isArray(entity) ? entity : [entity]
  if (refs.length < 1 || refs.length > MAX_ENTITIES) throw new Error(`entity accepts 1 to ${MAX_ENTITIES} refs`)
  return refs.map((ref) => openEntity(ref, catalog))
}

function openEntity(ref, catalog) {
  if (typeof ref !== 'string' || !ref.includes(':')) throw new Error(`bad entity "${ref}"`)
  const colon = ref.indexOf(':')
  const type = ref.slice(0, colon)
  let id = ref.slice(colon + 1)
  let fragment = ''
  const hash = id.indexOf('#')
  if (hash !== -1) {
    fragment = id.slice(hash + 1)
    id = id.slice(0, hash)
  }
  if (type === 'capability') {
    const cap = catalog.capabilities.find((c) => c.name === id)
    if (!cap) throw new Error(`unknown capability "${id}"`)
    return {
      entity: `capability:${id}`,
      type: 'capability',
      title: cap.name,
      summary: cap.description,
      inputSchema: cap.inputSchema,
      code: capabilityCode(id),
    }
  }
  if (type === 'page') {
    if (catalog.pageTools == null) throw new Error('page tools are not available in this context')
    const tool = catalog.pageTools.find((t) => t.name === id)
    if (!tool) throw new Error(`unknown page tool "${id}"`)
    return {
      entity: `page:${id}`,
      type: 'page',
      title: tool.name,
      summary: tool.description,
      inputSchema: tool.inputSchema,
      code: pageToolCode(id),
    }
  }
  if (type === 'drive') {
    if (catalog.listedDrives == null) throw new Error('listed drives are not available in this context')
    const drive = catalog.listedDrives.find((d) => d.name === id)
    if (!drive) throw new Error(`unknown listed drive "${id}"`)
    const { name, score, ...rest } = drive
    void name
    void score
    return { entity: `drive:${id}`, type: 'drive', ...rest }
  }
  if (type === 'guide') {
    const guide = catalog.guides.find((g) => g.id === id)
    if (!guide) throw new Error(`unknown guide "${id}"`)
    const opened = openGuide(guide, fragment)
    return {
      entity: fragment ? `guide:${id}#${fragment}` : `guide:${id}`,
      type: 'guide',
      title: guide.title,
      ...opened,
    }
  }
  throw new Error(`unknown entity type "${type}"`)
}

function openGuide(guide, fragment) {
  const toc = headings(guide.markdown)
  if (fragment) {
    const section = sliceHeading(guide.markdown, fragment)
    if (!section) return { fragmentNotFound: true, toc }
    if (section.length > GUIDE_BUDGET) return { toc, markdown: section.slice(0, GUIDE_BUDGET) + '\n…[truncated]' }
    return { markdown: section }
  }
  if (guide.markdown.length > GUIDE_BUDGET) return { toc }
  return { markdown: guide.markdown }
}

function headings(markdown) {
  const out = []
  for (const line of markdown.split('\n')) {
    const m = /^(#{2,4})\s+(.+)$/.exec(line)
    if (!m) continue
    out.push({ heading: m[2].trim(), anchor: slug(m[2]) })
  }
  return out
}

function sliceHeading(markdown, fragment) {
  const wanted = slug(fragment)
  const lines = markdown.split('\n')
  let start = -1
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{2,4})\s+(.+)$/.exec(lines[i])
    if (!m) continue
    if (start === -1 && slug(m[2]) === wanted) {
      start = i
      level = m[1].length
      continue
    }
    if (start !== -1 && m[1].length <= level) return lines.slice(start, i).join('\n').trim()
  }
  if (start === -1) return null
  return lines.slice(start).join('\n').trim()
}

function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const PAGE_NAME = /^[A-Za-z0-9_.-]{1,64}$/

export function assertCallAllowed(target, name, catalog) {
  if (target === 'page') {
    if (catalog.pageTools == null) throw new Error('page tools are not available in this context')
    if (!PAGE_NAME.test(name || '')) throw new Error('invalid page tool name')
    if (!catalog.pageTools.some((t) => t.name === name)) throw new Error(`unknown page tool "${name}"`)
    return
  }
  if (!catalog.capabilities.some((c) => c.name === target)) {
    throw new Error(`capability "${target}" is not available`)
  }
}

/**
 * Compile a module to a factory `(nomad) => main`. The factory's body runs in a
 * vm context that cannot eval or construct functions from strings. The only
 * import allowed is `nomad:runtime`.
 */
export function compileModule(code) {
  if (typeof code !== 'string' || !code.trim()) throw new Error('execute requires code')
  if (code.length > MAX_CODE) throw new Error('execute code is too long')
  let rest = code.trim()
  const imported = rest.match(RUNTIME_IMPORT)
  if (!imported || imported.index !== 0) {
    throw new Error("module must start with import { nomad } from 'nomad:runtime'")
  }
  rest = rest.slice(imported[0].length).trim()
  if (/\bimport\s*\(|(?:^|\n)\s*import\s+/.test(rest)) throw new Error('only the nomad:runtime import is allowed')
  if (/\brequire\s*\(/.test(rest)) throw new Error('require is not available')
  if (!/^export\s+default\s+/.test(rest)) throw new Error('module must default-export a function')
  const exported = rest.replace(/^export\s+default\s+/, '').trim()
  if (/(^|\n)\s*export\s+/.test(exported)) throw new Error('only one default export is allowed')
  const wrapped = `(function (nomad) {\n"use strict";\nconst __default = (${exported});\nreturn __default;\n})`
  let script
  try {
    script = new vm.Script(wrapped, { filename: 'execute-module.js' })
  } catch (err) {
    throw new Error(`module failed to parse: ${err.message}`)
  }
  return function create(nomad) {
    const context = vm.createContext(safeGlobals(), {
      codeGeneration: { strings: false, wasm: false },
    })
    const factory = script.runInContext(context)
    const main = factory(nomad)
    if (typeof main !== 'function') throw new Error('default export must be a function')
    return main
  }
}

function safeGlobals() {
  return {
    Object,
    Array,
    Promise,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Date,
    RegExp,
    Error,
    TypeError,
    RangeError,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Symbol,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    undefined,
    NaN,
    Infinity,
  }
}

export function createRuntime(invoke) {
  const call = (target, args) => invoke({ target, args: args === undefined ? {} : args })
  const page = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string' || prop === 'then') return undefined
        return (args) => invoke({ target: 'page', name: prop, args: args === undefined ? {} : args })
      },
    }
  )
  const nomad = { page }
  for (const cap of CAPABILITIES) nomad[cap.name] = (args) => call(cap.name, args)
  return nomad
}

export async function runModule(code, params, invoke) {
  const create = compileModule(code)
  const main = create(createRuntime(invoke))
  const value = await main(params == null ? {} : params)
  return capResult(value)
}

export function capResult(value) {
  if (typeof value === 'string') return value.length > MAX_RESULT ? value.slice(0, MAX_RESULT) + '\n…[truncated]' : value
  if (value == null) return ''
  if (typeof value === 'object' && typeof value.imageDataUrl === 'string' && typeof value.text === 'string') {
    return value
  }
  let json
  try {
    json = JSON.stringify(value, null, 2)
  } catch {
    json = String(value)
  }
  if (json == null) return ''
  return json.length > MAX_RESULT ? json.slice(0, MAX_RESULT) + '\n…[truncated]' : json
}

export const MODEL_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search',
      description:
        'Find a capability, a guide section, a page tool, or a drive listed for public search. ' +
        '{} lists domains. {query} ranks. {domain} lists one domain. {entity} opens one or more refs ' +
        '(capability:<name>, guide:<id>, page:<name>, drive:<key>).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural-language search' },
          domain: { type: 'string', enum: DOMAINS, description: 'Restrict to one domain' },
          entity: {
            description: 'One entity ref, or an array of up to 10',
            anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MAX_ENTITIES }],
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'execute',
      description:
        "Run one module. It must import { nomad } from 'nomad:runtime' and default-export " +
        'async function main(params). Pass varying arguments as params. Page tools are nomad.page.<name>(params).',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The module source' },
          params: { type: 'object', description: 'First argument to the default export' },
        },
        required: ['code'],
      },
    },
  },
]
