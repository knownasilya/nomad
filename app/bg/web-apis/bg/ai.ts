import EventEmitter from 'events';
import emitStream from 'emit-stream';
import http from 'http';
import https from 'https';
import b4a from 'b4a';
import { URL } from 'url';
import * as settingsDb from '../../dbs/settings';
import * as drives from '../../hyper/drives';
import * as permissions from '../../ui/permissions';
import { parseDriveUrl } from '../../../lib/urls';
import { findTab } from '../../ui/tabs/manager';

// Built-in system context always appended to every conversation's system prompt.
// KEEP IN SYNC with nomad.dev/content/docs/api/apis/ — when a new API is added
// or an existing method signature changes, update both the docs and this string.
const NOMAD_API_REFERENCE = `\
You are an AI assistant embedded in Nomad, a peer-to-peer web browser that hosts and serves websites via Hyperdrive (hyper:// protocol). Pages running in Nomad have access to the following JavaScript APIs under the global \`beaker\` object:

## beaker.fs — The filesystem API for hyper:// drives

\`beaker.fs\` is THE API for reading and writing \`hyper://\` drives. Every drive is a multi-writer
Autobase (a drive can gain writers via invites without ever changing its URL); \`beaker.fs\` handles
files, drive lifecycle, and writer management through one surface. \`stat\` carries real
\`mtime\`/\`ctime\`/\`size\`, and \`get(path, 'json')\` parses JSON for you.

\`\`\`js
// Scoped handle (paths are relative to the drive) …
const drive = beaker.fs.drive('hyper://key...')
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
const text2 = await beaker.fs.readFile('hyper://key.../index.html')
await beaker.fs.writeFile('hyper://key.../notes.txt', 'hello')
const entries = await beaker.fs.query('hyper://key.../posts/')   // listing under a prefix

// Every drive is multi-writer-capable and keeps its URL forever, but "collaborative" is a policy
// flag — LOCKED (single-writer) by default. Unlock without changing the URL:
await beaker.fs.configure(url, { collaborative: true })   // or pass { collaborative: true } to createDrive
const { collaborative } = await beaker.fs.getInfo(url)    // is it accepting writers?

// Multi-writer: invite/approve writers so others can write to the same drive (this also unlocks it)
const inviteUrl = await drive.createInvite()
await beaker.fs.claimInvite(inviteUrl)                 // recipient calls this
const requests = await drive.listRequests()            // [{ writerKey, profileUrl }]
await drive.approveRequest(writerKey)
const writers = await drive.listWriters()
\`\`\`

## beaker.shell — Browser dialogs and library management

\`\`\`js
// Dialogs
const files = await beaker.shell.selectFileDialog({ title, select: ['file'], filters: { extensions: ['png'] }, allowMultiple: true })
// => [{ path, origin, url }]

const file  = await beaker.shell.saveFileDialog({ title, defaultFilename: 'out.txt', extension: 'txt' })
const url   = await beaker.shell.selectDriveDialog({ title, writable: true, tag: 'website' })

// Library
await beaker.shell.saveDriveDialog(url)
await beaker.shell.tagDrive(url, 'website blog')
await beaker.shell.unsaveDrive(url)
const drives = await beaker.shell.listDrives({ tag: 'website', writable: true })

// Properties dialog
await beaker.shell.drivePropertiesDialog(url)
\`\`\`

## beaker.ai — AI chat (this API)

\`\`\`js
const messages = [{ role: 'user', content: 'Hello' }]
for await (const chunk of beaker.ai.chat(messages)) {
  process(chunk) // string chunk streamed from the model
}
\`\`\`

## beaker.panes — Multi-pane tab layout

\`\`\`js
beaker.panes.setAttachable()                               // mark this pane as attachable
const pane = await beaker.panes.attachToLastActivePane()   // attach to the previously focused pane
const pane = await beaker.panes.create(url, { attach: true }) // open url in a new pane
await beaker.panes.navigate(pane.id, url)
await beaker.panes.focus(pane.id)
const res  = await beaker.panes.executeJavaScript(pane.id, script)
const cssId = await beaker.panes.injectCss(pane.id, styles)
await beaker.panes.uninjectCss(pane.id, cssId)

// Events on beaker.panes
beaker.panes.addEventListener('pane-attached',  e => { /* e.detail.id */ })
beaker.panes.addEventListener('pane-detached',  e => { })
beaker.panes.addEventListener('pane-navigated', e => { /* e.detail.url */ })
\`\`\`

## beaker.peersockets — Real-time peer messaging

Messages are scoped to the current Hyperdrive and its connected peers.

\`\`\`js
// Track peers
const peerIds = new Set()
const peerEvents = beaker.peersockets.watch()
peerEvents.addEventListener('join',  e => peerIds.add(e.peerId))
peerEvents.addEventListener('leave', e => peerIds.delete(e.peerId))

// Send/receive on a named topic
const topic = beaker.peersockets.join('chat')
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

Example: on \`hyper://abc.../\` you would check for \`/index.html\` first, then \`/index.md\`, then \`/index.txt\`, and edit whichever one exists. Use \`beaker.fs.stat()\` to test existence.`;

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

  chat(messages) {
    const emitter = new EventEmitter();
    emitter.on('error', () => {}); // prevent unhandled-error throw
    const stream = emitStream(emitter);
    const sender = this.sender;

    runChat(messages, sender, emitter)
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

// =
// Internal helpers
// =

async function runChat(messages, sender, emitter) {
  const { model, systemPrompt } = await resolveAiConfig(sender);
  const baseUrl = (await settingsDb.get('ai_base_url')) || 'http://localhost:11434/v1';

  if (!model) {
    throw new Error(
      'No AI model configured. Set ai_default_model in settings or add {"ai": {"model": "..."}} to your Drive\'s index.json.'
    );
  }

  const systemContent = systemPrompt
    ? `${systemPrompt}\n\n---\n\n${NOMAD_API_REFERENCE}`
    : NOMAD_API_REFERENCE;
  const fullMessages = [{ role: 'system', content: systemContent }, ...messages];

  let msgHistory = fullMessages;

  // Tool loop — repeats when model calls tools
  while (true) {
    const { finishReason, toolCalls, textContent }: any = await streamCompletion(
      baseUrl,
      model,
      msgHistory,
      BUILTIN_TOOLS,
      emitter
    );

    if (finishReason !== 'tool_calls' || toolCalls.length === 0) break;

    // Append assistant turn (with tool calls) to history
    msgHistory.push({
      role: 'assistant',
      content: textContent || null,
      tool_calls: toolCalls,
    });

    // Execute each tool and append results
    for (const tc of toolCalls) {
      let result;
      try {
        const args = JSON.parse(tc.function.arguments || '{}');
        result = await executeTool(tc.function.name, args, sender);
      } catch (err) {
        console.error(`[ai] tool "${tc.function.name}" failed:`, err);
        result = `Error: ${err.message}`;
      }
      msgHistory.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  emitter.emit('done', {});
}

async function resolveAiConfig(sender) {
  const senderUrl = sender.getURL();

  // 1. Drive's /index.json
  if (senderUrl.startsWith('hyper://')) {
    try {
      const urlp = parseDriveUrl(senderUrl);
      const driveKey = await drives.fromURLToKey(urlp.hostname, true);
      const session = drives.getDrive(driveKey) || (await drives.loadDrive(driveKey));
      const hd = session.drive;
      const indexBuf = await hd.get('/index.json');
      if (indexBuf) {
        const index = JSON.parse(b4a.toString(indexBuf));
        if (index.ai) {
          let aiHd = hd;
          let model = null;
          if (typeof index.ai === 'string') {
            // Pointer to another drive's AI Config
            const targetUrlp = parseDriveUrl(index.ai);
            const targetKey = await drives.fromURLToKey(targetUrlp.hostname, true);
            const targetSession = drives.getDrive(targetKey) || (await drives.loadDrive(targetKey));
            aiHd = targetSession.drive;
            const targetIndexBuf = await aiHd.get('/index.json');
            if (targetIndexBuf) {
              const targetIndex = JSON.parse(b4a.toString(targetIndexBuf));
              model = targetIndex.ai?.model || null;
            }
          } else if (typeof index.ai === 'object') {
            model = index.ai.model || null;
          }
          const sysBuf = await aiHd.get('/ai/system.md');
          const systemPrompt = sysBuf ? b4a.toString(sysBuf) : null;
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
        const targetUrlp = parseDriveUrl(spaceDefault);
        const targetKey = await drives.fromURLToKey(targetUrlp.hostname, true);
        const targetSession = drives.getDrive(targetKey) || (await drives.loadDrive(targetKey));
        const aiHd = targetSession.drive;
        const sysBuf = await aiHd.get('/ai/system.md');
        const systemPrompt = sysBuf ? b4a.toString(sysBuf) : null;
        const indexBuf = await aiHd.get('/index.json');
        let model = null;
        if (indexBuf) {
          const index = JSON.parse(b4a.toString(indexBuf));
          model = index.ai?.model || null;
        }
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

async function executeTool(name, args, sender) {
  switch (name) {
    case 'readDriveFile': {
      const drive = await getCurrentDrive(sender);
      if (!drive) throw new Error('Not browsing a Drive');
      const buf = await drive.get(args.path);
      if (!buf) throw new Error(`File not found: ${args.path}`);
      return b4a.toString(buf);
    }
    case 'listDriveFiles': {
      const drive = await getCurrentDrive(sender);
      if (!drive) throw new Error('Not browsing a Drive');
      const entries = [];
      for await (const entry of drive.list(args.path || '/')) {
        entries.push(entry.key);
      }
      return JSON.stringify(entries);
    }
    case 'fetchUrl': {
      const urlp = new URL(args.url);
      if (urlp.protocol !== 'http:' && urlp.protocol !== 'https:') {
        throw new Error('Only http and https URLs are supported');
      }
      return fetchText(args.url);
    }
    case 'writeDriveFile': {
      const drive = await getCurrentDrive(sender);
      if (!drive) throw new Error('Not browsing a Drive');
      const driveKey = b4a.toString(drive.key, 'hex');
      const perm = 'modifyDrive:' + driveKey;
      const allowed = await permissions.requestPermission(perm, sender);
      if (!allowed) throw new Error('Write permission denied');
      const now = Date.now();
      const existing = await drive.entry(args.path).catch(() => null);
      const ctime = existing?.value?.metadata?.ctime || now;
      await drive.put(args.path, b4a.from(args.content), { metadata: { ctime, mtime: now } });
      return 'File written successfully';
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function getCurrentDrive(sender) {
  const senderUrl = sender.getURL();
  if (!senderUrl.startsWith('hyper://')) return null;
  try {
    const urlp = parseDriveUrl(senderUrl);
    const driveKey = await drives.fromURLToKey(urlp.hostname, true);
    const session = drives.getDrive(driveKey) || (await drives.loadDrive(driveKey));
    return session?.drive || null;
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

function streamCompletion(baseUrl, model, messages, tools, emitter) {
  return new Promise((resolve, reject) => {
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
          res.resume();
          return reject(new Error(`AI Runtime returned ${res.statusCode}`));
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
          resolve({
            finishReason,
            toolCalls: Object.values(toolCallAccum),
            textContent,
          })
        );
        res.on('error', reject);
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
