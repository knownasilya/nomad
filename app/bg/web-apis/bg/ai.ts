import EventEmitter from 'events';
import emitStream from 'emit-stream';
import http from 'http';
import https from 'https';
import b4a from 'b4a';
import { URL } from 'url';
import * as settingsDb from '../../dbs/settings';
import * as permissions from '../../ui/permissions';
import { parseDriveUrl } from '../../../lib/urls';
import { findTab } from '../../ui/tabs/manager';
import fsAPI from './fs';
import * as daemon from '../../hyper/daemon';
import * as aiBridge from '../../hyper/ai-bridge';

// Built-in system context always appended to every conversation's system prompt.
// KEEP IN SYNC with nomad.dev/content/docs/api/apis/ — when a new API is added
// or an existing method signature changes, update both the docs and this string.
const NOMAD_API_REFERENCE = `\
You are an AI assistant embedded in Nomad, a peer-to-peer web browser that hosts and serves websites via Hyperdrive (hyper:// protocol). Pages running in Nomad have access to the following JavaScript APIs under the global \`nomad\` object:

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
for await (const chunk of nomad.ai.chat(messages)) {
  process(chunk) // string chunk streamed from the model
}
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

Example: on \`hyper://abc.../\` you would check for \`/index.html\` first, then \`/index.md\`, then \`/index.txt\`, and edit whichever one exists. Use \`nomad.fs.stat()\` to test existence.`;

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
];

export default {
  async testConnection(baseUrl) {
    const url = (baseUrl || 'http://localhost:11434/v1').replace(/\/$/, '') + '/models';
    try {
      const data: any = await fetchJson(url);
      return { ok: true, models: data.data?.length ?? 0 };
    } catch (err) {
      return { ok: false, error: err.message || 'Could not connect' };
    }
  },

  // opts (optional):
  //   driveUrl   — resolve tools + AI Config against this Drive instead of the
  //                sender's URL. The editor's AI Sidebar passes the edited Drive
  //                here (its own sender is nomad://editor, not the Drive).
  //   allowWrite — when false, the writeDriveFile tool is withheld (read-only Drives).
  chat(messages, opts) {
    const emitter = new EventEmitter();
    emitter.on('error', () => {}); // prevent unhandled-error throw
    const stream = emitStream(emitter);
    const sender = this.sender;

    // Local cancellation: if the consumer closes the stream (navigates away, aborts the
    // request), abort the in-flight turn so we stop burning inference. The remote (Bridge)
    // path forwards this same signal as a CANCEL frame.
    const controller = new AbortController();
    stream.on('close', () => controller.abort());

    routeChat(messages, sender, emitter, { ...(opts || {}), signal: controller.signal })
      .then(() => {
        stream.end();
      })
      .catch((err) => {
        console.error('[ai] chat error:', err);
        emitter.emit('error', { message: err.message });
        stream.end();
      });

    return stream;
  },
};

// Route one turn: local-first, remote-fallback (ADR-0013 §4). If THIS Device can reach its own
// AI Runtime, run the loop locally. Otherwise forward to an online AI Provider over the Bridge —
// a Client (mobile) always lands here; a desktop whose Runtime is down transparently borrows
// another's. If neither is available, the Bridge throws NoAiProviderError, which surfaces as a
// distinct "No AI Device is online" error rather than a hang.
async function routeChat(messages, sender, emitter, opts) {
  if (await aiBridge.localRuntimeReachable()) {
    return runChat(messages, sender, emitter, opts);
  }
  await aiBridge.requestRemoteChat({
    messages,
    opts: { driveUrl: opts.driveUrl, allowWrite: opts.allowWrite, context: opts.context },
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
  // Remote AI edits stage into the Drive's Vault-hosted Draft (ADR-0012) so the phone user can
  // review + publish, rather than writing the live Drive directly.
  await runChat(messages, sender, emitter, { ...opts, signal, requestPermission, draft: true });
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

// =
// Internal helpers
// =

async function runChat(messages, sender, emitter, opts = {}) {
  const driveUrl = opts.driveUrl || null;
  const allowWrite = opts.allowWrite !== false; // default true
  const { model, systemPrompt } = await resolveAiConfig(sender, driveUrl);
  const baseUrl = (await settingsDb.get('ai_base_url')) || 'http://localhost:11434/v1';

  // Withhold the write tool on read-only Drives so the model won't attempt edits
  // it can't make.
  const tools = allowWrite
    ? BUILTIN_TOOLS
    : BUILTIN_TOOLS.filter((t) => t.function.name !== 'writeDriveFile');

  if (!model) {
    throw new Error(
      'No AI model configured. Set ai_default_model in settings or add {"ai": {"model": "..."}} to your Drive\'s index.json.'
    );
  }

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
        baseUrl,
        model,
        msgHistory,
        tools,
        emitter,
        signal
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
          result = await executeTool(
            tc.function.name,
            args,
            sender,
            driveUrl,
            emitter,
            opts.requestPermission,
            opts.draft
          );
        } catch (err) {
          console.error(`[ai] tool "${tc.function.name}" failed:`, err);
          result = `Error: ${err.message}`;
        }
        // Include the function `name` on the tool result: it's part of the original OpenAI
        // function-calling spec and some runtimes' templates reference it when rendering the result.
        msgHistory.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: result,
        });
      }
    }
  } catch (err) {
    // A cancel surfaces as an AbortError from the in-flight streamCompletion; swallow it and
    // fall through to a clean 'done'. Any other error propagates to chat()'s catch → 'error'.
    if (!isAbort(err) && !signal?.aborted) throw err;
  }

  emitter.emit('done', { aborted: !!signal?.aborted });
}

async function resolveAiConfig(sender, driveUrl = null) {
  // The AI Sidebar edits an arbitrary Drive from nomad://editor, so it passes the
  // edited Drive's URL explicitly; fall back to the sender's own URL (chat-bubble,
  // where the page IS the Drive).
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
          let aiBase = base;
          let model = null;
          if (typeof index.ai === 'string') {
            // Pointer to another drive's AI Config
            aiBase = driveBaseUrl(index.ai);
            const targetIndexStr = await readTextOrNull(ctx, fullDriveUrl(aiBase, '/index.json'));
            if (targetIndexStr) model = JSON.parse(targetIndexStr).ai?.model || null;
          } else if (typeof index.ai === 'object') {
            model = index.ai.model || null;
          }
          const systemPrompt = await readTextOrNull(ctx, fullDriveUrl(aiBase, '/ai/system.md'));
          return { model, systemPrompt };
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
        const indexStr = await readTextOrNull(ctx, fullDriveUrl(aiBase, '/index.json'));
        const model = indexStr ? JSON.parse(indexStr).ai?.model || null : null;
        return { model, systemPrompt };
      } catch {
        // fall through
      }
    }
  }

  // 3. Global fallback — bare inference, no system prompt
  const model = await settingsDb.get('ai_default_model');
  return { model: model || null, systemPrompt: null };
}

async function executeTool(name, args, sender, driveUrl = null, emitter = null, requestPermission = null, draft = false) {
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
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Human-readable one-liner describing a tool call, shown live in the sidebar.
function toolSummary(name, args) {
  switch (name) {
    case 'readDriveFile':
      return `Reading ${args.path || ''}`.trim();
    case 'listDriveFiles':
      return `Listing ${args.path || '/'}`.trim();
    case 'writeDriveFile':
      return `Writing ${args.path || ''}`.trim();
    case 'fetchUrl':
      return `Fetching ${args.url || ''}`.trim();
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

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const urlp = new URL(url);
    const proto = urlp.protocol === 'https:' ? https : http;
    proto
      .get(url, (res) => {
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

function streamCompletion(baseUrl, model, messages, tools, emitter, signal?) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const endpoint = baseUrl.replace(/\/$/, '') + '/chat/completions';
    const urlp = new URL(endpoint);

    const body = JSON.stringify({
      model,
      messages,
      tools,
      stream: true,
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
          res.on('end', () => settle(reject, runtimeError(res.statusCode, errBody, tools)));
          res.on('error', () => settle(reject, runtimeError(res.statusCode, errBody, tools)));
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
function runtimeError(status, body, tools) {
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
  const toolRelated = /tool|function[-_ ]?call|template|jinja|\brole\b/i.test(detail);
  if (tools && tools.length && (toolRelated || status >= 500)) {
    msg +=
      ' — the selected model likely does not support tool-calling. Load a tool-capable model ' +
      '(e.g. Qwen2.5-Instruct, Llama 3.1-Instruct) for reads/writes that use the Drive tools.';
  }
  return new Error(msg);
}
