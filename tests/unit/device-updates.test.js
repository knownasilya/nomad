import { describe, it, expect } from 'vitest';
import {
  REQUESTS_PREFIX,
  STATUS_PREFIX,
  REQUEST_TTL_MS,
  requestPath,
  statusPath,
  makeRequest,
  isRequest,
  judgeRequest,
  makeStatus,
  isStatus,
  isBusy,
  describeUpdate,
  behindDesktops,
  compareVersions,
} from '../../shared/device-updates.mjs';

const DESK = 'd'.repeat(64);
const PHONE = 'a'.repeat(64);
const GONE = 'f'.repeat(64);
const NOW = new Date('2026-10-31T12:00:00Z');
const devices = [
  { key: DESK, platform: 'desktop', version: '1.30.0' },
  { key: PHONE, platform: 'mobile', version: '1.31.0' },
];

describe('paths', () => {
  it('is one record per Device under each prefix', () => {
    expect(requestPath(DESK)).toBe(`${REQUESTS_PREFIX}${DESK}.json`);
    expect(statusPath(DESK)).toBe(`${STATUS_PREFIX}${DESK}.json`);
  });
  it('refuses anything but a Device key', () => {
    expect(() => requestPath('../x')).toThrow();
    expect(() => statusPath('')).toThrow();
  });
});

describe('makeRequest', () => {
  it('names the computer, the version to reach and who asked', () => {
    const req = makeRequest({ device: DESK, version: '1.31.0', by: PHONE }, NOW);
    expect(req).toEqual({
      type: 'nomad/update-request',
      device: DESK,
      version: '1.31.0',
      prerelease: false,
      requestedAt: NOW.toISOString(),
      by: PHONE,
    });
    expect(isRequest(req)).toBe(true);
  });
  it('turns prereleases on to reach a beta', () => {
    expect(makeRequest({ device: DESK, version: 'v1.31.0-beta.2', by: PHONE }, NOW)).toMatchObject({
      version: '1.31.0-beta.2',
      prerelease: true,
    });
  });
  it('drops a version that is not one', () => {
    expect(makeRequest({ device: DESK, version: 'latest', by: PHONE }, NOW).version).toBe(null);
  });
  it('refuses a Device asking itself, or a bad key', () => {
    expect(() => makeRequest({ device: DESK, version: '1.0.0', by: DESK })).toThrow();
    expect(() => makeRequest({ device: DESK, version: '1.0.0', by: 'nope' })).toThrow();
  });
});

describe('judgeRequest', () => {
  const req = makeRequest({ device: DESK, version: '1.31.0', by: PHONE }, NOW);
  const opts = { ownKey: DESK, devices, now: NOW.getTime() + 1000 };

  it('takes a fresh request for this Device from one of the user’s Devices', () => {
    expect(judgeRequest(req, opts)).toEqual({ ok: true });
  });
  it('leaves a request for another Device', () => {
    expect(judgeRequest(req, { ...opts, ownKey: PHONE })).toMatchObject({ ok: false, reason: 'other' });
  });
  it('ignores a request from a Device the Vault no longer lists', () => {
    const fromGone = { ...req, by: GONE };
    expect(judgeRequest(fromGone, opts)).toMatchObject({ ok: false, reason: 'stranger' });
  });
  it('ignores a request this Device made for itself', () => {
    expect(judgeRequest({ ...req, by: DESK }, opts)).toMatchObject({ ok: false, reason: 'self' });
  });
  it('ignores an old request, so a computer waking up later doesn’t restart by surprise', () => {
    const later = { ...opts, now: NOW.getTime() + REQUEST_TTL_MS + 1 };
    expect(judgeRequest(req, later)).toMatchObject({ ok: false, reason: 'stale' });
  });
  it('ignores what is not a request', () => {
    expect(judgeRequest({ type: 'nomad/job-request' }, opts)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(judgeRequest(null, opts)).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('status', () => {
  const req = makeRequest({ device: DESK, version: '1.31.0', by: PHONE }, NOW);

  it('answers the request it came from', () => {
    const st = makeStatus({ device: DESK, state: 'downloading', version: '1.31.0', request: req }, NOW);
    expect(st).toMatchObject({ device: DESK, state: 'downloading', requestedAt: req.requestedAt, by: PHONE });
    expect(isStatus(st)).toBe(true);
    expect(isBusy(st, NOW.getTime())).toBe(true);
  });
  it('refuses an unknown state and clips a long error', () => {
    expect(() => makeStatus({ device: DESK, state: 'exploded' })).toThrow();
    const st = makeStatus({ device: DESK, state: 'failed', error: 'x'.repeat(1000) }, NOW);
    expect(st.error.length).toBe(300);
  });
  it('is not busy once stale', () => {
    const st = makeStatus({ device: DESK, state: 'checking' }, NOW);
    expect(isBusy(st, NOW.getTime() + 31 * 60 * 1000)).toBe(false);
  });
});

describe('describeUpdate', () => {
  const now = NOW.getTime();
  const st = (state, extra = {}) => makeStatus({ device: DESK, state, ...extra }, NOW);

  it('says a request is waiting for the computer', () => {
    const pending = makeRequest({ device: DESK, version: '1.31.0', by: PHONE }, NOW);
    expect(describeUpdate({ pending }, now)).toMatch(/Asked to update/);
  });
  it('follows the computer through the update', () => {
    expect(describeUpdate({ status: st('checking') }, now)).toBe('Checking for an update…');
    expect(describeUpdate({ status: st('downloading', { version: '1.31.0' }) }, now)).toBe('Downloading 1.31.0…');
    expect(describeUpdate({ status: st('restarting', { version: '1.31.0' }), deviceVersion: '1.30.0' }, now)).toBe(
      'Restarting to install 1.31.0…'
    );
    expect(describeUpdate({ status: st('restarting', { version: '1.31.0' }), deviceVersion: '1.31.0' }, now)).toBe(
      'Updated to 1.31.0'
    );
    expect(describeUpdate({ status: st('updated', { version: '1.31.0' }) }, now)).toBe('Updated to 1.31.0');
  });
  it('says why it didn’t update', () => {
    expect(describeUpdate({ status: st('current', { version: '1.31.0' }) }, now)).toBe('Already up to date (1.31.0)');
    expect(describeUpdate({ status: st('failed', { error: 'offline' }) }, now)).toBe('Update failed: offline');
    expect(describeUpdate({ status: st('off') }, now)).toMatch(/off on that computer/);
  });
  it('says nothing about a busy status that went stale', () => {
    expect(describeUpdate({ status: st('downloading') }, now + 60 * 60 * 1000)).toBe('');
    expect(describeUpdate({}, now)).toBe('');
  });
});

describe('behindDesktops', () => {
  it('lists computers on an older version than the phone', () => {
    const list = [
      ...devices,
      { key: 'b'.repeat(64), platform: 'desktop', version: '1.31.0' },
      { key: 'c'.repeat(64), platform: 'desktop' }, // predates version records
      { key: 'e'.repeat(64), platform: 'mobile', version: '1.0.0' },
    ];
    expect(behindDesktops(list, { ownKey: PHONE, version: '1.31.0' }).map((d) => d.key)).toEqual([DESK]);
  });
  it('counts a beta as older than its release', () => {
    const list = [{ key: DESK, platform: 'desktop', version: '1.31.0-beta.1' }];
    expect(behindDesktops(list, { ownKey: PHONE, version: '1.31.0' })).toHaveLength(1);
    expect(compareVersions('1.31.0-beta.2', '1.31.0-beta.1')).toBe(1);
  });
  it('is empty without the phone’s version', () => {
    expect(behindDesktops(devices, { ownKey: PHONE, version: null })).toEqual([]);
  });
});
