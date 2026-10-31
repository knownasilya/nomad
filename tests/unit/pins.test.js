import { describe, it, expect } from 'vitest';
import {
  normalizePinUrl,
  isPinnable,
  parsePins,
  serializePins,
  withPin,
  withoutPin,
  movePin,
  fallbackTitle,
  titledPins,
  reconcileTabs,
  pinTiles,
} from '../../shared/pins.mjs';

const KEY = 'a'.repeat(64);

describe('normalizePinUrl', () => {
  it('matches desktop and the phone', () => {
    expect(normalizePinUrl('https://Example.com')).toBe('https://example.com/');
    expect(normalizePinUrl('https://user:pw@example.com:443/a?b#c')).toBe(
      'https://example.com/a?b#c'
    );
    expect(normalizePinUrl('http://example.com:80/')).toBe('http://example.com/');
    expect(normalizePinUrl('http://example.com:8080')).toBe('http://example.com:8080/');
    expect(normalizePinUrl(`hyper://${KEY}`)).toBe(`hyper://${KEY}/`);
  });
  it('is empty for what is not a URL', () => {
    expect(normalizePinUrl('')).toBe('');
    expect(normalizePinUrl('example.com')).toBe('');
    expect(normalizePinUrl(null)).toBe('');
  });
});

describe('isPinnable', () => {
  it('takes pages, not the new tab page', () => {
    expect(isPinnable('https://example.com')).toBe(true);
    expect(isPinnable('nomad://reader/')).toBe(true);
    expect(isPinnable('nomad://desktop/')).toBe(false);
    expect(isPinnable('nope')).toBe(false);
  });
});

describe('parsePins', () => {
  it('normalizes, dedupes and keeps the order', () => {
    expect(parsePins('["https://b.com", "https://A.com/", "https://b.com/", 4, null]')).toEqual([
      'https://b.com/',
      'https://a.com/',
    ]);
  });
  it('is [] for anything unreadable', () => {
    expect(parsePins('{')).toEqual([]);
    expect(parsePins('{"a":1}')).toEqual([]);
    expect(parsePins(undefined)).toEqual([]);
  });
  it('takes an array too, and round-trips', () => {
    const pins = parsePins(['https://a.com']);
    expect(parsePins(serializePins(pins))).toEqual(pins);
  });
});

describe('withPin / withoutPin / movePin', () => {
  const pins = ['https://a.com/', 'https://b.com/', 'https://c.com/'];
  it('adds at the end, or where asked, once', () => {
    expect(withPin(pins, 'https://d.com')).toEqual([...pins, 'https://d.com/']);
    expect(withPin(pins, 'https://d.com', 0)[0]).toBe('https://d.com/');
    expect(withPin(pins, 'https://A.com')).toEqual(pins);
  });
  it('removes', () => {
    expect(withoutPin(pins, 'https://b.com')).toEqual(['https://a.com/', 'https://c.com/']);
    expect(withoutPin(pins, 'https://z.com')).toEqual(pins);
  });
  it('moves', () => {
    expect(movePin(pins, 'https://c.com/', 0)).toEqual([
      'https://c.com/',
      'https://a.com/',
      'https://b.com/',
    ]);
    expect(movePin(pins, 'https://a.com/', 1)).toEqual([
      'https://b.com/',
      'https://a.com/',
      'https://c.com/',
    ]);
    expect(movePin(pins, 'https://a.com/', 99)).toEqual([
      'https://b.com/',
      'https://c.com/',
      'https://a.com/',
    ]);
    expect(movePin(pins, 'https://z.com/', 0)).toEqual(pins);
  });
});

describe('titledPins', () => {
  it('titles a pin by its bookmark, else its host', () => {
    expect(
      titledPins(
        ['https://a.com/', 'https://www.b.com/x', `hyper://${KEY}/`],
        [{ href: 'https://A.com', title: ' Ay ' }]
      )
    ).toEqual([
      { href: 'https://a.com/', title: 'Ay' },
      { href: 'https://www.b.com/x', title: 'b.com' },
      { href: `hyper://${KEY}/`, title: fallbackTitle(`hyper://${KEY}/`) },
    ]);
    expect(fallbackTitle(`hyper://${KEY}/`)).toBe('aaaaaa…aaaa');
  });
});

describe('reconcileTabs', () => {
  const pins = ['https://a.com/', 'https://b.com/'];
  it('keeps tabs bound to a pin, unpins one whose pin went away', () => {
    const tabs = [
      { isPinned: true, pinUrl: 'https://a.com/', url: 'https://a.com/page' },
      { isPinned: true, pinUrl: 'https://gone.com/', url: 'https://gone.com/' },
      { isPinned: false, url: 'https://b.com/' },
    ];
    expect(reconcileTabs(tabs, pins)).toEqual({ bind: [], add: [], unpin: [1] });
  });
  it('binds a tab pinned before pins were known, and pins its page when new', () => {
    const tabs = [
      { isPinned: true, url: 'https://B.com' },
      { isPinned: true, url: 'https://new.com/x' },
    ];
    expect(reconcileTabs(tabs, pins)).toEqual({
      bind: [
        { index: 0, href: 'https://b.com/' },
        { index: 1, href: 'https://new.com/x' },
      ],
      add: ['https://new.com/x'],
      unpin: [],
    });
  });
  it('unpins a second tab for the same pin, and a tab that cannot be a pin', () => {
    const tabs = [
      { isPinned: true, pinUrl: 'https://a.com/', url: 'https://a.com/' },
      { isPinned: true, pinUrl: 'https://a.com/', url: 'https://a.com/' },
      { isPinned: true, url: 'nomad://desktop/' },
    ];
    expect(reconcileTabs(tabs, pins).unpin).toEqual([1, 2]);
  });
});

describe('pinTiles', () => {
  it('draws each pin with its open tab, then pinned tabs no pin names', () => {
    const pins = [
      { href: 'https://a.com/', title: 'A' },
      { href: 'https://b.com/', title: 'B' },
    ];
    const tabs = [
      { isPinned: true, pinUrl: 'https://b.com/', url: 'https://b.com/deep', title: 'B page' },
      { isPinned: true, url: 'https://c.com/', title: 'C' },
      { isPinned: false, url: 'https://a.com/', title: 'not pinned' },
    ];
    expect(pinTiles(pins, tabs)).toEqual([
      { href: 'https://a.com/', title: 'A', index: -1 },
      { href: 'https://b.com/', title: 'B', index: 0 },
      { href: 'https://c.com/', title: 'C', index: 1 },
    ]);
  });
});
