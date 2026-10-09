// The crawler's index core (ADR-0016 §4/§5), factored out of crawler.mjs with NO bare imports so it
// is unit-testable without a swarm. Holds manifest-only listing records and answers search / topic
// / stats queries. Defensive re-enforcement of the ADR-0016 caps happens here — the crawler trusts
// nothing from the wire.
import { FRAME } from '../../shared/listing-wire.mjs';

// Lowercase, strip accents (so "cafe" finds "Café"), split on anything that isn't a letter or
// digit ("peer-to-peer" → peer, to, peer).
export function tokenize(s) {
  return normalize(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

// Fuzzy matching (search below). Weights say how much a match in each field counts; quality says
// how good a match a query word made with one word of the field.
const FIELD_WEIGHT = { title: 3, keywords: 2, topics: 2, description: 1 };
const QUALITY = { exact: 1, prefix: 0.8, substring: 0.6, typo1: 0.5, typo2: 0.35 };
const PHRASE_BONUS = 1.5; // the whole query, as typed, inside the title or description

// How well one query word matches one indexed word, 0 for no match. Short words only match
// exactly or by prefix, so "a" or "go" don't match half the index; typos are allowed from 4
// letters (one edit) and 8 letters (two).
function wordMatch(term, word) {
  if (term === word) return QUALITY.exact;
  if (term.length >= 2 && word.startsWith(term)) return QUALITY.prefix; // "pee" → "peer"
  if (term.length >= 3 && word.includes(term)) return QUALITY.substring; // "culture" → "permaculture"
  if (term.length < 4 || Math.abs(term.length - word.length) > 2) return 0;
  const maxEdits = term.length >= 8 ? 2 : 1;
  const d = editDistance(term, word, maxEdits);
  if (d > maxEdits) return 0;
  return d === 1 ? QUALITY.typo1 : QUALITY.typo2;
}

// Edit distance with adjacent transpositions ("teh" → "the" is one edit), giving up once it
// passes `max` (returns max + 1). Words are short, so a plain table is fine.
function editDistance(a, b, max) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (j === 0 ? i : 0))
  );
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    let rowMin = Infinity;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2][j - 2] + 1);
      }
      d[i][j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/**
 * @param {() => number} now  injectable clock (deterministic tests)
 */
export function createIndex(now = () => Date.now()) {
  // driveKey(hex) -> record
  const index = new Map();
  // driveKey(hex) -> the record's searchable words per field, worked out once at ingest
  const words = new Map();

  // Fold one decoded LISTING frame into the index. Re-caps topics→5 / keywords→12 and lowercases
  // topic slugs so a misbehaving announcer can't exceed the limits (ADR-0016 §3).
  function ingest(f) {
    if (!f || f.t !== FRAME.LISTING || !f.driveKey) return false;
    const t = now();
    const prev = index.get(f.driveKey);
    index.set(f.driveKey, {
      driveKey: f.driveKey,
      type: f.type || null,
      title: typeof f.title === 'string' ? f.title : '',
      description: typeof f.description === 'string' ? f.description : '',
      topics: (Array.isArray(f.topics) ? f.topics : [])
        .slice(0, 5)
        .map((x) => String(x).toLowerCase()),
      keywords: (Array.isArray(f.keywords) ? f.keywords : []).slice(0, 12).map(String),
      seq: f.seq || 0,
      firstSeen: prev?.firstSeen || t,
      lastSeen: t,
    });
    const rec = index.get(f.driveKey);
    words.set(f.driveKey, {
      title: unique(tokenize(rec.title)),
      keywords: unique(tokenize(rec.keywords.join(' '))),
      topics: unique(tokenize(rec.topics.join(' '))),
      description: unique(tokenize(rec.description)),
      text: normalize(`${rec.title} \n ${rec.description}`), // for the phrase bonus
    });
    return true;
  }

  // Drop a Drive. The wire has no delist frame, so only a source that knows the full listed set
  // can tell a Drive left it — the browser's own listings (tools/crawler-process.mjs).
  function remove(driveKey) {
    words.delete(driveKey);
    return index.delete(driveKey);
  }

  // Fuzzy search across title, keywords, topics and description; optional exact topic facet.
  // Each query word takes its best match in any field (field weight × match quality). Results
  // rank by how many query words matched, then by score, then by how recently they were seen.
  // An empty query lists everything (in the topic, if one is given).
  function search(q, topic) {
    const terms = unique(tokenize(q));
    const phrase = normalize(q).trim();
    const results = [];
    for (const rec of index.values()) {
      if (topic && !rec.topics.includes(topic.toLowerCase())) continue;
      let score = 0;
      let matched = 0;
      if (terms.length) {
        const w = words.get(rec.driveKey);
        for (const term of terms) {
          let best = 0;
          for (const field in FIELD_WEIGHT) {
            for (const word of w[field]) {
              const m = wordMatch(term, word) * FIELD_WEIGHT[field];
              if (m > best) best = m;
            }
          }
          if (best > 0) {
            matched++;
            score += best;
          }
        }
        if (matched === 0) continue;
        if (terms.length > 1 && w.text.includes(phrase)) score += PHRASE_BONUS;
      }
      results.push({ ...rec, score: Math.round(score * 100) / 100, matched });
    }
    results.sort(
      (a, b) => b.matched - a.matched || b.score - a.score || b.lastSeen - a.lastSeen
    );
    return results;
  }

  // Emergent topic directory: whatever listed Drives declare, with counts (ADR-0016 §5).
  function topics() {
    const counts = new Map();
    for (const rec of index.values())
      for (const t of rec.topics) counts.set(t, (counts.get(t) || 0) + 1);
    return [...counts.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
  }

  const stats = () => ({ drives: index.size, topics: topics().length });
  return { ingest, remove, search, topics, stats };
}

function unique(list) {
  return [...new Set(list)];
}

// The browser's own listed Drives, handed straight to its built-in crawler
// (tools/crawler-process.mjs) instead of waiting for a DHT lookup to find this machine. Each call
// passes the full current set, so a Drive missing from it was unlisted and is removed.
export function createLocalFeed(idx) {
  let keys = new Set();
  return function apply(frames) {
    const next = new Set();
    for (const f of frames || []) if (idx.ingest(f)) next.add(f.driveKey);
    for (const k of keys) if (!next.has(k)) idx.remove(k);
    keys = next;
  };
}
