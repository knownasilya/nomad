// Reading long text in parts (app/bg/ai/text-part.mjs): readNote, readReaderPost, readCurrentPage and
// a Job's openPage give one part at a time and say where the next starts.

import { describe, it, expect } from 'vitest';
import { PART_CHARS, readOffset, textPart, partFields, partText } from '../../app/bg/ai/text-part.mjs';
import { CAPABILITIES } from '../../app/bg/ai/search-execute.mjs';

describe('text parts', () => {
  it('gives short text whole, with nothing added', () => {
    const part = textPart('hello');
    expect(part).toEqual({ text: 'hello', offset: 0, end: 5, length: 5, more: false });
    expect(partFields(part, 'readNote', 'id')).toEqual({});
    expect(partText(part, 'readCurrentPage')).toBe('hello');
    expect(textPart('').text).toBe('');
  });

  it('reads every character of a long text across its parts, in order', () => {
    const text = 'x'.repeat(PART_CHARS * 2 + 123);
    let offset = 0;
    let out = '';
    let parts = 0;
    for (;;) {
      const part = textPart(text, { offset });
      expect(part.text.length).toBeLessThanOrEqual(PART_CHARS);
      out += part.text;
      parts++;
      if (!part.more) break;
      offset = part.end;
    }
    expect(out).toBe(text);
    expect(parts).toBe(3);
  });

  it('ends a part at a line break near the cut', () => {
    const text = 'a'.repeat(90) + '\n' + 'b'.repeat(50);
    const part = textPart(text, { max: 100 });
    expect(part.text).toBe('a'.repeat(90) + '\n');
    expect(part.end).toBe(91);
    // A break too far back is not used: the part stays near full.
    const far = 'a'.repeat(10) + '\n' + 'b'.repeat(200);
    expect(textPart(far, { max: 100 }).end).toBe(100);
  });

  it('never splits an emoji across two parts', () => {
    const text = 'a'.repeat(99) + '😀' + 'b'.repeat(10);
    const first = textPart(text, { max: 100 });
    expect(first.end).toBe(99);
    expect(textPart(text, { offset: first.end, max: 100 }).text.startsWith('😀')).toBe(true);
  });

  it('says how to read on, and when the last part is reached', () => {
    const text = 'x'.repeat(250);
    const first = textPart(text, { max: 100 });
    expect(partFields(first, 'readNote', 'id')).toEqual({
      offset: 0,
      length: 250,
      nextOffset: 100,
      part: 'This is part of the text: characters 0–100 of 250. To read on, call readNote again with offset: 100 and the same id.',
    });
    expect(partText(first, 'readCurrentPage')).toMatch(
      /\n\n\[This is part of the text: characters 0–100 of 250\. To read on, call readCurrentPage again with offset: 100\.\]$/
    );
    const last = textPart(text, { offset: 200, max: 100 });
    expect(partFields(last, 'readNote', 'id')).toEqual({
      offset: 200,
      length: 250,
      part: 'This is the last part of the text: characters 200–250 of 250.',
    });
  });

  it('refuses an offset past the end, or one that is not a whole number', () => {
    expect(() => textPart('abc', { offset: 3 })).toThrow(/past the end: the text is 3 characters/);
    expect(() => textPart('abc', { offset: 10 })).toThrow(/past the end/);
    expect(readOffset({})).toBe(0);
    expect(readOffset(undefined)).toBe(0);
    expect(readOffset({ offset: 40 })).toBe(40);
    expect(readOffset({ offset: '40' })).toBe(40);
    expect(() => readOffset({ offset: -1 })).toThrow(/whole number/);
    expect(() => readOffset({ offset: 1.5 })).toThrow(/whole number/);
    expect(() => readOffset({ offset: 'abc' })).toThrow(/whole number/);
  });

  it('offers `offset` on every capability that reads in parts', () => {
    for (const name of ['readNote', 'readReaderPost', 'readCurrentPage']) {
      const cap = CAPABILITIES.find((c) => c.name === name);
      expect(cap.inputSchema.properties.offset, name).toMatchObject({ type: 'number' });
      expect(cap.description, name).toMatch(/offset/);
    }
    expect(CAPABILITIES.find((c) => c.name === 'openPage').description).toMatch(/nextOffset/);
  });
});
