// Vouches (shared/vouches.mjs, shared/vouch-engine.mjs, ADR-0045). The GOLDEN hashes pin the bytes a
// Vouch's hash covers: desktop, the phone and any site that checks a Vouch must get the same hex, so
// change them only with a new record version (`v`).

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import * as V from '../../shared/vouches.mjs';
import * as I from '../../shared/inbox.mjs';
import * as P from '../../shared/personas.mjs';
import { createVouchEngine } from '../../shared/vouch-engine.mjs';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const HOST = `hyper://${'a'.repeat(64)}/`;
const GUEST = `hyper://${'b'.repeat(64)}/`;
const OTHER = `hyper://${'c'.repeat(64)}/`;
const AT = '2026-11-08T12:00:00.000Z';
const ID = V.newVouchId(new Uint8Array(16).map((_, i) => i));

const vouch = (o = {}) =>
  V.makeVouch({ id: ID, host: HOST, guest: GUEST, note: 'Dinner at ours, lovely guest.', ...o }, AT);

describe('the record', () => {
  it('has one kind, a year, and no other fields', () => {
    const v = vouch();
    expect(v).toEqual({
      type: 'walled.garden/vouch',
      v: 1,
      id: 'aaaqeayeaudaocajbifqydiob4',
      kind: 'hosted',
      host: HOST,
      guest: GUEST,
      note: 'Dinner at ours, lovely guest.',
      issuedAt: AT,
      expiresAt: '2027-11-08T12:00:00.000Z',
    });
    expect(V.isVouch(v)).toBe(true);
    expect(V.vouchError({ ...v, visits: 3 })).toBe('unknown field visits');
    expect(V.vouchError({ ...v, kind: 'rating' })).toBe('bad kind');
    expect(V.vouchError({ ...v, expiresAt: '2028-11-08T12:00:00.000Z' })).toBe('bad expiresAt');
    expect(V.vouchError({ ...v, host: HOST.slice(0, -1) })).toBe('bad host');
  });

  it('needs a note, and cleans it', () => {
    expect(() => vouch({ note: '  \n ' })).toThrow(/few words/);
    expect(() => vouch({ note: undefined })).toThrow(/few words/);
    const { note: _n, ...noNote } = vouch();
    expect(V.vouchError(noNote)).toBe('bad note');
    expect(V.vouchError({ ...vouch(), note: '   ' })).toBe('bad note');
    expect(vouch({ note: 'a\u0007b\r\n\n\n\nc' }).note).toBe('ab\n\nc');
    expect(() => vouch({ note: 'x'.repeat(281) })).toThrow(/280/);
  });

  it('refuses a vouch for yourself', () => {
    expect(() => vouch({ guest: HOST })).toThrow(/own profile/);
  });

  it('hashes canonical JSON (golden)', () => {
    const v = vouch();
    expect(V.canonicalJSON(v)).toBe(
      `{"expiresAt":"2027-11-08T12:00:00.000Z","guest":"${GUEST}","host":"${HOST}","id":"aaaqeayeaudaocajbifqydiob4","issuedAt":"2026-11-08T12:00:00.000Z","kind":"hosted","note":"Dinner at ours, lovely guest.","type":"walled.garden/vouch","v":1}`
    );
    expect(V.vouchHash(v, sha)).toBe('89f918a5359a350c0db78a2a85b5fed98f06519e4772df4b5768531d66323d32');
    // Key order doesn't matter; non-ASCII text is hashed as UTF-8.
    const { note: _n, ...rest } = v;
    expect(V.vouchHash({ ...rest, note: 'Café ☕' }, sha)).toBe(V.vouchHash({ note: 'Café ☕', ...rest }, sha));
    expect(V.vouchHash({ ...rest, note: 'Café ☕' }, sha)).toBe(GOLDEN_UTF8);
  });
});

const GOLDEN_UTF8 = sha(
  `{"expiresAt":"2027-11-08T12:00:00.000Z","guest":"${GUEST}","host":"${HOST}","id":"aaaqeayeaudaocajbifqydiob4","issuedAt":"2026-11-08T12:00:00.000Z","kind":"hosted","note":"Café ☕","type":"walled.garden/vouch","v":1}`
);

describe('checking', () => {
  const v = vouch();
  const h = V.vouchHash(v, sha);
  const t = Date.parse(AT) + 1000;

  it('is valid only while the host lists its hash', () => {
    expect(V.verifyVouch(v, V.makeIndex([h]), t, sha)).toBe('valid');
    expect(V.verifyVouch(v, V.makeIndex([]), t, sha)).toBe('withdrawn');
    expect(V.verifyVouch(v, null, t, sha)).toBe('unreachable');
    expect(V.verifyVouch(v, { type: 'something' }, t, sha)).toBe('unreachable');
    expect(V.verifyVouch(v, V.makeIndex([h]), Date.parse(v.expiresAt), sha)).toBe('expired');
    expect(V.verifyVouch({ ...v, note: 'changed' }, V.makeIndex([h]), t, sha)).toBe('withdrawn');
    expect(V.verifyVouch({ nope: 1 }, V.makeIndex([h]), t, sha)).toBe('invalid');
  });

  it('renews with the same id and new dates, due in the last month', () => {
    const later = Date.parse(v.expiresAt) - 10 * V.DAY_MS;
    expect(V.renewDue(v, Date.parse(AT))).toBe(false);
    expect(V.renewDue(v, later)).toBe(true);
    const r = V.renewVouch(v, later);
    expect(r.id).toBe(v.id);
    expect(Date.parse(r.expiresAt) - Date.parse(r.issuedAt)).toBe(V.VALID_MS);
    expect(V.vouchHash(r, sha)).not.toBe(h);
  });

  it('makes an index of unique, sorted hex hashes', () => {
    expect(V.makeIndex(['B'.repeat(64), 'a'.repeat(64), 'b'.repeat(64), 'nope'])).toEqual({
      type: V.INDEX_TYPE,
      v: 1,
      hashes: ['a'.repeat(64), 'b'.repeat(64)],
    });
  });
});

describe('records', () => {
  it('names the Persona and the vouch in the path', () => {
    expect(V.heldPath('persona0001', ID)).toBe(`/.vault/vouches-held/persona0001/${ID}.json`);
    expect(V.parseRecordPath(V.givenPath('persona0001', ID))).toEqual({
      kind: 'given',
      personaId: 'persona0001',
      id: ID,
    });
    expect(() => V.heldPath('x', ID)).toThrow();
  });

  it('shows a held vouch only once accepted', () => {
    const r = V.makeHeld(vouch(), AT);
    expect(r).toMatchObject({ state: 'new', shown: 'me' });
    expect(() => V.setShown(r, 'profile')).toThrow(/Accept/);
    const a = V.setShown(V.acceptHeld(r, AT), 'sites');
    expect(a).toMatchObject({ state: 'accepted', shown: 'sites' });
    expect(() => V.setShown(a, 'everyone')).toThrow();
  });

  it('takes a renewal from the same host without asking again', () => {
    const v = vouch();
    const held = V.setShown(V.acceptHeld(V.makeHeld(v, AT), AT), 'profile');
    const renewed = V.renewVouch(v, Date.parse(AT) + 300 * V.DAY_MS);
    expect(V.mergeIncoming(null, v, AT)).toMatchObject({ state: 'new', vouch: v });
    expect(V.mergeIncoming(held, renewed, AT)).toMatchObject({ state: 'accepted', shown: 'profile', vouch: renewed });
    expect(V.mergeIncoming(held, v, AT)).toBeNull();
    expect(V.mergeIncoming(held, { ...renewed, host: OTHER }, AT)).toBeNull();
  });

  it('lists what the host stands behind, and what isn’t theirs', () => {
    const v = vouch();
    const g = V.makeGiven(v, null, AT);
    const w = V.withdrawGiven(V.makeGiven(vouch({ guest: OTHER, id: 'b'.repeat(26) }), null, AT), AT);
    const t = Date.parse(AT);
    expect(V.standingHashes([g, w], sha, t)).toEqual([V.vouchHash(v, sha)]);
    expect(V.foreignHashes([V.vouchHash(v, sha), V.vouchHash(w.vouch, sha), 'f'.repeat(64)], [g, w], sha)).toEqual([
      'f'.repeat(64),
    ]);
  });
});

describe('from a Message', () => {
  const personas = [{ id: 'guest00001', profileUrl: GUEST }];
  const msg = (o = {}) =>
    I.makeMessage({ id: 'm'.repeat(26), from: HOST, to: GUEST, text: '', vouch: vouch(), ...o }, AT);

  it('a Message can carry a vouch with no text, from its host to its guest only', () => {
    const m = msg();
    expect(m.text).toBe('');
    expect(I.messageError(m)).toBeNull();
    expect(I.messagePreview(m)).toMatch(/vouched for you/i);
    expect(I.messageError({ ...m, vouch: undefined })).toBe('bad text');
    expect(I.messageError({ ...m, from: OTHER })).toBe('bad vouch');
    expect(I.messageError({ ...m, vouch: { ...m.vouch, kind: 'x' } })).toBe('bad vouch');
    expect(() => I.makeMessage({ id: 'm'.repeat(26), from: HOST, to: GUEST, text: '' }, AT)).toThrow();
  });

  it('takes a vouch only from a checked Message to the Persona it names', () => {
    const rec = { type: I.RECORD_TYPE, personaId: 'guest00001', direction: 'in', message: msg(), status: 'received' };
    expect(V.vouchFromMessage(rec, personas)).toEqual({ personaId: 'guest00001', vouch: vouch() });
    expect(V.vouchFromMessage({ ...rec, verified: false }, personas)).toBeNull();
    expect(V.vouchFromMessage({ ...rec, direction: 'out' }, personas)).toBeNull();
    expect(V.vouchFromMessage({ ...rec, personaId: 'someone001' }, personas)).toBeNull();
  });
});

describe('who sees it', () => {
  it('keeps only vouches about the profile that lists them', () => {
    const mine = vouch();
    const theirs = vouch({ guest: OTHER, id: 'c'.repeat(26) });
    expect(V.shownItems(V.makeShownList([mine, theirs, mine]), GUEST)).toEqual([mine]);
    expect(V.shownItems({ type: 'nope', items: [mine] }, GUEST)).toEqual([]);
  });

  it('groups by whether the viewer knows the host, never counting withdrawn ones', () => {
    const a = { vouch: vouch(), state: 'valid' };
    const b = { vouch: vouch({ host: OTHER, id: 'd'.repeat(26) }), state: 'unreachable' };
    const c = { vouch: vouch({ host: OTHER, id: 'e'.repeat(26) }), state: 'withdrawn' };
    expect(V.groupForViewer([a, b, c], ['a'.repeat(64)])).toEqual({ known: [a], others: [b] });
    expect(V.groupForViewer([a, b, c], [])).toEqual({ known: [], others: [a, b] });
  });

  it('gives a site the ticked vouches it still holds', () => {
    const v = vouch();
    const held = [V.acceptHeld(V.makeHeld(v, AT), AT), V.makeHeld(vouch({ id: 'f'.repeat(26) }), AT)];
    expect(V.sessionVouches([v.id, 'f'.repeat(26)], held, Date.parse(AT))).toEqual([v]);
    expect(V.profileVouches([V.setShown(held[0], 'profile'), held[1]], Date.parse(AT))).toEqual([v]);
  });
});

describe('the vouches permission (nomad.session)', () => {
  const K = 'a'.repeat(64);
  it('is asked by name, and needs the profile and a ticked vouch', () => {
    expect(P.requestedPerms(['profile', 'vouches'], K)).toEqual(['profile', 'vouches']);
    expect(P.requestedPerms(['vouches'], K)).toEqual(['profile', 'vouches']);
    expect(() => P.requestedPerms(['vouches:x'], K)).toThrow(/can’t grant/);
    expect(P.grantedPerms(['profile', 'vouches'], ['profile', 'vouches'], { vouches: 1 })).toEqual(['profile', 'vouches']);
    expect(P.grantedPerms(['profile', 'vouches'], ['vouches'], { vouches: 1 })).toEqual([]);
    expect(P.grantedPerms(['profile', 'vouches'], ['profile', 'vouches'], { vouches: 0 })).toEqual(['profile']);
  });

  it('keeps the ticked ids on the Session and shows the records', () => {
    const s = P.makeSession({
      id: 's'.repeat(26),
      origin: 'https://example.com',
      personaId: 'persona0001',
      space: K,
      perms: ['profile', 'vouches'],
      vouches: [ID, 'not an id'],
      now: AT,
    });
    expect(s.vouches).toEqual([ID]);
    const view = P.sessionView(s, { url: HOST, title: 'Maya' }, null, [vouch()]);
    expect(view.perms).toEqual(['profile', 'vouches']);
    expect(view.vouches).toEqual([vouch()]);
    const none = P.makeSession({ ...s, perms: ['profile', 'vouches'], vouches: [], now: AT });
    expect(none.perms).toEqual(['profile']);
    expect(none.vouches).toBeUndefined();
  });
});

// Two people, each with one Persona, on one in-memory "network": Maya (the host) and Sam (the guest).
function world() {
  const drives = new Map(); // profile URL -> Map(path -> obj)
  const vaults = { maya: new Map(), sam: new Map() };
  let t = Date.parse(AT);
  const clock = () => t;
  const people = {
    maya: { id: 'maya000001', label: 'Me', profileUrl: HOST, usable: true },
    sam: { id: 'sam0000001', label: 'Me', profileUrl: GUEST, usable: true },
  };
  for (const p of Object.values(people)) drives.set(p.profileUrl, new Map([['/index.json', { type: 'walled.garden/person', title: p === people.maya ? 'Maya' : 'Sam' }]]));
  const store = (m) => ({
    read: async (p) => m.get(p) ?? null,
    list: async (pre) => [...m.keys()].filter((k) => k.startsWith(pre)).sort().map((k) => m.get(k)),
    listPaths: async (pre) => [...m.keys()].filter((k) => k.startsWith(pre)).sort(),
    put: async (p, o) => void m.set(p, structuredClone(o)),
    del: async (p) => void m.delete(p),
  });
  let n = 0;
  const engines = {};
  const foreign = [];
  for (const who of ['maya', 'sam']) {
    const me = people[who];
    const other = who === 'maya' ? people.sam : people.maya;
    engines[who] = createVouchEngine({
      store: store(vaults[who]),
      sha256hex: sha,
      randomBytes: (k) => new Uint8Array(k).map(() => (n++ * 37) & 255),
      personas: () => [me],
      readProfileFile: async (url, path) => {
        const d = drives.get(url);
        return d ? { value: d.get(path) ?? null } : null;
      },
      writeProfileFile: async (pid, path, obj) => {
        const d = drives.get(me.profileUrl);
        if (obj == null) d.delete(path);
        else d.set(path, structuredClone(obj));
        return true;
      },
      // Delivery: the Message lands in the other side's Vault, as the Inbox would put it.
      send: async ({ personaId, to, vouch }) => {
        const message = I.makeMessage({ id: I.newMessageId(new Uint8Array(16).map(() => n++ & 255)), from: me.profileUrl, to, text: '', vouch }, new Date(t).toISOString());
        const rec = I.makeRecord({ personaId: other.id, direction: 'in', message, status: 'received', receivedAt: new Date(t).toISOString() });
        const ck = sha(I.conversationKeyInput(message.to, message.from));
        vaults[who === 'maya' ? 'sam' : 'maya'].set(I.messagePath(other.id, ck, message), rec);
        void personaId;
      },
      reachable: async () => true,
      known: async () => (who === 'sam' ? [] : [GUEST]),
      onForeign: (f) => foreign.push(f),
      now: clock,
    });
  }
  return { drives, vaults, engines, people, foreign, tick: (ms) => (t += ms) };
}

describe('the engine, end to end', () => {
  it('gives, takes in, accepts, shows on the profile, renews and withdraws', async () => {
    const w = world();
    const { maya, sam } = w.engines;
    const v = await maya.give({ personaId: 'maya000001', to: GUEST, note: 'Lovely dinner' });
    expect(w.drives.get(HOST).get(V.INDEX_PATH).hashes).toEqual([V.vouchHash(v, sha)]);

    // Sam's Device takes it in once, as New.
    expect(await sam.intake()).toBe(1);
    expect(await sam.intake()).toBe(0);
    const msgs = [...w.vaults.sam.entries()].filter(([k]) => k.startsWith('/.vault/messages/'));
    expect(msgs).toHaveLength(1);
    expect(msgs[0][1].vouchSeen).toBe(V.intakeMark(v));
    let s = await sam.summary();
    expect(s.held).toHaveLength(1);
    expect(s.held[0]).toMatchObject({ state: 'new', shown: 'me', check: 'valid', host: { title: 'Maya' } });

    // Nothing on the profile until accepted and shown there.
    await expect(sam.setShown('sam0000001', v.id, 'profile')).rejects.toThrow(/Accept/);
    await sam.accept('sam0000001', v.id);
    await sam.setShown('sam0000001', v.id, 'profile');
    expect(w.drives.get(GUEST).get(V.PROFILE_PATH).items).toEqual([v]);

    // Maya knows Sam; looking at Sam's profile from Maya's side shows her own vouch in "others"
    // (Maya's own Persona counts as known, so it's in known).
    const seen = await maya.profileVouches(GUEST);
    expect(seen.known.map((x) => x.vouch.id)).toEqual([v.id]);

    // Login choices offer it once it's shown somewhere.
    expect(sam.loginChoices('sam0000001')).toEqual([{ id: v.id, host: HOST, note: 'Lovely dinner', issuedAt: v.issuedAt }]);
    expect(sam.sessionVouches('sam0000001', [v.id])).toEqual([v]);

    // Renewal replaces it on Sam's side without asking, and keeps it on the profile.
    w.tick(340 * V.DAY_MS);
    const r = await maya.renew('maya000001', v.id);
    expect(await sam.intake()).toBe(1);
    expect(w.drives.get(GUEST).get(V.PROFILE_PATH).items).toEqual([r]);
    s = await sam.summary();
    expect(s.held[0]).toMatchObject({ state: 'accepted', check: 'valid' });

    // Withdrawal is quiet: nothing is sent, and the vouch stops checking out.
    await maya.withdraw('maya000001', v.id);
    expect(w.drives.get(HOST).get(V.INDEX_PATH).hashes).toEqual([]);
    w.tick(2 * 60 * 1000);
    s = await sam.summary();
    expect(s.held[0].check).toBe('withdrawn');
    const after = await maya.profileVouches(GUEST);
    expect(after.known).toEqual([]);
    expect(after.others).toEqual([]);
  });

  it('a declined vouch stays gone', async () => {
    const w = world();
    const v = await w.engines.maya.give({ personaId: 'maya000001', to: GUEST, note: 'Came for dinner' });
    await w.engines.sam.intake();
    await w.engines.sam.decline('sam0000001', v.id);
    expect(await w.engines.sam.intake()).toBe(0);
    expect((await w.engines.sam.summary()).held).toEqual([]);
  });

  it('won’t vouch twice for the same person, or for an unreachable one', async () => {
    const w = world();
    await w.engines.maya.give({ personaId: 'maya000001', to: GUEST, note: 'Came for dinner' });
    await expect(w.engines.maya.give({ personaId: 'maya000001', to: GUEST, note: 'Came for dinner' })).rejects.toThrow(/already/);
    await expect(w.engines.maya.give({ personaId: 'maya000001', to: HOST, note: 'x' })).rejects.toThrow(/own/);
  });

  it('flags a hash in the host’s drive that none of their Devices wrote, after a grace period', async () => {
    const w = world();
    await w.engines.maya.give({ personaId: 'maya000001', to: GUEST, note: 'Came for dinner' });
    const idx = w.drives.get(HOST).get(V.INDEX_PATH);
    w.drives.get(HOST).set(V.INDEX_PATH, V.makeIndex([...idx.hashes, 'f'.repeat(64)]));
    expect(await w.engines.maya.guard()).toEqual([]);
    w.tick(11 * 60 * 1000);
    const out = await w.engines.maya.guard();
    expect(out).toMatchObject([{ personaId: 'maya000001', hash: 'f'.repeat(64) }]);
    expect(w.foreign).toHaveLength(1);
    await w.engines.maya.guard();
    expect(w.foreign).toHaveLength(1);
  });

  it('deleting a Persona withdraws what it gave and clears its profile list', async () => {
    const w = world();
    await w.engines.maya.give({ personaId: 'maya000001', to: GUEST, note: 'Came for dinner' });
    await w.engines.maya.forgetPersona('maya000001');
    expect(w.drives.get(HOST).get(V.INDEX_PATH).hashes).toEqual([]);
    expect([...w.vaults.maya.keys()].filter((k) => k.startsWith('/.vault/vouches-'))).toEqual([]);
  });
});
