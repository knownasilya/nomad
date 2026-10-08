// Named OpenAI-compatible servers, plus the auto-detected Claude and Cursor CLIs.
// Pure: no Electron, no I/O. Detection and chat live next to this.

export const OLLAMA_URL = 'http://127.0.0.1:11434/v1';
export const LMSTUDIO_URL = 'http://127.0.0.1:1234/v1';

// Fallback when the `claude` CLI can't report its models (see listClaudeModels). These aliases
// always run the latest model of their family, so they never go stale.
export const CLAUDE_MODELS = ['opus', 'sonnet', 'haiku', 'fable'];

const RESERVED_IDS = new Set(['claude', 'cursor', 'ollama', 'lmstudio']);

export function canonicalBaseUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '')
    .replace('://localhost', '://127.0.0.1');
}

export function nameForBaseUrl(url) {
  const u = canonicalBaseUrl(url);
  if (u === canonicalBaseUrl(OLLAMA_URL)) return 'Ollama';
  if (u === canonicalBaseUrl(LMSTUDIO_URL)) return 'LM Studio';
  try {
    return new URL(u).host || 'Server';
  } catch {
    return 'Server';
  }
}

export function normalizeServers(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const baseUrl = typeof row.baseUrl === 'string' ? row.baseUrl.trim() : '';
    if (!id || !name || !baseUrl || seen.has(id) || RESERVED_IDS.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: name.slice(0, 60),
      kind: 'openai',
      baseUrl,
      accessToken: typeof row.accessToken === 'string' ? row.accessToken : '',
    });
  }
  return out;
}

// First launch still has only the legacy single URL. Turn that into one named server
// so the list the settings page edits is the only copy. Once that migration has been
// recorded, an empty list stays empty — deleting every server must not recreate one
// from the legacy URL, which settings always reports (the default counts as set).
export function resolveServers(servers, legacyUrl, legacyToken, migrated) {
  if (migrated) return { servers: normalizeServers(servers), changed: false };
  return migrateServers(servers, legacyUrl, legacyToken);
}

export function migrateServers(servers, legacyUrl, legacyToken) {
  const list = normalizeServers(servers);
  const rawLen = Array.isArray(servers) ? servers.length : 0;
  if (list.length) return { servers: list, changed: list.length !== rawLen };
  const baseUrl = typeof legacyUrl === 'string' ? legacyUrl.trim() : '';
  if (!baseUrl) return { servers: [], changed: false };
  return {
    servers: [
      {
        id: 'srv_default',
        name: nameForBaseUrl(baseUrl),
        kind: 'openai',
        baseUrl,
        accessToken: typeof legacyToken === 'string' ? legacyToken : '',
      },
    ],
    changed: true,
  };
}

// `detected` is only what is actually installed or answering. An explicit choice that
// is not in either list stays selected so chat can say it is missing, rather than
// silently running a different server.
export function pickActive(servers, detected, activeId) {
  const id = typeof activeId === 'string' ? activeId : '';
  const all = [...(detected || []), ...(servers || [])];
  if (id) {
    const hit = all.find((r) => r.id === id);
    if (hit) return hit;
    if (id === 'claude' || id === 'cursor')
      return {
        id,
        name: id === 'claude' ? 'Claude' : 'Cursor',
        kind: id,
        detected: true,
        available: false,
      };
    if (id === 'ollama')
      return {
        id,
        name: 'Ollama',
        kind: 'openai',
        detected: true,
        baseUrl: OLLAMA_URL,
        accessToken: '',
        available: false,
      };
    if (id === 'lmstudio')
      return {
        id,
        name: 'LM Studio',
        kind: 'openai',
        detected: true,
        baseUrl: LMSTUDIO_URL,
        accessToken: '',
        available: false,
      };
    return null;
  }
  if (servers && servers[0]) return servers[0];
  const ollama = (detected || []).find((d) => d.id === 'ollama');
  if (ollama) return ollama;
  return (detected || [])[0] || null;
}

export function sameBaseUrl(a, b) {
  return canonicalBaseUrl(a) === canonicalBaseUrl(b);
}
