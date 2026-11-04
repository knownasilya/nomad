// Reading long text in parts. A Note, a Reader post or a page the AI reads can be longer than one
// tool result should be, so each read gives one part of at most PART_CHARS characters, starting at
// `offset`, and says where the next part starts. The model calls the same capability again with
// that offset to read on (readNote, readReaderPost, readCurrentPage, a Job's openPage).
//
// No Electron imports.

// The most a read gives at once, so one long note or page can't fill the model's context.
export const PART_CHARS = 20000

// A part ends at a line break when one is in its last fifth, so a line isn't split across parts.
const LINE_WINDOW = 0.2

// `offset` from a capability's args: a whole number of characters from the start, 0 when left out.
export function readOffset(args) {
  const v = args?.offset
  if (v === undefined || v === null || v === '') return 0
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) {
    throw new Error('`offset` must be a whole number of characters, 0 or more (the nextOffset a read gave)')
  }
  return n
}

// The part of `text` from `offset`: { text, offset, end, length, more }. `end` is where the next part
// starts. An offset past the end is an error that says how long the text is.
/**
 * @param {unknown} text
 * @param {{ offset?: number, max?: number }} [opts]
 */
export function textPart(text, { offset = 0, max = PART_CHARS } = {}) {
  const s = String(text ?? '')
  const length = s.length
  if (offset > length || (offset > 0 && offset === length)) {
    throw new Error(`offset ${offset} is past the end: the text is ${length} characters`)
  }
  let end = Math.min(offset + max, length)
  if (end < length) {
    const br = s.lastIndexOf('\n', end - 1)
    if (br >= offset + max * (1 - LINE_WINDOW)) end = br + 1
    // Never split a surrogate pair (an emoji, say) across two parts.
    else if (isHighSurrogate(s.charCodeAt(end - 1))) end -= 1
  }
  return { text: s.slice(offset, end), offset, end, length, more: end < length }
}

function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff
}

// True when the part isn't the whole text.
export function isPartial(part) {
  return part.offset > 0 || part.more
}

// What the model is told about a part: which characters it has and how to read on. `name` is the
// capability that reads on; `same` the argument to pass again with the offset ('id', 'url'), if any.
export function partNote(part, name, same = '') {
  const range = `characters ${part.offset}–${part.end} of ${part.length}`
  return part.more
    ? `This is part of the text: ${range}. To read on, call ${name} again with offset: ${part.end}` +
        `${same ? ` and the same ${same}` : ''}.`
    : `This is the last part of the text: ${range}.`
}

// Fields to add to a JSON result that holds a part: nothing for whole text; else where it is and
// where the next part starts.
export function partFields(part, name, same = '') {
  if (!isPartial(part)) return {}
  return {
    offset: part.offset,
    length: part.length,
    ...(part.more ? { nextOffset: part.end } : {}),
    part: partNote(part, name, same),
  }
}

// A text result's part with its note after it, for capabilities that return the text itself.
export function partText(part, name, same = '') {
  return isPartial(part) ? `${part.text}\n\n[${partNote(part, name, same)}]` : part.text
}
