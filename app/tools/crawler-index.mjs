// The crawler's index core (ADR-0016 §4/§5), factored out of crawler.mjs with NO bare imports so it
// is unit-testable without a swarm. Holds manifest-only listing records and answers search / topic
// / stats queries. Defensive re-enforcement of the ADR-0016 caps happens here — the crawler trusts
// nothing from the wire.
import { FRAME } from '../../shared/listing-wire.mjs';

export function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * @param {() => number} now  injectable clock (deterministic tests)
 */
export function createIndex(now = () => Date.now()) {
  // driveKey(hex) -> record
  const index = new Map();

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
    return true;
  }

  // Rank by matched-term count across title/description/keywords; optional exact topic facet.
  function search(q, topic) {
    const terms = tokenize(q);
    const results = [];
    for (const rec of index.values()) {
      if (topic && !rec.topics.includes(topic.toLowerCase())) continue;
      let score = 0;
      if (terms.length) {
        const hayset = new Set(
          tokenize(`${rec.title} ${rec.description} ${rec.keywords.join(' ')}`)
        );
        for (const t of terms) if (hayset.has(t)) score++;
        if (score === 0) continue;
      }
      results.push({ ...rec, score });
    }
    results.sort((a, b) => b.score - a.score || b.lastSeen - a.lastSeen);
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
  return { ingest, search, topics, stats };
}
