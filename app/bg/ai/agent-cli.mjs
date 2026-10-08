// One-shot chat through the Claude or Cursor CLI already logged in on this machine.
// Claude is started with its shell and file tools off, and with Nomad's loopback MCP
// as the only server, so search/execute still run inside Nomad. Cursor is started in
// ask mode in an empty workspace so it answers without editing the project.

import { spawn } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  claudeUserLine,
  createAgentReducer,
  imageBlocks,
  promptFromMessages,
} from './agent-stream.mjs';

export function streamAgent(runtime, messages, emitter, signal, { mcpUrl } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    let child;
    let settled = false;
    let cleanup = () => {};
    const reduce = createAgentReducer();
    let stderr = '';
    let text = '';
    let system = '';
    let prompt = '';
    let stdin = '';
    let photoDir = null;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(arg);
    };
    const onAbort = () => {
      try {
        child?.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      finish(reject, abortError());
    };
    if (signal) signal.addEventListener('abort', onAbort);

    prepare()
      .then((proc) => {
        if (settled) {
          try {
            proc.kill('SIGTERM');
          } catch {
            /* ignore */
          }
          return;
        }
        child = proc;
        let buffer = '';
        proc.stdout.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) apply(line);
        });
        proc.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
          if (stderr.length > 4000) stderr = stderr.slice(-4000);
        });
        proc.on('error', (err) => finish(reject, err));
        proc.on('close', (code) => {
          if (buffer.trim()) apply(buffer);
          cleanup();
          if (settled) return;
          if (code && !text) {
            finish(
              reject,
              new Error((stderr || `${runtime.name} exited ${code}`).trim().slice(0, 500))
            );
            return;
          }
          finish(resolve, { finishReason: 'stop', toolCalls: [], textContent: text });
        });
        proc.stdin.end(stdin);
      })
      .catch((err) => {
        try {
          cleanup();
        } catch {
          /* the temp photo dir is removed on the next attempt */
        }
        finish(reject, err);
      });

    function apply(line) {
      for (const event of reduce(line)) {
        if (event.type === 'text') {
          text += event.text;
          emitter.emit('chunk', { text: event.text });
        } else if (event.type === 'tool') {
          emitter.emit('tool', { phase: 'start', name: event.name, summary: event.name });
        } else if (event.type === 'error') {
          try { child?.kill('SIGTERM'); } catch { /* already gone */ }
          finish(reject, new Error(event.text));
        }
      }
    }

    async function prepare() {
      let args;
      if (runtime.kind === 'cursor') {
        // Cursor runs in ask mode inside the photo folder, so it can open the files.
        const photos = await materializePromptImages(messages);
        photoDir = photos.dir;
        const built = promptFromMessages(photos.messages);
        system = built.system;
        prompt = built.prompt;
        stdin = system ? `${system}\n\n${prompt}` : prompt;
        args = cursorArgs(runtime, photoDir);
        cleanup = () => {
          if (photoDir) rm(photoDir, { recursive: true, force: true }).catch(() => {});
        };
      } else {
        // Claude's tools are off, so a photo goes inline as an image block.
        const built = promptFromMessages(messages);
        const images = imageBlocks(messages);
        system = built.system;
        prompt = built.prompt;
        stdin = images.length ? claudeUserLine(prompt, images) : prompt;
        const prepared = await claudeArgs(runtime, system, mcpUrl, images.length > 0);
        args = prepared.args;
        cleanup = prepared.cleanup;
      }
      return spawn(runtime.bin, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
    }
  });
}

function cursorArgs(runtime, workspace) {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--stream-partial-output',
    '--mode',
    'ask',
    '--trust',
    '--workspace',
    workspace || os.tmpdir(),
    '--model',
    runtime.model,
  ];
}

async function materializePromptImages(messages) {
  const found = [];
  for (const message of messages || []) {
    if (!Array.isArray(message?.content)) continue;
    for (const part of message.content) {
      if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') found.push(part);
    }
  }
  if (!found.length) return { messages, dir: null };
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nomad-photo-'));
  let n = 0;
  const next = [];
  for (const message of messages) {
    if (!Array.isArray(message?.content)) {
      next.push(message);
      continue;
    }
    const parts = [];
    for (const part of message.content) {
      if (part?.type !== 'image_url') {
        parts.push(part);
        continue;
      }
      const name = await writeDataImage(dir, part.image_url && part.image_url.url, n);
      if (name) {
        n += 1;
        parts.push({ type: 'text', text: 'Photo file: ' + name });
      }
    }
    next.push({ ...message, content: parts });
  }
  if (!n) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    return { messages, dir: null };
  }
  return { messages: next, dir };
}

async function writeDataImage(dir, url, index) {
  const match = String(url || '').match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match || match[2].length > 8_000_000) return null;
  const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const name = 'photo-' + (index + 1) + '.' + ext;
  await writeFile(path.join(dir, name), Buffer.from(match[2].replace(/\s/g, ''), 'base64'));
  return name;
}

async function claudeArgs(runtime, system, mcpUrl, streamInput) {
  const args = [
    '-p',
    '--model',
    runtime.model,
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--tools',
    '',
    '--dangerously-skip-permissions',
  ];
  if (streamInput) args.push('--input-format', 'stream-json');
  if (system) args.push('--append-system-prompt', system);
  let cleanup = () => {};
  if (mcpUrl && process.env.NOMAD_MCP !== '0') {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'nomad-mcp-'));
    const file = path.join(dir, 'mcp.json');
    await writeFile(
      file,
      JSON.stringify({
        mcpServers: { nomad: { type: 'http', url: mcpUrl } },
      })
    );
    args.push('--strict-mcp-config', '--mcp-config', file);
    cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return { args, cleanup };
}

function abortError() {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}
