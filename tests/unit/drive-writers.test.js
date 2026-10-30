import { describe, it, expect } from 'vitest';
import {
  DRIVE_WRITERS_PREFIX,
  GRANT_TYPE,
  isKey,
  grantsPrefix,
  grantPath,
  makeGrantRequest,
  isGrant,
  markGranted,
  grantsToMake,
  grantsToRevoke,
  requestState,
} from '../../shared/drive-writers.mjs';

const k = (c) => c.repeat(64);
const DRIVE = k('a');
const OTHER_DRIVE = k('b');
const LAPTOP = k('1');
const DESKTOP = k('2');
const PHONE = k('3');
const W1 = k('c');
const W2 = k('d');

const req = (over = {}) =>
  makeGrantRequest({ drive: DRIVE, writerKey: W1, device: LAPTOP, name: 'Laptop', ...over }, 'T0');

describe('drive-writers records', () => {
  it('lays records out per drive and writer key', () => {
    expect(grantsPrefix()).toBe(DRIVE_WRITERS_PREFIX);
    expect(grantsPrefix(DRIVE)).toBe(`/.vault/drive-writers/${DRIVE}/`);
    expect(grantPath(DRIVE, W1)).toBe(`/.vault/drive-writers/${DRIVE}/${W1}.json`);
    expect(() => grantPath('nope', W1)).toThrow();
    expect(() => grantPath(DRIVE, 'nope')).toThrow();
    expect(isKey(DRIVE)).toBe(true);
    expect(isKey(DRIVE.toUpperCase())).toBe(false);
  });

  it('makes a request record', () => {
    expect(req()).toEqual({
      type: GRANT_TYPE,
      drive: DRIVE,
      writerKey: W1,
      device: LAPTOP,
      name: 'Laptop',
      requestedAt: 'T0',
    });
    expect(makeGrantRequest({ drive: DRIVE, writerKey: W1, device: LAPTOP }, 'T0').name).toBe('A device');
    expect(() => makeGrantRequest({ drive: DRIVE, writerKey: W1, device: 'x' })).toThrow();
    expect(isGrant(req())).toBe(true);
    expect(isGrant({ ...req(), type: 'other' })).toBe(false);
  });

  it('marks a grant and reports a request state', () => {
    const granted = markGranted(req(), DESKTOP, 'T1');
    expect(granted.grantedBy).toBe(DESKTOP);
    expect(granted.grantedAt).toBe('T1');
    expect(requestState([req()], { drive: DRIVE, writerKey: W1 })).toEqual({
      pending: true,
      granted: false,
      requestedAt: 'T0',
      grantedAt: null,
    });
    expect(requestState([granted], { drive: DRIVE, writerKey: W1 })).toMatchObject({ pending: false, granted: true });
    expect(requestState([granted], { drive: DRIVE, writerKey: W2 })).toBeNull();
  });
});

describe('grantsToMake', () => {
  const devices = [LAPTOP, DESKTOP, PHONE];
  const canWrite = (d) => d === DRIVE;

  it('grants pending requests from listed Devices on Drives this Device writes', () => {
    const records = [req(), req({ drive: OTHER_DRIVE, writerKey: W2 })];
    expect(grantsToMake(records, { devices, self: DESKTOP, canWrite })).toEqual([records[0]]);
  });

  it('skips granted requests, its own, unlisted Devices and bad records', () => {
    const records = [
      markGranted(req(), DESKTOP),
      req({ device: DESKTOP, writerKey: W2 }),
      req({ device: k('9'), writerKey: W2 }),
      { type: GRANT_TYPE, drive: DRIVE },
    ];
    expect(grantsToMake(records, { devices, self: DESKTOP, canWrite })).toEqual([]);
  });
});

describe('grantsToRevoke', () => {
  const canWrite = (d) => d === DRIVE;

  it('revokes the records of a removed Device on Drives this Device writes', () => {
    const gone = markGranted(req(), DESKTOP);
    const pendingGone = req({ writerKey: W2 });
    const elsewhere = req({ drive: OTHER_DRIVE });
    const kept = req({ device: PHONE, writerKey: k('e') });
    const out = grantsToRevoke([gone, pendingGone, elsewhere, kept], { devices: [DESKTOP, PHONE], self: DESKTOP, canWrite });
    expect(out).toEqual([gone, pendingGone]);
  });

  it('revokes nothing when the Device list misses this Device', () => {
    expect(grantsToRevoke([req()], { devices: [], self: DESKTOP, canWrite })).toEqual([]);
    expect(grantsToRevoke([req()], { devices: [PHONE], self: DESKTOP, canWrite })).toEqual([]);
    expect(grantsToRevoke([req()], { devices: [DESKTOP], self: null, canWrite })).toEqual([]);
  });
});
