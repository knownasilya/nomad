// Search in the phone's Notes and Reader: a copy of app/userland/app-stdlib/js/search-match.js, which
// desktop's nomad://notes, nomad://reader and the canvas use (the phone's bundle can't reach app/).
// Keep the two the same: tests/unit/search-match.test.js runs the same cases on both.
// A search is words: an item matches when it has every word somewhere, in any order, ignoring case
// and accents ("cafe" finds "Café").

const MARKS = /[\u0300-\u036f]/g
const LEAD = 16 // characters shown before a matched word in a snippet

// Lowercase, without accents.
export function foldText (s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(MARKS, '').toLowerCase()
}

// The words of a search, folded. [] for an empty one.
export function queryWords (q: string): string[] {
  return foldText(q).split(/\s+/).filter(Boolean)
}

// Does text have every word? text can be folded already (foldText).
export function matchesWords (text: unknown, words: string[], { folded = false } = {}): boolean {
  if (!words || !words.length) return true
  const f = folded ? String(text ?? '') : foldText(text)
  return words.every((w) => f.includes(w))
}

export function matchesQuery (text: unknown, q: string): boolean {
  return matchesWords(text, queryWords(q))
}

function foldWithMap (text: string): { out: string; map: number[] } {
  let out = ''
  const map: number[] = []
  for (let i = 0; i < text.length;) {
    const ch = String.fromCodePoint(text.codePointAt(i)!)
    const f = foldText(ch)
    for (let k = 0; k < f.length; k++) map.push(i)
    out += f
    i += ch.length
  }
  map.push(text.length)
  return { out, map }
}

// Where the words are in text, to mark them: [{ start, end }] in text's own indexes, in order,
// overlapping ones joined.
export function matchRanges (text: unknown, words: string[]): Array<{ start: number; end: number }> {
  const s = String(text ?? '')
  if (!s || !words || !words.length) return []
  const { out, map } = foldWithMap(s)
  const found: Array<{ start: number; end: number }> = []
  for (const w of words) {
    for (let at = out.indexOf(w); at !== -1; at = out.indexOf(w, at + w.length)) {
      found.push({ start: map[at], end: map[at + w.length] })
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end)
  const ranges: Array<{ start: number; end: number }> = []
  for (const r of found) {
    const last = ranges[ranges.length - 1]
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end)
    else ranges.push({ ...r })
  }
  return ranges
}

// text cut into pieces, each marked or not: [{ text, match }]. One unmarked piece without words.
export function markPieces (text: unknown, words: string[]): Array<{ text: string; match: boolean }> {
  const s = String(text ?? '')
  const pieces: Array<{ text: string; match: boolean }> = []
  let at = 0
  for (const r of matchRanges(s, words)) {
    if (r.start > at) pieces.push({ text: s.slice(at, r.start), match: false })
    pieces.push({ text: s.slice(r.start, r.end), match: true })
    at = r.end
  }
  if (at < s.length || !pieces.length) pieces.push({ text: s.slice(at), match: false })
  return pieces
}

// A note's line that has a searched word, to show under its title in place of the start of the
// note. null when only the title (the first line) or a topic matched.
export function matchSnippet (body: unknown, words: string[], max = 140): string | null {
  if (!words || !words.length) return null
  const lines = String(body ?? '').split('\n')
  const first = lines.findIndex((l) => l.trim())
  for (let i = first + 1; i > 0 && i < lines.length; i++) {
    const line = lines[i]
      .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!line) continue
    const f = foldText(line)
    const hit = words.map((w) => f.indexOf(w)).filter((n) => n !== -1)
    if (!hit.length) continue
    // Start a few words before the first word found, so it shows even in a narrow list.
    const at = Math.min(...hit)
    let from = at > LEAD ? at - LEAD : 0
    if (from > 0) {
      const space = line.indexOf(' ', from)
      if (space !== -1 && space < at) from = space + 1
    }
    if (!from && line.length <= max) return line
    const room = max - (from ? 1 : 0)
    const more = from + room < line.length
    const cut = line.slice(from, from + room - (more ? 1 : 0)).trim()
    return (from ? '…' : '') + cut + (more ? '…' : '')
  }
  return null
}
