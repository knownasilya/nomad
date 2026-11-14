// How the phone's Version history screen words a drive's changes (mobile/lib/versionHistory.ts).

import { describe, it, expect } from 'vitest';
import { dayLabel, clockOf, whenOf, groupByDay, rowMeta, restoreCounts } from '../../mobile/lib/versionHistory.ts';

const now = new Date(2026, 10, 14, 16, 0).getTime(); // Saturday, November 14, 2026, 4 PM
const at = (d, h, m = 0, y = 2026, mo = 10) => new Date(y, mo, d, h, m).getTime();

describe('version history words', () => {
  it('names days the way desktop does', () => {
    expect(dayLabel(at(14, 9), now)).toBe('Today');
    expect(dayLabel(at(13, 23), now)).toBe('Yesterday');
    expect(dayLabel(at(12, 9), now)).toBe('Thursday, November 12');
    expect(dayLabel(at(3, 9, 0, 2025, 0), now)).toBe('Friday, January 3, 2025');
  });

  it('tells times on a 12-hour clock', () => {
    expect(clockOf(at(14, 15, 41))).toBe('3:41 PM');
    expect(clockOf(at(14, 0, 5))).toBe('12:05 AM');
    expect(whenOf(at(14, 9, 5), true, now)).toBe('today at about 9:05 AM');
    expect(whenOf(at(12, 12, 0), false, now)).toBe('Thursday, November 12 at 12:00 PM');
  });

  it('groups rows by day, with a row that has no time joining the day above it', () => {
    const rows = [
      { seq: 5, kind: 'deleted', at: null },
      { seq: 4, kind: 'changed', at: at(14, 10) },
      { seq: 3, kind: 'deleted', at: null },
      { seq: 2, kind: 'added', at: at(12, 8) },
    ];
    expect(groupByDay(rows, now).map((g) => [g.day, g.rows.map((r) => r.seq)])).toEqual([
      ['Earlier', [5]],
      ['Today', [4, 3]],
      ['Thursday, November 12', [2]],
    ]);
  });

  it('describes a row and a restore', () => {
    const fmt = (n) => `${n} B`;
    expect(rowMeta({ kind: 'changed', at: at(14, 15, 41), size: 12 }, fmt)).toBe('Changed · 3:41 PM · 12 B');
    expect(rowMeta({ kind: 'deleted', at: at(14, 9), approx: true, size: 12 }, fmt)).toBe('Deleted · about 9:00 AM');
    expect(rowMeta({ kind: 'added', at: null, size: 3 }, fmt)).toBe('Added · time unknown · 3 B');
    expect(restoreCounts({ changed: 1, back: 2, removed: 0 })).toEqual(['1 file goes back to an older version', '2 deleted files come back']);
  });
});
