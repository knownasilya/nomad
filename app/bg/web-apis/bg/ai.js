// @ts-nocheck
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
  chat(messages) {
    const emitter = new EventEmitter();
    const stream = emitStream(emitter);
    const sender = this.sender;

    runChat(messages, sender, emitter).catch((err) => {
      emitter.emit('data', ['error', { message: err.message }]);
      emitter.emit('end');
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
    throw new Error('No AI model configured. Set ai_default_model in settings or add {"ai": {"model": "..."}} to your Drive\'s index.json.');
  }

  const fullMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : [...messages];

  let msgHistory = fullMessages;

  // Tool loop — repeats when model calls tools
  while (true) {
    const { finishReason, toolCalls, textContent } = await streamCompletion(
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
        result = `Error: ${err.message}`;
      }
      msgHistory.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  emitter.emit('data', ['done', {}]);
  emitter.emit('end');
}

async function resolveAiConfig(sender) {
  const senderUrl = sender.getURL();

  // 1. Drive's /index.json
  if (senderUrl.startsWith('hyper://')) {
    try {
      const urlp = parseDriveUrl(senderUrl);
      const driveKey = await drives.fromURLToKey(urlp.hostname, true);
      const drive = drives.getDrive(driveKey) || (await drives.loadDrive(driveKey));
      const indexBuf = await drive.get('/index.json');
      if (indexBuf) {
        const index = JSON.parse(b4a.toString(indexBuf));
        if (index.ai) {
          let aiDrive = drive;
          let model = null;
          if (typeof index.ai === 'string') {
            // Pointer to another drive's AI Config
            const targetUrlp = parseDriveUrl(index.ai);
            const targetKey = await drives.fromURLToKey(targetUrlp.hostname, true);
            aiDrive = drives.getDrive(targetKey) || (await drives.loadDrive(targetKey));
            const targetIndexBuf = await aiDrive.get('/index.json');
            if (targetIndexBuf) {
              const targetIndex = JSON.parse(b4a.toString(targetIndexBuf));
              model = targetIndex.ai?.model || null;
            }
          } else if (typeof index.ai === 'object') {
            model = index.ai.model || null;
          }
          const sysBuf = await aiDrive.get('/ai/system.md');
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
        const aiDrive = drives.getDrive(targetKey) || (await drives.loadDrive(targetKey));
        const sysBuf = await aiDrive.get('/ai/system.md');
        const systemPrompt = sysBuf ? b4a.toString(sysBuf) : null;
        const indexBuf = await aiDrive.get('/index.json');
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
      await drive.put(args.path, b4a.from(args.content));
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
    return drives.getDrive(driveKey) || (await drives.loadDrive(driveKey));
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
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data));
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
            try { parsed = JSON.parse(data); } catch { continue; }

            const choice = parsed.choices?.[0];
            if (!choice) continue;
            if (choice.finish_reason) finishReason = choice.finish_reason;

            const delta = choice.delta;
            if (!delta) continue;

            if (delta.content) {
              textContent += delta.content;
              emitter.emit('data', ['chunk', { text: delta.content }]);
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
                if (tc.function?.arguments) toolCallAccum[idx].function.arguments += tc.function.arguments;
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
