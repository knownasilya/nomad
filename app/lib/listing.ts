// Manifest discovery vocabulary — Topics, Keywords, and the `indexable` listing switch
// (ADR-0016). Pure normalization helpers shared by both drive backends' `configure` and by any
// crawler that reads an `index.json`. No platform deps.
//
// Topics are exact-match facets, so they are canonicalized to lowercase hyphenated slugs (any
// script) — independent indexers must agree on the same shelf without a registry. Keywords are
// search text, matched not compared, so they keep the author's wording (only trimmed/deduped).

export const MAX_TOPICS = 5;
export const MAX_KEYWORDS = 12;
export const TOPIC_MAX_LEN = 40;
export const KEYWORD_MAX_LEN = 40;

// Unicode letters/numbers are kept; every run of anything else becomes a single hyphen.
const NON_SLUG = /[^\p{L}\p{N}]+/gu;
const EDGE_DASHES = /^-+|-+$/g;

/**
 * Canonicalize one raw Topic to a lowercase hyphenated slug (any script), or return '' if nothing
 * usable remains. `Raised Beds` → `raised-beds`; `  🌱  ` → '' (no letters/numbers).
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeTopic(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const slug = raw
    .normalize('NFC')
    .toLowerCase()
    .replace(NON_SLUG, '-')
    .replace(EDGE_DASHES, '')
    .slice(0, TOPIC_MAX_LEN)
    .replace(EDGE_DASHES, ''); // re-trim in case the length cap left a trailing dash
  return slug;
}

/**
 * Normalize a Topics array: slugify each, drop empties, dedupe (first wins), cap at MAX_TOPICS.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeTopics(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const slug = normalizeTopic(item);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
    if (out.length >= MAX_TOPICS) break;
  }
  return out;
}

/**
 * Normalize one raw Keyword: trim, collapse internal whitespace, cap length. Wording is preserved
 * (matched case-insensitively at query time, not slugified). Returns '' if empty.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeKeyword(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, KEYWORD_MAX_LEN).trim();
}

/**
 * Normalize a Keywords array: clean each, drop empties, dedupe case-insensitively (first wins),
 * cap at MAX_KEYWORDS. The cap is the real anti-spam limit — an over-long list is truncated here,
 * not rejected.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeKeywords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const kw = normalizeKeyword(item);
    if (!kw) continue;
    const fold = kw.toLowerCase();
    if (seen.has(fold)) continue;
    seen.add(fold);
    out.push(kw);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

/**
 * Sanitize the listing-related fields of a `configure` settings object. Only touches keys that are
 * present, so it composes with the existing per-field allow-lists. `indexable` coerces to a real
 * boolean; `topics`/`keywords` are normalized to bounded, deduped arrays.
 * @param {Record<string, unknown>} settings
 * @returns {{ indexable?: boolean, topics?: string[], keywords?: string[] }}
 */
export function sanitizeListingFields(settings: Record<string, unknown>): {
  indexable?: boolean;
  topics?: string[];
  keywords?: string[];
} {
  const out: { indexable?: boolean; topics?: string[]; keywords?: string[] } = {};
  if ('indexable' in settings) out.indexable = !!settings.indexable;
  if ('topics' in settings) out.topics = normalizeTopics(settings.topics);
  if ('keywords' in settings) out.keywords = normalizeKeywords(settings.keywords);
  return out;
}
