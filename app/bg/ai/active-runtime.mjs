// The runtime Settings → AI has selected: saved servers plus whatever Claude,
// Cursor, Ollama, or LM Studio is actually present. Reads settings on each call
// so a change in the settings page applies to the next chat turn.

import { execFile, spawn } from 'child_process';
import * as settingsDb from '../dbs/settings';
import { detectRuntimes } from './detect-runtimes.mjs';
import { createAgentReducer, parseClaudeModels, parseCursorModels } from './agent-stream.mjs';
import { CLAUDE_MODELS, resolveServers, pickActive, sameBaseUrl } from './runtimes.mjs';

async function readConfig() {
  const [raw, legacyUrl, legacyToken, active, model, migrated] = await Promise.all([
    settingsDb.get('ai_servers'),
    settingsDb.get('ai_base_url'),
    settingsDb.get('ai_access_token'),
    settingsDb.get('ai_active'),
    settingsDb.get('ai_default_model'),
    settingsDb.get('ai_runtimes_migrated'),
  ]);
  const already = Number(migrated) === 1;
  const { servers, changed } = resolveServers(raw, legacyUrl, legacyToken, already);
  let activeId = typeof active === 'string' ? active : '';
  if (changed) {
    await settingsDb.set('ai_servers', servers);
    if (!activeId && servers[0]) {
      activeId = servers[0].id;
      await settingsDb.set('ai_active', activeId);
    }
  }
  if (!already) await settingsDb.set('ai_runtimes_migrated', 1);
  return { servers, activeId, model: typeof model === 'string' ? model : '' };
}

export async function getActiveRuntime() {
  const { servers, activeId, model } = await readConfig();
  const detected = await detectRuntimes();
  const runtime = pickActive(servers, detected, activeId);
  return { runtime, model, servers, detected };
}

export async function listRuntimeCatalog() {
  const { servers, activeId, model } = await readConfig();
  const detected = await detectRuntimes();
  const visibleDetected = detected.filter(
    (entry) =>
      entry.kind !== 'openai' ||
      !servers.some((server) => sameBaseUrl(server.baseUrl, entry.baseUrl))
  );
  const active = pickActive(servers, detected, activeId);
  const runtimes = [...visibleDetected, ...servers].map((runtime) => ({
    id: runtime.id,
    name: runtime.name,
    kind: runtime.kind,
    detected: !!runtime.detected,
    available: runtime.available !== false,
    baseUrl: runtime.baseUrl || '',
    hasToken: !!runtime.accessToken,
  }));
  return { active: active?.id || '', model, runtimes };
}

// Probe a CLI runtime to verify it is installed and the user is logged in.
// Returns { ok, models } on success or { ok: false, error } on failure.
export async function testCliRuntime(kind) {
  const detected = await detectRuntimes();
  const entry = detected.find((r) => r.kind === kind);
  const bin = entry?.bin || null;
  if (kind === 'claude') return testClaude(bin);
  if (kind === 'cursor') return testCursor(bin);
  return { ok: false, error: `Unknown CLI runtime: ${kind}` };
}

function testClaude(bin) {
  return new Promise((resolve) => {
    if (!bin) {
      return resolve({ ok: false, error: 'Claude CLI not found. Install it from claude.ai/download.' });
    }
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--tools', '',
      '--dangerously-skip-permissions',
    ];
    const child = execFile(bin, args, { timeout: 15000, env: process.env }, (err, stdout, stderr) => {
      const reduce = createAgentReducer();
      let errorText = null;
      for (const line of String(stdout || '').split('\n')) {
        for (const event of reduce(line)) {
          if (event.type === 'error') { errorText = event.text; break; }
        }
        if (errorText) break;
      }
      if (errorText) return resolve({ ok: false, error: errorText });
      if (err) {
        const detail = String(stderr || '').trim().slice(0, 300) || err.message || 'Claude CLI failed';
        return resolve({ ok: false, error: detail });
      }
      listClaudeModels(bin).then((models) => resolve({ ok: true, models: models.length }));
    });
    child.stdin.end('hi');
  });
}

function testCursor(bin) {
  return new Promise((resolve) => {
    if (!bin) {
      return resolve({ ok: false, error: 'cursor-agent not found. Open Cursor once to install it.' });
    }
    listCursorModels(bin)
      .then((models) => {
        if (!models.length) return resolve({ ok: false, error: 'cursor-agent is not available or not signed in.' });
        resolve({ ok: true, models: models.length });
      })
      .catch(() => resolve({ ok: false, error: 'Could not reach cursor-agent.' }));
  });
}

// A CLI runtime's models as { models, labels }: `models` are the values to pass to --model,
// `labels` maps a value to a readable name where the CLI gives one. null for a server runtime.
export async function modelsForRuntime(runtime) {
  if (!runtime || runtime.available === false) return { models: [], labels: {} };
  if (runtime.kind === 'claude') {
    const list = await listClaudeModels(runtime.bin);
    return { models: list.map((m) => m.value), labels: Object.fromEntries(list.map((m) => [m.value, m.label])) };
  }
  if (runtime.kind === 'cursor') return { models: await listCursorModels(runtime.bin), labels: {} };
  return null;
}

// Ask the `claude` CLI for its models: the same `initialize` control request the Agent SDK sends
// for supportedModels(). It needs no prompt and makes no model call. The list only changes when
// the CLI updates, so keep it for a while. Falls back to the plain aliases if the CLI won't answer.
const CLAUDE_MODELS_TTL = 10 * 60 * 1000;
let claudeModelsCache = null; // { bin, at, list }

function listClaudeModels(bin) {
  const fallback = CLAUDE_MODELS.map((value) => ({ value, label: value }));
  if (!bin) return Promise.resolve(fallback);
  const c = claudeModelsCache;
  if (c && c.bin === bin && Date.now() - c.at < CLAUDE_MODELS_TTL) return Promise.resolve(c.list);
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (list) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      if (list.length) claudeModelsCache = { bin, at: Date.now(), list };
      resolve(list.length ? list : fallback);
    };
    const child = spawn(
      bin,
      ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'],
      { env: process.env, stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const timer = setTimeout(() => finish([]), 10000);
    child.on('error', () => finish([]));
    child.on('close', () => finish(parseClaudeModels(out)));
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.includes('"control_response"')) {
        const list = parseClaudeModels(out);
        if (list.length) finish(list);
      }
    });
    child.stdin.write(
      JSON.stringify({ type: 'control_request', request_id: 'nomad-models', request: { subtype: 'initialize' } }) + '\n'
    );
  });
}

function listCursorModels(bin) {
  return new Promise((resolve) => {
    execFile(bin, ['--list-models'], { timeout: 8000 }, (err, stdout, stderr) => {
      resolve(parseCursorModels(`${stdout || ''}\n${stderr || ''}`));
    });
  });
}
