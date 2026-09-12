import EventEmitter from 'events';
import emitStream from 'emit-stream';
import http from 'http';
import https from 'https';
import b4a from 'b4a';
import { URL } from 'url';
import * as settingsDb from '../../dbs/settings';
import * as sitedata from '../../dbs/sitedata';
import * as permissions from '../../ui/permissions';
import { parseDriveUrl } from '../../../lib/urls';
import { findTab } from '../../ui/tabs/manager';
import * as wcTrust from '../../wc-trust';
import fsAPI from './fs';
import * as modelContext from './model-context';
import { jsonSchemaToParameters, pageToolResultToText } from './webmcp-schema';
import * as daemon from '../../hyper/daemon';
import * as aiBridge from '../../hyper/ai-bridge';

// Built-in system context always appended to every conversation's system prompt.
// KEEP IN SYNC with nomad.dev/content/docs/api/apis/ — when a new API is added
// or an existing method signature changes, update both the docs and this string.
const NOMAD_API_REFERENCE = `\
You are an AI assistant embedded in Nomad, a peer-to-peer web browser that hosts and serves websites via Hyperdrive (hyper:// protocol). Pages running in Nomad have access to the following JavaScript APIs under the global \`nomad\` object:

## nomad.page + nomad.parseUrl — This page's URL identity

\`nomad.page\` is the authoritative way for a drive frontend to learn its own drive and current route.
ALWAYS prefer it over parsing \`location\` — on mobile the page renders in a WebView where
\`location.host\`/\`pathname\` are unreliable; \`nomad.page\` is provided by the host on both platforms.

\`\`\`js
nomad.page                       // { url, origin, key, version, path, search } — null on non-hyper pages
const drive = nomad.fs.drive(nomad.page.origin)   // this page's own drive
const route = nomad.page.path                     // e.g. '/posts/2026-07-10-hello/'

nomad.parseUrl('hyper://key.../a/b?x=1')  // pure parser for any hyper URL → same shape, null if not hyper
\`\`\`

## nomad.fs — The filesystem API for hyper:// drives

\`nomad.fs\` is THE API for reading and writing \`hyper://\` drives. Every drive is a multi-writer
Autobase (a drive can gain writers via invites without ever changing its URL); \`nomad.fs\` handles
files, drive lifecycle, and writer management through one surface. \`stat\` carries real
\`mtime\`/\`ctime\`/\`size\`, and \`get(path, 'json')\` parses JSON for you.

\`\`\`js
// Scoped handle (paths are relative to the drive) …
const drive = nomad.fs.drive('hyper://key...')
const info  = await drive.getInfo()
const st    = await drive.stat('/index.json')          // { isFile(), size, mtime, ctime, ... }
const text  = await drive.readFile('/index.html')
const obj   = await drive.get('/index.json', 'json')   // real JSON decode (parsed for you)
const list  = await drive.list('/')
await drive.writeFile('/notes.txt', 'hello')
await drive.put('/data.bin', bytes)
await drive.del('/old.txt')
await drive.copy('/a', '/b'); await drive.rename('/b', '/c')
drive.watch('/', () => { /* changed */ })

// … or url-first helpers (no scoped instance)
const text2 = await nomad.fs.readFile('hyper://key.../index.html')
await nomad.fs.writeFile('hyper://key.../notes.txt', 'hello')
const entries = await nomad.fs.query('hyper://key.../posts/')   // listing under a prefix

// Every drive is multi-writer-capable and keeps its URL forever, but "collaborative" is a policy
// flag — LOCKED (single-writer) by default. Unlock without changing the URL:
await nomad.fs.configure(url, { collaborative: true })   // or pass { collaborative: true } to createDrive
const { collaborative } = await nomad.fs.getInfo(url)    // is it accepting writers?

// Multi-writer: invite/approve writers so others can write to the same drive (this also unlocks it)
const inviteUrl = await drive.createInvite()
await nomad.fs.claimInvite(inviteUrl)                 // recipient calls this
const requests = await drive.listRequests()            // [{ writerKey, profileUrl }]
await drive.approveRequest(writerKey)
const writers = await drive.listWriters()

// Draft Mode (ADR-0012): stage edits privately (synced across YOUR devices, invisible to other
// peers) until you Publish. While Draft Mode is on, put/del stage instead of going live.
await drive.beginDraft()                               // subsequent writes stage
await drive.writeFile('/index.html', '<h1>wip</h1>')   // staged, NOT replicated
const html = await drive.readFile('/index.html', { draft: true })   // preview the merged view
const { mode, changes } = await drive.draftStatus()    // changes: [{ path, op, conflict }]
await drive.publishDraft({ paths: ['/posts/x/'] })     // fold a subtree onto the drive (goes live)
await drive.discardDraft()                             // throw the whole Draft away
\`\`\`

## nomad.shell — Browser dialogs and library management

\`\`\`js
// Dialogs
const files = await nomad.shell.selectFileDialog({ title, select: ['file'], filters: { extensions: ['png'] }, allowMultiple: true })
// => [{ path, origin, url }]

const file  = await nomad.shell.saveFileDialog({ title, defaultFilename: 'out.txt', extension: 'txt' })
const url   = await nomad.shell.selectDriveDialog({ title, writable: true, tag: 'website' })

// Library
await nomad.shell.saveDriveDialog(url)
await nomad.shell.tagDrive(url, 'website blog')
await nomad.shell.unsaveDrive(url)
const drives = await nomad.shell.listDrives({ tag: 'website', writable: true })

// Properties dialog
await nomad.shell.drivePropertiesDialog(url)
\`\`\`

## nomad.ai — AI chat (this API)

\`\`\`js
const messages = [{ role: 'user', content: 'Hello' }]
for await (const chunk of nomad.ai.chat(messages, {
  model,               // optional: override the resolved model for this turn
  think: false,         // optional: ask the runtime to skip its reasoning phase
  effort: 'medium',     // optional: 'low' | 'medium' | 'high' reasoning_effort (when think !== false)
  onReasoning: (t) => {},// optional: reasoning-stream chunks (when think !== false)
})) {
  process(chunk) // string chunk streamed from the model
}

const { models, current } = await nomad.ai.listModels() // the AI server's model catalogue
const { builtin, page } = await nomad.ai.listTools()     // tools offered for a turn from this page
const { reasoning } = await nomad.ai.modelInfo(model)    // is that model a reasoning model?
\`\`\`

## nomad.panes — Multi-pane tab layout

\`\`\`js
nomad.panes.setAttachable()                               // mark this pane as attachable
const pane = await nomad.panes.attachToLastActivePane()   // attach to the previously focused pane
const pane = await nomad.panes.create(url, { attach: true }) // open url in a new pane
await nomad.panes.navigate(pane.id, url)
await nomad.panes.focus(pane.id)
const res  = await nomad.panes.executeJavaScript(pane.id, script)
const cssId = await nomad.panes.injectCss(pane.id, styles)
await nomad.panes.uninjectCss(pane.id, cssId)

// Events on nomad.panes
nomad.panes.addEventListener('pane-attached',  e => { /* e.detail.id */ })
nomad.panes.addEventListener('pane-detached',  e => { })
nomad.panes.addEventListener('pane-navigated', e => { /* e.detail.url */ })
\`\`\`

## nomad.peersockets — Real-time peer messaging

Messages are scoped to the current Hyperdrive and its connected peers.

\`\`\`js
// Track peers
const peerIds = new Set()
const peerEvents = nomad.peersockets.watch()
peerEvents.addEventListener('join',  e => peerIds.add(e.peerId))
peerEvents.addEventListener('leave', e => peerIds.delete(e.peerId))

// Send/receive on a named topic
const topic = nomad.peersockets.join('chat')
topic.send(peerId, new TextEncoder().encode('hello'))
topic.addEventListener('message', e => {
  console.log(e.peerId, new TextDecoder().decode(e.message))
})
\`\`\`

## Page-provided tools (WebMCP)

A page can register its own tools with \`document.modelContext.registerTool({ name, description, inputSchema, execute })\`
(the \`navigator.modelContext\` alias also works). When the current page has registered tools they are
offered to you with a \`page_\` name prefix — a page tool \`search\` appears to you as \`page_search\`.
Call them like any built-in tool; the result comes back from the page. They run in the page and can
only do what the page's own scripts can do.

## After using tools

When you finish calling tools, ALWAYS write a short plain-language reply to the user — confirm what
you did (or answer their question). Never end your turn silently right after a tool result.

---
The current drive's URL is \`location.href\`. A drive can freely read/write its own files; writing to other drives requires the user to grant permission.

## Resolving which file to edit from a URL

When a user asks you to edit the current page, derive the target file path from the URL as follows:

1. **Exact file path** — if \`location.pathname\` has an extension (e.g. \`/about.html\`, \`/posts/hello.md\`), that is the file to edit.
2. **Directory / trailing slash** — if the pathname is \`/\` or ends with \`/\`, the browser resolves index files in this priority order:
   - \`index.html\` (checked first — wins if it exists)
   - \`index.md\`
   - \`index.txt\`
   Read the drive to find which one exists, then edit that file.
3. **Extensionless path** — treat it as a directory (append \`/\`) and apply the same index-file lookup above.

Example: on \`hyper://abc.../\` you would check for \`/index.html\` first, then \`/index.md\`, then \`/index.txt\`, and edit whichever one exists. Use \`nomad.fs.stat()\` to test existence.

## Building an SPA frontend (the \`fallback\` convention)

To make a drive a single-page app that owns its whole URL space, put the app shell at \`/index.html\`
and declare in \`/index.json\`:

\`\`\`json
{ "title": "My App", "fallback": "/index.html" }
\`\`\`

Real files always win; when a page navigation hits a path with no file, the browser serves
\`/index.html\` instead (HTTP 200, URL unchanged) so the app routes via \`nomad.page.path\`.
Sub-resource \`fetch()\`es to missing paths still 404. Reference assets by absolute path
(\`/app.js\`, not \`./app.js\`) — the shell is served under arbitrary routes. Prefer this over the
legacy \`/.ui/ui.html\` convention (which shadows real HTML files and needs a stub \`/index.html\`);
if a drive declares \`fallback\`, any \`/.ui/ui.html\` is ignored.`;

// Built-in tools exposed to the model
const BUILTIN_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'readDriveFile',
      description: 'Read the text content of a file in the current Drive.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the file, e.g. /index.html' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listDriveFiles',
      description: 'List files and directories at a path in the current Drive.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to list, e.g. / or /src' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetchUrl',
      description: 'Fetch the text content of an http or https URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch (http or https only)' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'writeDriveFile',
      description: 'Write text content to a file in the current Drive. Requires user permission.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to write, e.g. /index.html' },
          content: { type: 'string', description: 'Text content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'readCurrentPage',
      description:
        "Read the visible text content of the page currently open in this tab. Works on any page — " +
        "http/https sites included, not just hyper:// Drives. For a hyper:// Drive, prefer " +
        'readDriveFile/listDriveFiles to read its actual source files instead of the rendered page.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'screenshotCurrentPage',
      description:
        'Take a screenshot of the page currently open in this tab and view it — use this for ' +
        "visual questions readCurrentPage's text extraction can't answer (layout, images, " +
        'charts, how something looks).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

// screenshotCurrentPage only makes sense (and is only offered) when the resolved model reports
// vision support — see modelInfo() above. Kept separate from BUILTIN_TOOLS so it's easy to
// include/exclude per turn without touching the read-only tool list content.
const VISION_TOOL_NAME = 'screenshotCurrentPage';

// Shared by listTools() (what the Tools panel shows the user before a turn) and runChat() (what
// the model is actually offered) — kept as one function so they can never disagree about which
// gated tools are available for a given allowWrite/allowVision combination.
function filterBuiltinTools({ allowWrite, allowVision }) {
  return BUILTIN_TOOLS.filter((t) => {
    if (t.function.name === 'writeDriveFile') return allowWrite;
    if (t.function.name === VISION_TOOL_NAME) return !!allowVision;
    return true;
  });
}

export default {
  async testConnection(baseUrl) {
    const url = (baseUrl || 'http://localhost:11434/v1').replace(/\/$/, '') + '/models';
    const token = await settingsDb.get('ai_access_token');
    try {
      const data: any = await fetchJson(url, token);
      return { ok: true, models: data.data?.length ?? 0 };
    } catch (err) {
      let error = err.message || 'Could not connect';
      // 401/403 is ambiguous from the message alone — say plainly whether an access token was
      // actually sent, so "I set a token but still get 401" is diagnosable from this UI alone.
      if (/\b(401|403)\b/.test(error)) {
        error += token
          ? ' — an access token was sent but rejected; double-check it.'
          : ' — no access token is set for this runtime (Settings → AI); this server may require one.';
      }
      return { ok: false, error };
    }
  },

  // The AI server's model catalogue (OpenAI-compatible `/models`), plus the configured global
  // default so a picker can label its "Default" entry. Errors are swallowed to an empty list.
  async listModels() {
    const baseUrl = (await settingsDb.get('ai_base_url')) || 'http://localhost:11434/v1';
    const token = await settingsDb.get('ai_access_token');
    const current = (await settingsDb.get('ai_default_model')) || null;
    try {
      const data: any = await fetchJson(baseUrl.replace(/\/$/, '') + '/models', token);
      const models = (data.data || [])
        .map((m) => m.id)
        .filter((id) => typeof id === 'string')
        .sort();
      return { models, current };
    } catch (err) {
      return { models: [], current, error: err.message || 'Could not reach the AI server' };
    }
  },

  // Whether `model` is a reasoning and/or vision (image-input) model, so the chat UI can decide
  // whether to show a reasoning-effort control and whether to offer the screenshotCurrentPage
  // tool. Ollama's `/api/show` lists `capabilities` (includes "thinking"/"vision"); for any other
  // server (or on error) we can't tell — report reasoning:true (show the control anyway, harmless
  // if wrong) but vision:false (never silently send an image a model can't use).
  async modelInfo(model) {
    if (!model) return { reasoning: true, vision: false, probed: false };
    const baseUrl = (await settingsDb.get('ai_base_url')) || 'http://localhost:11434/v1';
    const token = await settingsDb.get('ai_access_token');
    const root = baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
    try {
      const data: any = await postJson(root + '/api/show', { model }, token);
      const caps = Array.isArray(data.capabilities) ? data.capabilities : [];
      return { reasoning: caps.includes('thinking'), vision: caps.includes('vision'), probed: true };
    } catch {
      return { reasoning: true, vision: false, probed: false };
    }
  },

  // The tools the agent would be offered for a turn from this sender: the built-ins (minus the
  // write tool on read-only Drives) and any WebMCP tools the current page has registered. This
  // is a read-only listing for the chat UI — it never triggers the `webmcpTools` prompt.
  async listTools(opts: any = {}) {
    const allowWrite = opts.allowWrite !== false;
    const builtin = filterBuiltinTools({ allowWrite, allowVision: opts.allowVision }).map((t) => ({
      name: t.function.name,
      description: t.function.description || '',
    }));

    const wcId = this.sender?.id;
    const descriptors = wcId ? modelContext.getPageToolsForWc(wcId) : [];
    const origin = wcId ? modelContext.getPageToolsOrigin(wcId) : null;
    let granted = null;
    if (origin) {
      try {
        const v: any = await sitedata.getPermission(this.sender.getURL(), 'webmcpTools:' + origin);
        granted = v === 1 || v === 0 ? v : null;
      } catch {
        /* no row */
      }
    }
    const page = descriptors.map((t) => ({ name: t.name, description: t.description || '' }));
    return { builtin, page, pageOrigin: origin, pageGranted: granted };
  },

  // opts (optional):
  //   driveUrl   — resolve tools + AI Config against this Drive instead of the sender's URL. The
  //                shell AI sidebar passes this for nomad://editor/nomad://explorer tabs (their
  //                own sender is the app, not the Drive) — see ai-shell.ts's resolveActiveDrive.
  //   allowWrite — when false, the writeDriveFile tool is withheld (read-only Drives).
  //   usePageTools   — offer the sender page's WebMCP tools (document.modelContext) to the
  //                    model, namespaced `page_*`. Defaults to true when no driveUrl is set,
  //                    false otherwise. Local path only.
  //   pageToolsWcId  — override the webContents whose page tools are used (a trusted nomad://
  //                    caller aiming at a tab other than its own sender). Defaults to the sender.
  //   model      — override the resolved model for this turn (from the chat UI's picker).
  //   think      — when false, ask the runtime to skip reasoning; when true (default) the
  //                model's reasoning stream is forwarded as `reasoning` events.
  //   effort     — 'low' | 'medium' | 'high'; sent as reasoning_effort when think !== false.
  chat(messages, opts) {
    const sender = this.sender;
    return createChatStream((emitter, signal) => routeChat(messages, sender, emitter, { ...opts, signal }));
  },
};

// Shared RPC-readable-stream wiring for a chat turn: an EventEmitter (chunk/tool/reasoning/error
// events), wrapped as a pauls-electron-rpc 'readable' stream, with local cancellation (closing the
// stream aborts the in-flight turn — the remote Bridge path forwards this as a CANCEL frame).
// `runTurn(emitter, signal)` does the actual work (routeChat, typically) — used by both this
// module's own chat() and the shell AI sidebar's (ai-shell.ts), which layers its own host-app
// hooks around the same emitter before calling routeChat.
export function createChatStream(runTurn) {
  const emitter = new EventEmitter();
  emitter.on('error', () => {}); // prevent unhandled-error throw
  const stream = emitStream(emitter);
  const controller = new AbortController();
  stream.on('close', () => controller.abort());

  Promise.resolve()
    .then(() => runTurn(emitter, controller.signal))
    .then(() => {
      stream.end();
    })
    .catch((err) => {
      console.error('[ai] chat error:', err);
      emitter.emit('error', { message: err.message });
      stream.end();
    });

  return stream;
}

// Route one turn: local-first, remote-fallback (ADR-0013 §4). If THIS Device can reach its own
// AI Runtime, run the loop locally. Otherwise forward to an online AI Provider over the Bridge —
// a Client (mobile) always lands here; a desktop whose Runtime is down transparently borrows
// another's. If neither is available, the Bridge throws NoAiProviderError, which surfaces as a
// distinct "No AI Device is online" error rather than a hang.
async function routeChat(messages, sender, emitter, opts) {
  if (await aiBridge.localRuntimeReachable()) {
    // WebMCP page tools need a reachable renderer, so they resolve only on the local path.
    const usePageTools = opts.usePageTools ?? !opts.driveUrl;
    // Only a trusted nomad:// UI may aim page tools at another tab's webContents (a future
    // browser-chrome panel). An ordinary page is pinned to its own sender so it can't reach
    // across origins into another tab's registered tools.
    const requestedWcId =
      opts.pageToolsWcId && wcTrust.isWcTrusted(sender) ? opts.pageToolsWcId : null;
    const pageToolsWcId = usePageTools ? requestedWcId || sender.id || null : null;
    return runChat(messages, sender, emitter, { ...opts, usePageTools, pageToolsWcId });
  }
  await aiBridge.requestRemoteChat({
    messages,
    opts: {
      driveUrl: opts.driveUrl,
      allowWrite: opts.allowWrite,
      context: opts.context,
      model: opts.model,
      think: opts.think,
      effort: opts.effort,
    },
    signal: opts.signal,
    onChunk: (text) => emitter.emit('chunk', { text }),
    onTool: (event) => emitter.emit('tool', event),
    // The human is on THIS (Client) Device, so the relayed modifyDrive prompt is shown here.
    onPrompt: (permission) => permissions.requestPermission(permission, sender),
  });
  emitter.emit('done', {});
}

// Serve side of the Bridge: run a full turn on behalf of a remote Client. Registered once, at
// module load. The loop + tools are the SAME runChat used locally; only the plumbing differs —
// a synthetic sender carries the Client's driveUrl, events are forwarded as frames, and the
// modifyDrive prompt is relayed to the Client via requestPermission (ADR-0013 §1, §6).
aiBridge.setServeChat(async ({ messages, opts, signal, requestPermission, sendChunk, sendTool }) => {
  const driveUrl = opts?.driveUrl;
  const sender = makeRemoteSender(driveUrl);

  // Draft actions delegated from the Client (the phone often can't write a Provider-owned Drive, so
  // publish runs HERE where the Drive is writable — ADR-0010/0012). These reuse the request path with
  // no chat: run the fs op and finish (the Bridge sends DONE/ERROR).
  if (opts?.publishDraft && driveUrl) {
    await fsAPI.publishDraft.call({ sender }, driveUrl, {});
    return;
  }
  if (opts?.discardDraft && driveUrl) {
    await fsAPI.discardDraft.call({ sender }, driveUrl, {});
    return;
  }

  const emitter = new EventEmitter();
  emitter.on('error', () => {});
  emitter.on('chunk', (e) => sendChunk(e.text));
  emitter.on('tool', (e) => sendTool(e));
  // `reasoning` events are local-only for now (no Bridge frame for them) — `think:false` still
  // takes effect remotely because opts.think is forwarded to this runChat.
  // Remote AI edits stage into the Drive's Vault-hosted Draft (ADR-0012) so the phone user can
  // review + publish, rather than writing the live Drive directly.
  await runChat(messages, sender, emitter, {
    ...opts,
    signal,
    requestPermission,
    draft: true,
    remote: true, // no reachable renderer here — disables WebMCP page tools
  });
});

// Bring the Bridge's swarm listener up so a Provider receives HELLO even if it never runs a chat
// itself. Install as soon as the swarm EXISTS (not a connection — openOnConn fires per connection):
// if the hyper stack is already up when this module loads, install now; otherwise wait for 'ready'.
// This avoids a premature no-op attempt at module load (which happens before daemon.setup()).
if (daemon.getSwarm()) aiBridge.install();
else daemon.on('ready', () => aiBridge.install());

// A stand-in `sender` for a remote turn. runChat/executeTool only need getURL() (drive scoping +
// AI Config resolution); findTab() returns undefined for it, so config resolves Drive-level then
// the Provider's global default — the Client has no model of its own (ADR-0013 §4). Write consent
// does NOT depend on this object: it is relayed to the Client via the requestPermission override.
function makeRemoteSender(driveUrl) {
  const url = driveUrl || 'hyper://unknown/';
  return { getURL: () => url, getURLOrigin: () => url };
}

// The AI Bridge (app/bg/hyper/ai-bridge.js) drives a remote turn by calling this directly with
// a synthetic `sender` (whose getURL() returns the Client's driveUrl) and an `opts` carrying a
// `signal` (fired by a CANCEL frame / channel close) and a `requestPermission` override (which
// relays the modifyDrive consent prompt back to the Client). Events land on `emitter`
// (chunk/tool/done/error) which the Bridge serializes into frames. Kept as a named export so
// the loop + tool machinery lives in exactly one place.
export { runChat };

// The shell-chrome AI sidebar (bg/web-apis/bg/ai-shell.ts) drives a turn against the browser's
// ACTIVE TAB rather than the sender of the RPC call (always the shell window itself), so it needs
// the local-first/remote-fallback routing `chat()` uses internally, with an explicit `sender` (the
// active tab's own webContents) standing in for "the page this call is about".
export { routeChat };

// =
// Internal helpers
// =

async function runChat(messages, sender, emitter, opts: any = {}) {
  const driveUrl = opts.driveUrl || null;
  const allowWrite = opts.allowWrite !== false; // default true
  // Independent lookups — run concurrently rather than paying the sum of their latencies on
  // every single chat turn.
  const [resolved, defaultModel, baseUrl, token] = await Promise.all([
    resolveAiConfig(sender, driveUrl),
    settingsDb.get('ai_default_model'),
    settingsDb.get('ai_base_url'),
    settingsDb.get('ai_access_token'),
  ]);
  const systemPrompt = resolved.systemPrompt;
  // Model is a user preference, never a Drive's to set — the chat UI's picker (opts.model, e.g.
  // the AI sidebar's per-site choice) wins over the global default setting.
  const model = opts.model || defaultModel;
  const resolvedBaseUrl = baseUrl || 'http://localhost:11434/v1';

  if (!model) {
    throw new Error(
      'No AI model configured. Set a default model in Settings → AI, or pick one in the AI sidebar.'
    );
  }

  // Withhold the write tool on read-only Drives so the model won't attempt edits it can't make,
  // and withhold the screenshot tool unless the caller has confirmed (via modelInfo) that the
  // resolved model actually supports image input — offering it to a text-only model means
  // silently sending an image it can't use.
  const builtinTools = filterBuiltinTools({ allowWrite, allowVision: opts.allowVision });

  // WebMCP: tools the current page registered via document.modelContext. Local path only
  // (the renderer must be reachable), namespaced `page_` so they can't shadow builtins, and
  // gated once per origin by the user (bypassed for trusted nomad://* interfaces).
  const pageTools = await resolvePageTools(opts, sender, emitter);
  const tools = [...builtinTools, ...pageTools];

  // opts.context (from the AI Sidebar) pins the agent to the Drive + open file it
  // is editing — the built-in reference talks about `location.href`, which for the
  // editor/explorer is the app URL, not the Drive. Put it last so it's the most
  // immediate instruction.
  const systemContent = [systemPrompt, NOMAD_API_REFERENCE, opts.context]
    .filter(Boolean)
    .join('\n\n---\n\n');
  const fullMessages = [{ role: 'system', content: systemContent }, ...messages];

  let msgHistory = fullMessages;
  const signal = opts.signal || null;

  // Tool loop — repeats when model calls tools. A cancel (signal.abort, from a local stream
  // close or a remote CANCEL frame) stops future work but never undoes a Checkpoint the turn
  // already wrote — the revert UI covers that (ADR-0013 §5c).
  try {
    while (true) {
      if (signal?.aborted) break;
      const { finishReason, toolCalls, textContent }: any = await streamCompletion(
        resolvedBaseUrl,
        model,
        msgHistory,
        tools,
        emitter,
        signal,
        { think: opts.think, effort: opts.effort, token }
      );

      if (finishReason !== 'tool_calls' || toolCalls.length === 0) break;

      // Append assistant turn (with tool calls) to history. Use '' rather than null for content:
      // some local runtimes' chat templates do `content | trim`, which throws on null (None).
      msgHistory.push({
        role: 'assistant',
        content: textContent || '',
        tool_calls: toolCalls,
      });

      // Execute each tool and append results
      for (const tc of toolCalls) {
        if (signal?.aborted) break;
        let result;
        let args: any = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          /* keep {} */
        }
        // Live activity for the sidebar — shows what the agent is doing while the
        // user waits (before/instead of streamed prose).
        emitter.emit('tool', {
          phase: 'start',
          name: tc.function.name,
          summary: toolSummary(tc.function.name, args),
        });
        try {
          result = await executeTool(tc.function.name, args, sender, {
            driveUrl,
            emitter,
            requestPermission: opts.requestPermission,
            draft: opts.draft,
            pageToolsWcId: opts.pageToolsWcId,
            remote: opts.remote,
            signal,
          });
        } catch (err) {
          console.error(`[ai] tool "${tc.function.name}" failed:`, err);
          result = `Error: ${err.message}`;
        }
        // Include the function `name` on the tool result: it's part of the original OpenAI
        // function-calling spec and some runtimes' templates reference it when rendering the result.
        const isImageResult = result && typeof result === 'object' && result.imageDataUrl;
        msgHistory.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: isImageResult ? result.text : result,
        });
        if (isImageResult) {
          // Most OpenAI-compatible servers don't support image content on a `tool`-role message
          // itself, so the image rides in as a follow-up `user` message instead — the standard,
          // broadly-supported way to send multimodal content.
          msgHistory.push({
            role: 'user',
            content: [
              { type: 'text', text: 'Here is the screenshot you requested:' },
              { type: 'image_url', image_url: { url: result.imageDataUrl } },
            ],
          });
        }
      }
    }
  } catch (err) {
    // A cancel surfaces as an AbortError from the in-flight streamCompletion; swallow it and
    // fall through to a clean 'done'. Any other error propagates to chat()'s catch → 'error'.
    if (!isAbort(err) && !signal?.aborted) throw err;
  }

  emitter.emit('done', { aborted: !!signal?.aborted });
}

// Resolves a Drive's/Space's system prompt (persona/instructions) ONLY. Model selection is
// deliberately NOT something a Drive or Space can dictate — it's a user preference (the global
// ai_default_model setting, or a per-site override the AI sidebar keeps in hyper://private/), so
// an untrusted Drive can't silently steer which model runs its instructions. See runChat's model
// resolution below.
async function resolveAiConfig(sender, driveUrl = null) {
  // A caller editing a Drive it isn't itself (e.g. a remote-turn synthetic sender) passes the
  // target Drive's URL explicitly; otherwise fall back to the sender's own URL — the normal case,
  // where `sender` already IS the page/tab whose Drive this is (a content page's own
  // nomad.ai.chat() call, or the shell AI sidebar's sender, which is always the active tab).
  const senderUrl = driveUrl || sender.getURL();
  const ctx = { sender };

  // 1. Drive's /index.json
  if (senderUrl.startsWith('hyper://')) {
    try {
      const base = driveBaseUrl(senderUrl);
      const indexStr = await readTextOrNull(ctx, fullDriveUrl(base, '/index.json'));
      if (indexStr) {
        const index = JSON.parse(indexStr);
        if (index.ai) {
          // A string `ai` value points at another Drive's AI Config (its /ai/system.md).
          const aiBase = typeof index.ai === 'string' ? driveBaseUrl(index.ai) : base;
          const systemPrompt = await readTextOrNull(ctx, fullDriveUrl(aiBase, '/ai/system.md'));
          return { systemPrompt };
        }
      }
    } catch {
      // fall through
    }
  }

  // 2. Space default
  const tab = findTab(sender);
  const spaceId = tab?.spaceId;
  if (spaceId) {
    const spaceDefault = await settingsDb.getForSpace(spaceId, 'ai_space_default');
    if (spaceDefault) {
      try {
        const aiBase = driveBaseUrl(spaceDefault);
        const systemPrompt = await readTextOrNull(ctx, fullDriveUrl(aiBase, '/ai/system.md'));
        return { systemPrompt };
      } catch {
        // fall through
      }
    }
  }

  // 3. No Drive/Space system prompt — bare inference.
  return { systemPrompt: null };
}

async function executeTool(name, args, sender, opts: any = {}) {
  const {
    driveUrl = null,
    emitter = null,
    requestPermission = null,
    draft = false,
    pageToolsWcId = null,
    remote = false,
    signal = null,
  } = opts;
  // WebMCP page tool — round-trip to the renderer that registered it. Access was already
  // consented per-origin in resolvePageTools(); running it can only do what page JS can do.
  // `remote` is re-checked here (not just where the tool LIST is built in resolvePageTools) as
  // defense in depth: page tools must never run for a remote Bridge turn, since pageToolsWcId on
  // that path would be a bare number deserialized off the wire from a peer Device, naming a tab
  // that peer has no business reaching into.
  if (name.startsWith('page_')) {
    if (remote || !pageToolsWcId) throw new Error('Page tools are not available in this context');
    modelContext.trace('page tool call', { name, args });
    const res = await modelContext.invokePageTool(pageToolsWcId, name.slice(5), args, { signal });
    modelContext.trace('page tool result', { name, result: res });
    return pageToolResultToText(res);
  }

  // Consent gate for writes. Locally this is the app's permission prompt; on the Bridge the
  // Provider passes an override that relays the prompt back to the Client (ADR-0013 §6).
  const permit = requestPermission || permissions.requestPermission;
  const senderUrl = driveUrl || sender.getURL();
  const ctx = { sender };
  const requireDrive = () => {
    if (!senderUrl.startsWith('hyper://')) throw new Error('Not browsing a Drive');
    return driveBaseUrl(senderUrl);
  };

  switch (name) {
    case 'readDriveFile': {
      const base = requireDrive();
      // Route through nomad.fs (fsAPI) so BOTH drive backends work — the raw
      // per-writer Hyperdrive read hangs on an Autobase collaborative drive.
      const text = await readTextOrNull(ctx, fullDriveUrl(base, args.path));
      if (text === null) throw new Error(`File not found: ${args.path}`);
      return text;
    }
    case 'listDriveFiles': {
      const base = requireDrive();
      const entries = await fsAPI.list.call(ctx, fullDriveUrl(base, args.path || '/'), {});
      return JSON.stringify((entries || []).map((e) => e.key ?? e.name ?? e));
    }
    case 'fetchUrl': {
      const urlp = new URL(args.url);
      if (urlp.protocol !== 'http:' && urlp.protocol !== 'https:') {
        throw new Error('Only http and https URLs are supported');
      }
      return fetchText(args.url);
    }
    case 'writeDriveFile': {
      const base = requireDrive();
      // LLMs frequently append a trailing slash to a file path; strip it. Reject
      // only when nothing but slashes is left (i.e. the Drive root / a directory),
      // returning a corrective message so the model retries with a real filename.
      const cleanPath = String(args.path || '').replace(/\/+$/, '');
      if (!cleanPath || cleanPath === '') {
        throw new Error(
          `Invalid path "${args.path}": provide a full file path including a filename (e.g. /index.html), not a directory.`
        );
      }
      const target = fullDriveUrl(base, cleanPath);
      const driveKey = parseDriveUrl(senderUrl).hostname;
      const allowed = await permit('modifyDrive:' + driveKey, sender);
      if (!allowed) throw new Error('Write permission denied');
      // Capture the file's pre-write content (or null if it didn't exist) BEFORE
      // overwriting, so the editor can build a per-turn undo Checkpoint. This is
      // the only place that still knows the prior state.
      const priorContent = await readTextOrNull(ctx, target);
      // `draft:true` (remote AI edits) stages into the Drive's Vault-hosted Draft instead of writing
      // the live Drive, so the change is reviewable/publishable (ADR-0012).
      await fsAPI.writeFile.call(ctx, target, args.content, draft ? { draft: true } : {});
      if (emitter) {
        emitter.emit('tool', { phase: 'write', name: 'writeDriveFile', path: cleanPath, priorContent, draft: !!draft });
      }
      return `File written successfully to ${cleanPath}`;
    }
    case 'readCurrentPage': {
      // `sender` is the relevant webContents in every caller (the tab itself for a content page's
      // own nomad.ai.chat(), or the active tab's pane.webContents for the shell AI sidebar — see
      // ai-shell.ts) — so this just reads whatever page that webContents currently has loaded.
      if (typeof sender.executeJavaScript !== 'function') {
        throw new Error('Reading page content is not available for this request');
      }
      let text;
      try {
        text = await sender.executeJavaScript(
          'document.body ? document.body.innerText : document.documentElement.outerHTML'
        );
      } catch (err) {
        throw new Error(`Could not read this page's content: ${err.message}`);
      }
      if (typeof text !== 'string' || !text.trim()) {
        return '(This page has no readable text content.)';
      }
      const MAX = 20000;
      return text.length > MAX ? text.slice(0, MAX) + '\n…[truncated]' : text;
    }
    case 'screenshotCurrentPage': {
      // Only ever reached when runChat included the tool, which only happens when opts.allowVision
      // was set (the caller confirmed via modelInfo that the resolved model supports image input)
      // — see BUILTIN_TOOLS filtering above. Returns { text, imageDataUrl }, a shape the tool loop
      // (below) recognises and turns into a follow-up multimodal user message — most OpenAI-
      // compatible servers don't support image content on a `tool`-role message itself.
      if (typeof sender.capturePage !== 'function') {
        throw new Error('Screenshots are not available for this request');
      }
      let dataUrl;
      try {
        let image = await sender.capturePage();
        const { width } = image.getSize();
        const MAX_WIDTH = 1280;
        if (width > MAX_WIDTH) image = image.resize({ width: MAX_WIDTH });
        dataUrl = image.toDataURL();
      } catch (err) {
        throw new Error(`Could not capture this page: ${err.message}`);
      }
      // The model only ever gets a text description back from a tool call — it has no way to
      // "show" the image itself. Emit it separately so the chat UI can render it for the human,
      // the same way writeDriveFile's 'write' event drives the file-checkpoint UI above.
      if (emitter) {
        emitter.emit('tool', { phase: 'screenshot', name: 'screenshotCurrentPage', imageDataUrl: dataUrl });
      }
      return { text: 'Screenshot captured (attached).', imageDataUrl: dataUrl };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Resolve the current page's WebMCP tools into OpenAI function defs, after a one-time
// per-origin permission prompt. Returns [] on the remote path, when the page has none, or
// when the user declines.
async function resolvePageTools(opts, sender, emitter) {
  if (!opts.usePageTools || !opts.pageToolsWcId || opts.remote) {
    modelContext.trace('resolvePageTools skipped', {
      usePageTools: !!opts.usePageTools,
      wc: opts.pageToolsWcId || null,
      remote: !!opts.remote,
    });
    return [];
  }
  const descriptors = modelContext.getPageToolsForWc(opts.pageToolsWcId);
  modelContext.trace('resolvePageTools', {
    wc: opts.pageToolsWcId,
    found: descriptors.map((t) => t.name),
  });
  if (!descriptors.length) return [];

  const origin = modelContext.getPageToolsOrigin(opts.pageToolsWcId) || 'unknown';
  const permit = opts.requestPermission || permissions.requestPermission;
  let allowed = false;
  try {
    allowed = await permit('webmcpTools:' + origin, sender);
  } catch {
    allowed = false;
  }
  modelContext.trace('webmcpTools permission', { origin, allowed });
  if (!allowed) {
    emitter?.emit('tool', {
      phase: 'note',
      name: 'webmcp',
      summary: 'This page offers tools to the assistant, but access was not granted.',
    });
    return [];
  }

  return descriptors.map((t) => ({
    type: 'function',
    function: {
      name: 'page_' + t.name,
      description: t.description || '',
      parameters: jsonSchemaToParameters(t.inputSchema),
    },
  }));
}

// Human-readable one-liner describing a tool call, shown live in the sidebar.
function toolSummary(name, args) {
  if (name.startsWith('page_')) return `Running ${name.slice(5)}`;
  switch (name) {
    case 'readDriveFile':
      return `Reading ${args.path || ''}`.trim();
    case 'listDriveFiles':
      return `Listing ${args.path || '/'}`.trim();
    case 'writeDriveFile':
      return `Writing ${args.path || ''}`.trim();
    case 'fetchUrl':
      return `Fetching ${args.url || ''}`.trim();
    case 'readCurrentPage':
      return 'Reading this page';
    case 'screenshotCurrentPage':
      return 'Taking a screenshot';
    default:
      return name;
  }
}

// A drive's origin (scheme + key), without any path. `nomad.fs` is URL-first, so
// tool/config reads build a full `hyper://<key>/<path>` and let fsAPI dispatch to
// the right backend (single-writer Hyperdrive vs multi-writer Autobase).
function driveBaseUrl(url) {
  return `hyper://${parseDriveUrl(url).hostname}`;
}

function fullDriveUrl(base, path) {
  if (!path) path = '/';
  return base + (path.startsWith('/') ? path : '/' + path);
}

// Read a Drive file as text via fsAPI (backend-agnostic, with a built-in read
// timeout). Returns null on a missing file or any read failure.
async function readTextOrNull(ctx, url) {
  try {
    const v = await fsAPI.readFile.call(ctx, url, 'utf8');
    if (v === null || v === undefined) return null;
    return typeof v === 'string' ? v : b4a.toString(v);
  } catch {
    return null;
  }
}


function fetchText(url) {
  return new Promise((resolve, reject) => {
    const urlp = new URL(url);
    const proto = urlp.protocol === 'https:' ? https : http;
    proto
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

// `token` (optional): the ai_access_token setting, sent as `Authorization: Bearer <token>` —
// only ever aimed at the configured AI runtime (never at arbitrary URLs; see fetchText above).
function fetchJson(url, token?) {
  return new Promise((resolve, reject) => {
    const urlp = new URL(url);
    const proto = urlp.protocol === 'https:' ? https : http;
    proto
      .get(url, { headers: aiBridge.authHeaders(token) }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Server returned ${res.statusCode}`));
        }
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Invalid JSON response'));
          }
        });
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

// POST a JSON body and parse a JSON response. Used to probe Ollama's `/api/show` for a model's
// `capabilities` (reveals whether it's a reasoning model).
function postJson(url, payload, token?) {
  return new Promise((resolve, reject) => {
    const urlp = new URL(url);
    const body = JSON.stringify(payload);
    const proto = urlp.protocol === 'https:' ? https : http;
    const req = proto.request(
      {
        hostname: urlp.hostname,
        port: urlp.port || (urlp.protocol === 'https:' ? 443 : 80),
        path: urlp.pathname + urlp.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...aiBridge.authHeaders(token),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Server returned ${res.statusCode}`));
        }
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Invalid JSON response'));
          }
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function streamCompletion(baseUrl, model, messages, tools, emitter, signal?, opts: any = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const endpoint = baseUrl.replace(/\/$/, '') + '/chat/completions';
    const urlp = new URL(endpoint);

    // `think:false` asks the runtime to skip its reasoning phase. `think` is Ollama's flag;
    // `chat_template_kwargs.enable_thinking` covers the llama.cpp / vLLM Qwen path. Only sent
    // on an explicit false, so the default body is byte-for-byte unchanged. Local runtimes
    // ignore unknown fields; a strict OpenAI endpoint could 400 (acceptable — local-AI only).
    const noThink = opts.think === false;
    // `reasoning_effort` is the OpenAI-standard knob (also honoured by Ollama / llama.cpp for
    // reasoning models); only sent when thinking is on and the UI picked a level.
    const effort = ['low', 'medium', 'high'].includes(opts.effort) ? opts.effort : null;
    const body = JSON.stringify({
      model,
      messages,
      tools,
      stream: true,
      ...(noThink ? { think: false, chat_template_kwargs: { enable_thinking: false } } : {}),
      ...(!noThink && effort ? { reasoning_effort: effort } : {}),
    });

    const proto = urlp.protocol === 'https:' ? https : http;
    const req = proto.request(
      {
        hostname: urlp.hostname,
        port: urlp.port || (urlp.protocol === 'https:' ? 443 : 80),
        path: urlp.pathname + urlp.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...aiBridge.authHeaders(opts.token),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          // Capture the runtime's error body — LM Studio/Ollama return a JSON/text reason (bad
          // model name, template/tool error, etc.) that is far more useful than a bare status code.
          let errBody = '';
          res.on('data', (chunk) => {
            errBody += chunk.toString();
          });
          res.on('end', () => settle(reject, runtimeError(res.statusCode, errBody, tools, !!opts.token)));
          res.on('error', () => settle(reject, runtimeError(res.statusCode, errBody, tools, !!opts.token)));
          return;
        }

        let buffer = '';
        const toolCallAccum = {};
        let finishReason = null;
        let textContent = '';

        res.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep incomplete line

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            let parsed;
            try {
              parsed = JSON.parse(data);
            } catch {
              continue;
            }

            const choice = parsed.choices?.[0];
            if (!choice) continue;
            if (choice.finish_reason) finishReason = choice.finish_reason;

            const delta = choice.delta;
            if (!delta) continue;

            // Reasoning tokens arrive on a side channel (`reasoning_content` for Ollama/DeepSeek,
            // `reasoning` for others). Forward them as `reasoning` events — never into textContent,
            // which is the visible answer and the tool-loop's assistant message.
            const reasoning = delta.reasoning_content ?? delta.reasoning;
            if (typeof reasoning === 'string' && reasoning) {
              emitter.emit('reasoning', { text: reasoning });
            }

            if (delta.content) {
              textContent += delta.content;
              emitter.emit('chunk', { text: delta.content });
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                if (!toolCallAccum[idx]) {
                  toolCallAccum[idx] = {
                    id: '',
                    type: 'function',
                    function: { name: '', arguments: '' },
                  };
                }
                if (tc.id) toolCallAccum[idx].id += tc.id;
                if (tc.function?.name) toolCallAccum[idx].function.name += tc.function.name;
                if (tc.function?.arguments)
                  toolCallAccum[idx].function.arguments += tc.function.arguments;
              }
            }
          }
        });

        res.on('end', () =>
          settle(resolve, {
            finishReason,
            toolCalls: Object.values(toolCallAccum),
            textContent,
          })
        );
        res.on('error', (err) => settle(reject, err));
      }
    );

    // Cancellation: destroy the in-flight request so we stop burning inference the moment the
    // consumer (local stream close, or a remote CANCEL frame) aborts. Idempotent via `settled`.
    let settled = false;
    const onAbort = () => {
      try {
        req.destroy();
      } catch {}
      settle(reject, abortError());
    };
    function settle(fn, arg) {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(arg);
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    req.on('error', (err) => settle(reject, err));
    req.write(body);
    req.end();
  });
}

// A cancel is a normal, expected stop — not a failure. runChat swallows it and ends the stream
// cleanly rather than emitting an 'error', so the Client sees a graceful halt.
function abortError() {
  const err: any = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

function isAbort(err) {
  return err && (err.name === 'AbortError' || err.message === 'aborted');
}

// Build a human, actionable error from a non-200 AI Runtime response. Pulls the runtime's own
// message out of its JSON/text body, and — when a tool-enabled request fails on a template/role
// error (the classic "this model can't do function-calling" symptom) — adds a concrete next step.
// `hasToken`: whether ai_access_token was set for this request, so a 401/403 says plainly whether
// a token was sent at all rather than leaving that to guesswork (mirrors testConnection's hint).
function runtimeError(status, body, tools, hasToken) {
  let detail = '';
  try {
    const j = JSON.parse(body);
    detail =
      (j && j.error && (j.error.message || (typeof j.error === 'string' ? j.error : ''))) ||
      (j && j.message) ||
      '';
  } catch {
    /* not JSON */
  }
  if (!detail) detail = String(body || '').trim().slice(0, 300);

  let msg = `AI Runtime error ${status}` + (detail ? `: ${detail}` : '');
  if (status === 401 || status === 403) {
    msg += hasToken
      ? ' — the access token was sent but rejected; check it in Settings → AI.'
      : ' — no access token is set for this runtime (Settings → AI); it may require one.';
  }
  // NOT a bare \brole\b — a plain "messages.N.role" enum-validation error (e.g. an invalid role
  // slipping into history) matches that and wrongly blames tool support instead of the real bug.
  const toolRelated = /tool|function[-_ ]?call|template|jinja/i.test(detail);
  if (tools && tools.length && (toolRelated || status >= 500)) {
    msg +=
      ' — the selected model likely does not support tool-calling. Load a tool-capable model ' +
      '(e.g. Qwen2.5-Instruct, Llama 3.1-Instruct) for reads/writes that use the Drive tools.';
  }
  return new Error(msg);
}
