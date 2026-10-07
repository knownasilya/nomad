// The runtime Settings → AI has selected: saved servers plus whatever Claude,
// Cursor, Ollama, or LM Studio is actually present. Reads settings on each call
// so a change in the settings page applies to the next chat turn.

import { execFile } from 'child_process';
import * as settingsDb from '../dbs/settings';
import { detectRuntimes } from './detect-runtimes.mjs';
import { createAgentReducer, parseCursorModels } from './agent-stream.mjs';
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
      '--bare',
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
      resolve({ ok: true, models: CLAUDE_MODELS.length });
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

export async function modelsForRuntime(runtime) {
  if (!runtime || runtime.available === false) return [];
  if (runtime.kind === 'claude') return [...CLAUDE_MODELS];
  if (runtime.kind === 'cursor') return listCursorModels(runtime.bin);
  return null;
}

function listCursorModels(bin) {
  return new Promise((resolve) => {
    execFile(bin, ['--list-models'], { timeout: 8000 }, (err, stdout, stderr) => {
      resolve(parseCursorModels(`${stdout || ''}\n${stderr || ''}`));
    });
  });
}
