import { describe, it, expect } from 'vitest';
import {
  OPEN_TABS_PREFIX,
  OPEN_TABS_TYPE,
  recordPath,
  isSyncableUrl,
  normalizeSpaces,
  buildRecord,
  sameTabs,
  otherDevicesTabs,
} from '../../shared/open-tabs.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const SPACE1 = '1'.repeat(64);
const SPACE2 = '2'.repeat(64);

describe('recordPath', () => {
  it('is one record per device under the prefix', () => {
    expect(recordPath(A)).toBe(`${OPEN_TABS_PREFIX}${A}.json`);
  });
  it('refuses anything but a device key', () => {
    expect(() => recordPath('../x')).toThrow();
    expect(() => recordPath('')).toThrow();
  });
});

describe('isSyncableUrl', () => {
  it('takes web and hyper:// pages', () => {
    expect(isSyncableUrl('https://example.com/a?b#c')).toBe(true);
    expect(isSyncableUrl('http://example.com')).toBe(true);
    expect(isSyncableUrl(`hyper://${A}/index.html`)).toBe(true);
  });
  it('leaves out pages another device cannot open', () => {
    expect(isSyncableUrl('nomad://desktop/')).toBe(false);
    expect(isSyncableUrl('nomad://history')).toBe(false);
    expect(isSyncableUrl('file:///etc/passwd')).toBe(false);
    expect(isSyncableUrl('hyper://private/notes.md')).toBe(false);
    expect(isSyncableUrl('')).toBe(false);
    expect(isSyncableUrl('not a url')).toBe(false);
    expect(isSyncableUrl('https://x.com/' + 'a'.repeat(3000))).toBe(false);
  });
});

describe('normalizeSpaces', () => {
  it('drops unsyncable tabs, empty spaces and spaces without a key', () => {
    const out = normalizeSpaces([
      { rootDriveKey: SPACE1, name: 'Work', tabs: [{ url: 'nomad://desktop/' }, { url: 'https://a.com', title: ' A ' }] },
      { rootDriveKey: SPACE2, name: 'Home', tabs: [{ url: 'nomad://desktop/' }] },
      { rootDriveKey: 'nope', name: 'Bad', tabs: [{ url: 'https://b.com' }] },
    ]);
    expect(out).toEqual([{ rootDriveKey: SPACE1, name: 'Work', tabs: [{ url: 'https://a.com', title: 'A' }] }]);
  });

  it('keeps a URL once per space, with the flags of every copy', () => {
    const out = normalizeSpaces([
      {
        rootDriveKey: SPACE1,
        name: 'Work',
        tabs: [
          { url: 'https://a.com', title: 'A' },
          { url: 'https://b.com', title: 'B' },
          { url: 'https://a.com', title: 'A again', pinned: true, active: true },
        ],
      },
    ]);
    expect(out[0].tabs).toEqual([
      { url: 'https://a.com', title: 'A', pinned: true, active: true },
      { url: 'https://b.com', title: 'B' },
    ]);
  });

  it('caps long titles and many tabs', () => {
    const tabs = Array.from({ length: 300 }, (_, i) => ({ url: `https://x.com/${i}`, title: 't'.repeat(500) }));
    const out = normalizeSpaces([{ rootDriveKey: SPACE1, name: 'n'.repeat(200), tabs }]);
    expect(out[0].tabs.length).toBe(200);
    expect(out[0].tabs[0].title.length).toBe(300);
    expect(out[0].name.length).toBe(80);
  });

  it('names a space without a name', () => {
    expect(normalizeSpaces([{ rootDriveKey: SPACE1, tabs: [{ url: 'https://a.com' }] }])[0].name).toBe('Space');
  });
});

describe('buildRecord and sameTabs', () => {
  const spaces = [{ rootDriveKey: SPACE1, name: 'Work', tabs: [{ url: 'https://a.com', title: 'A' }] }];

  it('builds the record this device writes', () => {
    const rec = buildRecord(A, spaces, new Date('2026-10-30T00:00:00Z'));
    expect(rec).toEqual({
      type: OPEN_TABS_TYPE,
      device: A,
      updatedAt: '2026-10-30T00:00:00.000Z',
      spaces: [{ rootDriveKey: SPACE1, name: 'Work', tabs: [{ url: 'https://a.com', title: 'A' }] }],
    });
  });

  it('skips a write that changes nothing but the time', () => {
    const rec = buildRecord(A, spaces);
    expect(sameTabs(rec, spaces)).toBe(true);
    // A nomad:// tab doesn't count either.
    expect(sameTabs(rec, [{ ...spaces[0], tabs: [...spaces[0].tabs, { url: 'nomad://desktop/' }] }])).toBe(true);
    expect(sameTabs(rec, [{ ...spaces[0], tabs: [{ url: 'https://a.com', title: 'A2' }] }])).toBe(false);
    expect(sameTabs(null, spaces)).toBe(false);
  });
});

describe('otherDevicesTabs', () => {
  const devices = [
    { key: A, name: 'Laptop', platform: 'desktop' },
    { key: B, name: 'Phone', platform: 'mobile' },
  ];
  const records = [
    buildRecord(A, [{ rootDriveKey: SPACE1, name: 'Work', tabs: [{ url: 'https://a.com' }] }], new Date('2026-10-30T01:00:00Z')),
    buildRecord(
      B,
      [
        { rootDriveKey: SPACE1, name: 'Work', tabs: [{ url: 'https://b.com' }] },
        { rootDriveKey: SPACE2, name: 'Home', tabs: [{ url: 'https://c.com' }] },
      ],
      new Date('2026-10-30T02:00:00Z')
    ),
    // A removed device: no record in the Vault's device list.
    buildRecord(C, [{ rootDriveKey: SPACE1, name: 'Work', tabs: [{ url: 'https://gone.com' }] }]),
    { type: 'something-else', device: A },
  ];

  it('leaves out this device and removed devices, newest first', () => {
    const out = otherDevicesTabs(records, { ownKey: A, devices, connected: new Set([B]) });
    expect(out.map((d) => d.deviceKey)).toEqual([B]);
    expect(out[0]).toMatchObject({ name: 'Phone', platform: 'mobile', connected: true, updatedAt: '2026-10-30T02:00:00.000Z' });
  });

  it('sorts devices by when they last changed', () => {
    const out = otherDevicesTabs(records, { ownKey: C, devices });
    expect(out.map((d) => d.deviceKey)).toEqual([B, A]);
    expect(out[0].connected).toBe(false);
  });

  it('puts the current space first', () => {
    const out = otherDevicesTabs(records, { ownKey: A, devices, currentSpace: SPACE2 });
    expect(out[0].spaces.map((s) => s.rootDriveKey)).toEqual([SPACE2, SPACE1]);
  });

  it('skips a device whose record has no tabs left', () => {
    const empty = [buildRecord(B, [])];
    expect(otherDevicesTabs(empty, { ownKey: A, devices })).toEqual([]);
  });
});
