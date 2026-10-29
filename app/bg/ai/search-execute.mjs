// search and execute: the two tools a Nomad chat turn offers the model.
// Capabilities, guide sections, and page tools stay behind search.
// execute runs one module whose only import is nomad:runtime.
//
// No Electron imports — unit tests and the utility-process worker both load this file.

import vm from 'node:vm'
import { API_REFERENCE } from './api-reference.mjs'

export const DOMAINS = ['capability', 'guide', 'page', 'drive', 'name']

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
  capability: 'Read and write the current Drive, fetch an http(s) URL, read or screenshot the open page, and open a new tab.',
  guide: 'Sections of the Nomad API reference. Open one with entity guide:<id>.',
  page: 'Tools the current page registered. Open one with entity page:<name>.',
  drive:
    'Drives their owners listed for public search (what nomad://search finds), with their hyper:// URLs. ' +
    'Search by topic or words. Nothing here when the search crawler is off.',
  name:
    'Names the user gave their drives, apps and pages ("blog", "notes"), with what each points to. ' +
    'Pass a drive or app name as `drive` to readDriveFile, listDriveFiles or writeDriveFile. ' +
    'hyper://<name>/ opens it in a tab.',
}

export const CAPABILITIES = [
  {
    name: 'readDriveFile',
    description: 'Read the text content of a file in the current Drive.',
    namedDescription: 'Read the text content of a file in the current Drive, or in a named one (`drive`).',
    tabDescription: "Read the text content of a file in a drive: a named one (`drive`), or the drive in the user's current tab.",
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute path to the file, e.g. /index.html' } },
      required: ['path'],
    },
  },
  {
    name: 'listDriveFiles',
    description: 'List files and directories at a path in the current Drive.',
    namedDescription: 'List files and directories at a path in the current Drive, or in a named one (`drive`).',
    tabDescription:
      "List files and directories at a path in a drive: a named one (`drive`), or the drive in the user's current tab.",
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
    namedDescription:
      'Write text content to a file in the current Drive, or in a named one (`drive`). Requires user permission for that drive.',
    tabDescription:
      'Write text content to a file in a drive. Always name the drive (`drive`): the one currentTab gives, or one of the ' +
      "user's names. Requires user permission for that drive.",
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
    name: 'currentTab',
    description:
      'The tab the user is looking at right now: { url, title, drive, writable }. `drive` is the hyper:// Drive open in ' +
      'it, or null. The user can change tabs while you work, so ask again when it matters, and pass its drive to ' +
      'writeDriveFile.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    gates: { personal: true, tab: true },
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
  {
    name: 'openTab',
    description:
      'Open a new tab in Nomad, next to the one the user is on. `url` is an http(s), hyper:// or nomad:// URL ' +
      "(hyper://<name>/ opens one of the user's names); without it, a blank new tab opens. The new tab becomes " +
      "the user's current tab unless `background` is true. With `group`, it opens at the end of that tab group, " +
      'found by name and made when there is none. Returns { url, title, group } once the page has loaded.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Optional. The URL to open, e.g. https://example.com/ or hyper://blog/' },
        background: { type: 'boolean', description: "Optional. Open it without switching the user's tab" },
        group: { type: 'string', description: 'Optional. The name of a tab group to open it in, e.g. Research' },
      },
      required: [],
    },
    gates: { personal: true, renderer: true },
  },
  // The user's Notes, Highlights and Reader (vault-tools.mjs). Only a personal turn sees them, and
  // each asks the user's permission: read Notes, write Notes, read Reader, change Reader (ADR-0019).
  {
    name: 'listNotes',
    description:
      "Find the user's Notes (nomad://notes): id, title and a short preview, newest first. " +
      'Pass `query` to search their text. Asks permission to read Notes.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional. Words that must all be in the note' },
        limit: { type: 'number', description: 'Optional. How many, up to 100 (default 20)' },
      },
      required: [],
    },
    gates: { personal: true },
  },
  {
    name: 'readNote',
    description:
      "Read one of the user's Notes in full: its Markdown, the titles it links to, and its updatedAt " +
      '(pass that to writeNote to edit it). Find it by `id` or `title`. Asks permission to read Notes.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The note id, from listNotes' },
        title: { type: 'string', description: 'Or the note title (its first line)' },
      },
      required: [],
    },
    gates: { personal: true },
  },
  {
    name: 'writeNote',
    description:
      'Create a Note (no `id`), or replace the text of one (`id`, and the updatedAt readNote gave as ' +
      '`baseUpdatedAt`). The first line is its title; link Notes with [[Title]]. If the Note changed ' +
      'since you read it, your text is kept as a conflict copy. Asks permission to write Notes.',
    inputSchema: {
      type: 'object',
      properties: {
        body: { type: 'string', description: 'The whole note, in Markdown' },
        id: { type: 'string', description: 'Optional. The note to replace' },
        baseUpdatedAt: { type: 'string', description: 'Required with id: the updatedAt from readNote' },
      },
      required: ['body'],
    },
    gates: { personal: true },
  },
  {
    name: 'highlightText',
    description:
      'Highlight text on the page in the user\'s current tab, as the user does with right-click > Highlight. ' +
      'Pass `text` exactly as readCurrentPage gives it (whole words; a quote of several paragraphs is found by its ' +
      'first and last). Where the text shows up more than once, the first is marked. With `note`, also make a ' +
      'Note that quotes the text and links back to it, with `note` below the quote. Web and hyper:// pages ' +
      'only. Asks permission to write Notes.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text on the page to highlight' },
        note: { type: 'string', description: 'Optional. Markdown for a Note about the highlight' },
      },
      required: ['text'],
    },
    gates: { personal: true, renderer: true },
  },
  {
    name: 'listReaderPosts',
    description:
      'List posts from the feeds the user follows in Reader (nomad://reader), newest first, with whether ' +
      'each is read, and the feeds. Pass `query` to search titles and summaries, `feed` for one feed, ' +
      '`unread: true` for unread posts. Asks permission to read Reader.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional. Words that must all be in the post' },
        feed: { type: 'string', description: "Optional. A followed feed's hyper:// URL" },
        unread: { type: 'boolean', description: 'Optional. Only posts not yet read' },
        limit: { type: 'number', description: 'Optional. How many, up to 100 (default 20)' },
      },
      required: [],
    },
    gates: { personal: true },
  },
  {
    name: 'readReaderPost',
    description:
      'Read one post from a feed the user follows in Reader: title, date, tags and text. Asks permission ' +
      'to read Reader.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The post URL, from listReaderPosts' } },
      required: ['url'],
    },
    gates: { personal: true },
  },
  {
    name: 'followFeed',
    description: 'Follow a feed in Reader, by its hyper:// URL. Asks permission to change Reader.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: "The feed's hyper:// URL" } },
      required: ['url'],
    },
    gates: { personal: true },
  },
  {
    name: 'unfollowFeed',
    description: 'Stop following a feed in Reader. Asks permission to change Reader.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: "The feed's hyper:// URL" } },
      required: ['url'],
    },
    gates: { personal: true },
  },
  {
    name: 'markPostsRead',
    description: 'Mark posts read in Reader. Asks permission to change Reader.',
    inputSchema: {
      type: 'object',
      properties: {
        urls: { type: 'array', items: { type: 'string' }, description: 'Post URLs, from listReaderPosts' },
      },
      required: ['urls'],
    },
    gates: { personal: true },
  },
  // The user's Mods (ADR-0023): their own styles and scripts for sites, like Arc's. Reading and
  // changing them are two more permissions (vault-tools.mjs).
  {
    name: 'listMods',
    description:
      "List the user's Mods: per-site changes, each with a name, an on/off switch, preset styles, CSS " +
      'selectors of elements it hides, custom CSS and custom JavaScript. Pass `site` (a host or URL) for the ' +
      'Mods that apply there. Also gives the preset ids. Asks permission to read Mods.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Optional. A host or URL, e.g. example.com' },
        query: { type: 'string', description: 'Optional. Words that must all be in the Mod' },
      },
      required: [],
    },
    gates: { personal: true },
  },
  {
    name: 'saveMod',
    description:
      'Create a Mod (no `id`; `site` required) or change one (`id`; fields you leave out stay as they are). ' +
      'A Mod applies to its site and every host under it (example.com covers www. and docs.example.com) and ' +
      'takes effect at once in open tabs; its JavaScript runs in the page on each load, like a bookmarklet, ' +
      '`await` allowed. Prefer `presets` and `hide` over CSS, and CSS over JavaScript. `hide` replaces the whole ' +
      'list, so pass the old selectors too. Asks permission to change Mods.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional. The Mod to change, from listMods' },
        site: { type: 'string', description: 'Required for a new Mod: a host or URL, e.g. example.com' },
        name: { type: 'string', description: 'Optional. A short name the user sees in the tab, e.g. "Clean reading"' },
        enabled: { type: 'boolean', description: 'Optional. On (default) or off' },
        presets: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional. Preset ids: dark, sepia, grayscale, no-motion, hide-media',
        },
        hide: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional. CSS selectors of elements to hide, e.g. ".sidebar", "#cookie-banner"',
        },
        css: { type: 'string', description: 'Optional. Custom CSS for the site' },
        js: { type: 'string', description: 'Optional. Custom JavaScript, run in the page when its DOM is ready' },
      },
      required: [],
    },
    gates: { personal: true },
  },
  {
    name: 'deleteMod',
    description: 'Delete one of the user\'s Mods. Asks permission to change Mods.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The Mod id, from listMods' } },
      required: ['id'],
    },
    gates: { personal: true },
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

// The drive tools' `drive` argument: another of the user's Drives, by name or hyper:// URL. Only a
// personal turn (the user's own AI) gets it, and executeTool refuses it on any other turn, so a
// page's own nomad.ai.chat() stays on its own Drive (ADR-0018).
const DRIVE_ARG = {
  type: 'string',
  description:
    'Optional. Another drive: one of the user\'s names (search domain "name"), hyper://<name>/, or a hyper:// URL. Omit for the current Drive.',
}
// With a tab (the AI Sidebar, the phone's AI panel), the user's own AI has no Drive of its own
// (ADR-0021). A read may use the drive in the user's current tab; a write names its drive.
const TAB_DRIVE_ARG = {
  type: 'string',
  description:
    'A drive: one of the user\'s names (search domain "name"), hyper://<name>/, or a hyper:// URL (currentTab gives the ' +
    "one in the user's tab). Omit only to read from the drive in the user's current tab.",
}

// `personal`: a turn of the user's own AI (the AI Sidebar, the phone's AI panel, the loopback MCP),
// never a page's nomad.ai.chat(). It adds the user's Notes and Reader, and `drive` on the drive tools.
// `tab`: the turn has the user's current tab (the AI Sidebar, the phone's AI panel; ADR-0021). It
// adds currentTab, and a write must name its drive.
export function visibleCapabilities({
  allowWrite = true,
  allowVision = false,
  remote = false,
  personal = false,
  tab = false,
} = {}) {
  return CAPABILITIES.filter((cap) => {
    if (cap.gates?.write && !allowWrite) return false
    if (cap.gates?.vision && !allowVision) return false
    if (cap.gates?.renderer && remote) return false
    if (cap.gates?.personal && !personal) return false
    if (cap.gates?.tab && !tab) return false
    return true
  }).map(({ namedDescription, tabDescription, ...cap }) => {
    if (!personal || !namedDescription) return cap
    const { inputSchema } = cap
    const withTab = tab && tabDescription
    return {
      ...cap,
      description: withTab ? tabDescription : namedDescription,
      inputSchema: {
        ...inputSchema,
        properties: { ...inputSchema.properties, drive: withTab ? TAB_DRIVE_ARG : DRIVE_ARG },
        required: withTab && cap.gates?.write ? [...inputSchema.required, 'drive'] : inputSchema.required,
      },
    }
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
  const { allowWrite, allowVision, remote, pageTools, listedDrives, personal, tab, names, ownerId } = opts || {}
  const caps = visibleCapabilities({ allowWrite, allowVision, remote, personal: !!personal, tab: !!personal && !!tab })
  return {
    capabilities: caps,
    // The user's own AI: its turn may use their names, Notes, Reader and other Drives (see above).
    personal: !!personal,
    guides: GUIDES,
    // null hides the page domain (remote turn, or page tools not in play).
    pageTools: pageTools == null ? null : pageTools.map(pageRecord),
    // Listed drives matching this search, fetched by the host from the search crawler before it
    // calls search (listed-drives.mjs); see withListedDrives. null hides the drive domain.
    listedDrives: listedDrives == null ? null : listedDrives.map(driveRecord),
    // The user's names (shared/names.mjs records), on a personal turn only. null hides the name domain.
    names: !personal || names == null ? null : names.map(nameRecord),
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

// What a name points to: a drive (a hyper:// root), an app (a folder in a drive), or a page.
function nameRecord(n) {
  const url = String(n.url || '')
  const kind = /^hyper:\/\/[^/]+\/?$/i.test(url) ? 'drive' : url.startsWith('hyper://') ? 'app' : 'page'
  return {
    name: String(n.name),
    title: String(n.title || n.name),
    description: `${kind} at ${url}`,
    url,
    kind,
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
  if (domain === 'name' && catalog.names == null) {
    throw new Error('names are not available in this context')
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
    if (domain === 'name' && catalog.names == null) continue
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
  if (domain === 'name') return catalog.names || []
  return []
}

function rank(query, domain, catalog) {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1)
  const pools = domain ? [domain] : DOMAINS
  const hits = []
  for (const d of pools) {
    if (d === 'page' && catalog.pageTools == null) continue
    if (d === 'drive' && catalog.listedDrives == null) continue
    if (d === 'name' && catalog.names == null) continue
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
  if (domain === 'name') Object.assign(hit, { url: item.url, shortcut: `hyper://${name}/`, kind: item.kind })
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
  if (type === 'name') {
    if (catalog.names == null) throw new Error('names are not available in this context')
    const n = catalog.names.find((x) => x.name === id)
    if (!n) throw new Error(`unknown name "${id}"`)
    return { entity: `name:${id}`, type: 'name', title: n.title, url: n.url, shortcut: `hyper://${id}/`, kind: n.kind }
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
