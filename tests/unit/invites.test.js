// Invite links (shared/invites.mjs, ADR-0040): the payload in the link's fragment, its signature,
// links in every form a person pastes, and the invite records every Device answers joins from.
// GOLDEN pins the bytes: desktop, the phone and nomad.dev's invite page (a copy of this file) must
// read the same link. Change it only with a new VERSION.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import * as V from '../../shared/invites.mjs';
import * as I from '../../shared/inbox.mjs';

let crypto;
let keys;
beforeAll(() => {
  const rq = createRequire(path.join(process.cwd(), 'app', 'package.json'));
  crypto = I.cryptoFromSodium(rq('sodium-universal'));
  keys = I.inboxKeys(new Uint8Array(32).map((_, i) => i), crypto);
});

const ID = '0123456789abcdef0123456789abcdef';
const FROM = 'a'.repeat(64);
const CODE = 'yrysm47s1odf95tnthmarbf9cckuottg7tq3tj4z9g9tkznshuczjpo5w3rcwm1raqawo6rkcn89b7w4xj4b5rt46a36mu3c5n9ch4qjoa';
const INVITE = {
  id: ID,
  expiresAt: '2026-11-22T12:00:00.000Z',
  from: FROM,
  name: 'Ilya',
  space: { code: CODE, name: 'Home', role: 'editor' },
};
const GOLDEN_UNSIGNED =
  'AQEEASNFZ4mrze8BI0VniavN72sC2UAAanlyeXNtNDdzMW9kZjk1dG50aG1hcmJmOWNja3VvdHRnN3RxM3RqNHo5Zzl0a3puc2h1Y3pqcG81dzNyY3dtMXJhcWF3bzZya2NuODliN3c0eGo0YjVydDQ2YTM2bXUzYzVuOWNoNHFqb2EESG9tZQE';

describe('the invite payload', () => {
  it('pins the bytes of an unsigned Space invite', () => {
    const bytes = V.encodeInvite(INVITE);
    expect(V.toBase64Url(bytes)).toBe(GOLDEN_UNSIGNED);
    const back = V.decodeInvite(bytes);
    expect(back).toMatchObject({ v: 1, kind: 'invite', id: ID, expiresAt: INVITE.expiresAt, signed: false, space: INVITE.space });
    // No Persona, no name: an unsigned invite can't say who it's from.
    expect(back.from).toBeUndefined();
    expect(back.name).toBeUndefined();
  });

  it('signs with the Persona key and checks against the published one', () => {
    const bytes = V.encodeInvite(INVITE, (msg) => crypto.sign(msg, keys.sign.secretKey));
    const link = V.linkOf(bytes);
    expect(link.startsWith('https://nomad.pages.dev/invite/#')).toBe(true);
    expect(link.length).toBeLessThan(400);
    const inv = V.parseInviteLink(link);
    expect(inv).toMatchObject({ signed: true, from: FROM, name: 'Ilya', space: INVITE.space });
    const pub = I.toHex(keys.sign.publicKey);
    const verify = (sig, msg, pk) => crypto.verify(sig, msg, pk);
    expect(V.signatureState(inv, pub, verify)).toBe('ok');
    expect(V.signatureState(inv, 'b'.repeat(64), verify)).toBe('bad');
    expect(V.signatureState(inv, null, verify)).toBe('unknown');
    expect(V.signatureState(V.decodeInvite(V.encodeInvite(INVITE)), pub, verify)).toBe('unsigned');

    // A changed role breaks the signature.
    const tampered = V.fromBase64Url(V.payloadText(link));
    tampered[tampered.length - 65] = 2; // the role byte, just before the signature
    const t = V.decodeInvite(tampered);
    expect(t.space.role).toBe('viewer');
    expect(V.signatureState(t, pub, verify)).toBe('bad');
  });

  it('reads a link in every form it is pasted', () => {
    const p = V.toBase64Url(V.encodeInvite(INVITE));
    for (const s of [
      `https://nomad.pages.dev/invite/#${p}`,
      `https://nomad.pages.dev/invite#${p}`,
      ` http://www.nomad.pages.dev/invite/index.html#${p} `,
      `nomad-invite:${p}`,
      `nomad-invite://${p}`,
      p,
    ])
      expect(V.parseInviteLink(s).id).toBe(ID);
    expect(V.payloadText(CODE)).toBe(CODE); // a bare code is long base64-ish text too…
    expect(V.isInviteLink(CODE)).toBe(false); // …but not a link
    expect(V.isInviteLink(`nomad-invite:${p}`)).toBe(true);
    expect(() => V.parseInviteLink('https://example.com/#abc')).toThrow('isn’t an invite link');
    expect(() => V.parseInviteLink(`https://nomad.pages.dev/invite/#${p.slice(0, 30)}`)).toThrow('Copy it again');
  });

  it('keeps names short and in whole characters', () => {
    const long = { ...INVITE, name: 'é'.repeat(100), space: { ...INVITE.space, name: '🏠'.repeat(100) } };
    const back = V.decodeInvite(V.encodeInvite(long, (m) => crypto.sign(m, keys.sign.secretKey)));
    expect([...back.name]).toHaveLength(64);
    expect([...back.space.name].length).toBeLessThanOrEqual(80);
    expect(back.space.name.endsWith('🏠')).toBe(true);
  });

  it('describes the invite and its expiry', () => {
    const inv = V.decodeInvite(V.encodeInvite(INVITE, (m) => crypto.sign(m, keys.sign.secretKey)));
    expect(V.describeInvite(inv)).toEqual({
      title: 'Ilya invited you to join Home',
      role: 'You’ll be able to edit everything in it.',
    });
    expect(V.describeInvite(V.decodeInvite(V.encodeInvite(INVITE))).title).toBe('Someone invited you to join Home');
    expect(V.isExpired(inv, Date.parse('2026-11-22T11:59:59Z'))).toBe(false);
    expect(V.isExpired(inv, Date.parse('2026-11-22T12:00:00Z'))).toBe(true);
    expect(V.expiryOf(7, Date.parse('2026-11-08T00:00:00.500Z'))).toBe('2026-11-15T00:00:00.000Z');
    expect(V.expiryOf(99, 0)).toBe(new Date(14 * 86400e3).toISOString());
  });

  it('refuses links it cannot read', () => {
    const bytes = V.encodeInvite(INVITE);
    const newer = bytes.slice();
    newer[0] = 2;
    expect(() => V.decodeInvite(newer)).toThrow('newer Nomad');
    expect(() => V.decodeInvite(bytes.slice(0, -3))).toThrow('Copy it again');
    expect(() => V.encodeInvite({ id: ID })).toThrow('offers a Space or messages');
  });
});

describe('invite records', () => {
  const LIB = 'c'.repeat(64);
  const SPACE = 'd'.repeat(64);
  const rec = (over = {}) =>
    V.makeInviteRecord(
      { id: ID, space: { space: SPACE, library: LIB, publicKey: 'e'.repeat(64), role: 'viewer', name: 'Home' }, expiresAt: '2026-11-22T12:00:00.000Z', ...over },
      '2026-11-08T12:00:00.000Z'
    );

  it('matches only open invites for the Library', () => {
    const now = Date.parse('2026-11-10T00:00:00Z');
    expect(V.openInvitesFor([rec()], LIB, now)).toHaveLength(1);
    expect(V.openInvitesFor([rec()], 'f'.repeat(64), now)).toHaveLength(0);
    expect(V.openInvitesFor([V.markRevoked(rec())], LIB, now)).toHaveLength(0);
    expect(V.openInvitesFor([V.markUsed(rec(), { name: 'Sam' })], LIB, now)).toHaveLength(0);
    expect(V.openInvitesFor([rec()], LIB, Date.parse('2026-11-23T00:00:00Z'))).toHaveLength(0);
  });

  it('keeps the earlier use when two Devices race', () => {
    const a = V.markUsed(rec(), { name: 'Sam' }, '2026-11-09T10:00:00.000Z');
    expect(V.markUsed(a, { name: 'Alex' }, '2026-11-09T11:00:00.000Z')).toBe(a);
    expect(a.usedBy).toEqual({ name: 'Sam' });
  });

  it('lists a Space’s invites and drops old closed ones', () => {
    const old = { ...V.markRevoked(rec(), '2026-09-01T00:00:00.000Z'), id: 'f'.repeat(32) };
    const { shown, stale } = V.listFor([rec(), old], SPACE, Date.parse('2026-11-10T00:00:00Z'));
    expect(shown.map((r) => [r.id, r.state])).toEqual([[ID, 'open']]);
    expect(stale).toEqual(['f'.repeat(32)]);
  });
});

describe('the invite page reads the same links', () => {
  it('nomad.dev keeps a byte-for-byte copy of shared/invites.mjs', () => {
    const page = path.join(process.cwd(), '..', 'nomad.dev', 'static', 'invite', 'invites.mjs');
    if (!fs.existsSync(page)) return; // the sibling repo isn't checked out here
    expect(fs.readFileSync(page, 'utf8')).toBe(fs.readFileSync(path.join(process.cwd(), 'shared', 'invites.mjs'), 'utf8'));
  });
});
