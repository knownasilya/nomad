// nomad://search's sources: the indexes the page asks, and how their answers become one list.
// Pure functions, so tests/unit/search-sources.test.js can load them without a page.
//
// A source is a crawler's HTTP/JSON search API (ADR-0014 §6). The built-in crawler is always one
// (bg/hyper/crawler-host.js); the user adds others, each with a name, in the `search_sources`
// setting: [{ id, name, url, enabled }].

export const BUILT_IN_ID = 'builtin';
export const BUILT_IN_NAME = 'Built-in';

// The saved list, cleaned: entries without an address are dropped, and a missing name falls back
// to the address's host.
export function normalizeSources(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const url = cleanUrl(s.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      id: typeof s.id === 'string' && s.id ? s.id : makeId(),
      name: (typeof s.name === 'string' && s.name.trim()) || hostOf(url),
      url,
      enabled: s.enabled !== false,
    });
  }
  return out;
}

// A new source from what the user typed. Throws with a message for the page to show.
export function newSource(name, url, existing = []) {
  const clean = cleanUrl(url);
  if (!clean) throw new Error('Enter an http:// or https:// address.');
  if (existing.some((s) => s.url === clean)) throw new Error('That index is already a source.');
  return { id: makeId(), name: String(name || '').trim() || hostOf(clean), url: clean, enabled: true };
}

// An http(s) address without a trailing slash, or '' when it isn't one.
export function cleanUrl(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'http://' + u;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.href.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// One list from every source that answered: [{ source, results }]. A Drive that more than one
// source found appears once, and names each of them in `sources`. Ranked like a single index
// ranks (tools/crawler-index.mjs search): query words matched, then score, then last seen.
export function mergeResults(answers) {
  const byKey = new Map();
  for (const { source, results } of answers) {
    if (!Array.isArray(results)) continue;
    for (const r of results) {
      if (!r || typeof r.driveKey !== 'string') continue;
      const tag = { id: source.id, name: source.name };
      const prev = byKey.get(r.driveKey);
      if (!prev) {
        byKey.set(r.driveKey, { ...r, sources: [tag] });
        continue;
      }
      const sources = prev.sources.some((s) => s.id === tag.id) ? prev.sources : [...prev.sources, tag];
      // Keep the better match, and the freshest copy of the Drive's details.
      const best = rank(r, prev) < 0 ? r : prev;
      const fresh = (r.lastSeen || 0) > (prev.lastSeen || 0) ? r : prev;
      byKey.set(r.driveKey, {
        ...fresh,
        matched: best.matched,
        score: best.score,
        lastSeen: Math.max(r.lastSeen || 0, prev.lastSeen || 0),
        sources,
      });
    }
  }
  return [...byKey.values()].sort(rank);
}

function rank(a, b) {
  return (
    (b.matched || 0) - (a.matched || 0) ||
    (b.score || 0) - (a.score || 0) ||
    (b.lastSeen || 0) - (a.lastSeen || 0)
  );
}

// The topic directory across sources. Two indexes may list the same Drive, so a topic's count is
// the most any one source has, never a sum that counts a Drive twice.
export function mergeTopics(answers) {
  const counts = new Map();
  for (const { topics } of answers) {
    if (!Array.isArray(topics)) continue;
    for (const t of topics) {
      if (!t || typeof t.topic !== 'string') continue;
      counts.set(t.topic, Math.max(counts.get(t.topic) || 0, Number(t.count) || 0));
    }
  }
  return [...counts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}
