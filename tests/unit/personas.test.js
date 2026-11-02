import { describe, it, expect } from 'vitest';
import {
  PERSONA_TYPE,
  personaPath,
  sessionsPrefix,
  sessionPath,
  parseSessionPath,
  sessionOrigin,
  normalizeProfileUrl,
  newPersonaId,
  newSessionId,
  normalizeLabel,
  normalizeEmail,
  makePersona,
  isPersona,
  makeDefault,
  sortPersonas,
  resolvePersona,
  resolvedFrom,
  profileState,
  requestedPerms,
  grantedPerms,
  normalizeMaxAge,
  makeSession,
  isSession,
  isExpired,
  sessionGrants,
  sessionView,
  sortSessions,
  shortOrigin,
  base32,
  MAX_AGE_LIMIT,
} from '../../shared/personas.mjs';

const K1 = 'a'.repeat(64);
const K2 = 'b'.repeat(64);
const SPACE = 'c'.repeat(64);
const DEV1 = 'd'.repeat(64);
const DEV2 = 'e'.repeat(64);
const FOREIGN = 'f'.repeat(64);
const bytes = (n, v = 7) => new Uint8Array(n).fill(v);

const persona = (id, label, key = K1, extra = {}) =>
  makePersona(
    { id, label, profileUrl: `hyper://${key}/`, creator: key, ...extra },
    null,
    '2026-10-01T00:00:00.000Z'
  );

describe('paths', () => {
  it('builds and parses Session paths', () => {
    expect(personaPath('abcd1234')).toBe('/.vault/personas/abcd1234.json');
    expect(sessionsPrefix(SPACE)).toBe(`/.vault/sessions/${SPACE}/`);
    expect(sessionsPrefix(SPACE, 'abcd1234')).toBe(`/.vault/sessions/${SPACE}/abcd1234/`);
    const p = sessionPath(SPACE, 'abcd1234', K2);
    expect(p).toBe(`/.vault/sessions/${SPACE}/abcd1234/${K2}.json`);
    expect(parseSessionPath(p)).toEqual({ space: SPACE, personaId: 'abcd1234', hash: K2 });
    expect(parseSessionPath('/.vault/sessions/x/y/z.json')).toBeNull();
  });
});

describe('sessionOrigin', () => {
  it('keeps scheme, host and port for the web', () => {
    expect(sessionOrigin('https://Example.com/path?q')).toBe('https://example.com');
    expect(sessionOrigin('http://localhost:8080/')).toBe('http://localhost:8080');
  });
  it('uses the key for a drive', () => {
    expect(sessionOrigin(`hyper://${K1}/posts/`)).toBe(`hyper://${K1}`);
  });
  it('refuses pages that can’t hold a Session', () => {
    expect(sessionOrigin('nomad://library/')).toBeNull();
    expect(sessionOrigin('hyper://private/')).toBeNull();
    expect(sessionOrigin('hyper://my-blog/')).toBeNull();
    expect(sessionOrigin('file:///etc/passwd')).toBeNull();
    expect(sessionOrigin('data:text/html,hi')).toBeNull();
    expect(sessionOrigin('not a url')).toBeNull();
  });
});

describe('Persona records', () => {
  it('normalizes the profile URL and label', () => {
    expect(normalizeProfileUrl(`  hyper://${K1.toUpperCase()}/thumb `)).toBe(`hyper://${K1}/`);
    expect(() => normalizeProfileUrl('https://example.com')).toThrow(/Profile Drive/);
    expect(normalizeLabel('  Work   stuff ')).toBe('Work stuff');
    expect(() => normalizeLabel('  ')).toThrow(/name/);
    expect(() => normalizeLabel('x'.repeat(41))).toThrow(/40/);
  });

  it('makes ids from random bytes', () => {
    expect(newPersonaId(bytes(10))).toMatch(/^[a-z2-7]{16}$/);
    expect(newSessionId(bytes(16))).toMatch(/^[a-z2-7]{26}$/);
    expect(() => newSessionId(bytes(8))).toThrow();
  });

  it('makes and updates a Persona', () => {
    const p = persona('abcd1234', 'Work');
    expect(p).toMatchObject({
      type: PERSONA_TYPE,
      id: 'abcd1234',
      label: 'Work',
      profileUrl: `hyper://${K1}/`,
      creator: K1,
    });
    expect(isPersona(p)).toBe(true);
    const q = makePersona({ label: 'Job' }, p, '2026-10-02T00:00:00.000Z');
    expect(q).toMatchObject({
      id: 'abcd1234',
      label: 'Job',
      createdAt: p.createdAt,
      updatedAt: '2026-10-02T00:00:00.000Z',
      creator: K1,
    });
  });

  it('keeps creator only when it is the Profile Drive’s own key', () => {
    const p = makePersona({
      id: 'abcd1234',
      label: 'Me',
      profileUrl: `hyper://${K1}/`,
      creator: K2,
    });
    expect(p.creator).toBeUndefined();
  });

  it('rejects broken records', () => {
    expect(isPersona(null)).toBe(false);
    expect(
      isPersona({ type: PERSONA_TYPE, id: 'abcd1234', label: 'x', profileUrl: 'https://x' })
    ).toBe(false);
    expect(() => makePersona({ label: 'x', profileUrl: `hyper://${K1}/` })).toThrow(/id/);
  });

  it('sorts by label', () => {
    expect(
      sortPersonas([persona('bbbbbbbb', 'Work'), persona('aaaaaaaa', 'Me')]).map((p) => p.label)
    ).toEqual(['Me', 'Work']);
  });

  it('makes the default record', () => {
    expect(makeDefault('abcd1234', 'T')).toEqual({
      type: 'nomad/persona-default',
      personaId: 'abcd1234',
      updatedAt: 'T',
    });
    expect(makeDefault(null, 'T').personaId).toBeNull();
  });
});

describe('resolvePersona (ADR-0031 §4)', () => {
  const work = persona('workwork', 'Work');
  const me = persona('memememe', 'Me', K2);
  const personas = [work, me];

  it('prefers the Space’s own Persona, then the default, then none', () => {
    expect(resolvePersona({ spaceOverride: 'workwork', defaultId: 'memememe', personas })).toBe(
      work
    );
    expect(resolvePersona({ spaceOverride: null, defaultId: 'memememe', personas })).toBe(me);
    expect(resolvePersona({ personas })).toBeNull();
    expect(resolvedFrom({ spaceOverride: 'workwork', defaultId: 'memememe', personas })).toBe(
      'space'
    );
    expect(resolvedFrom({ defaultId: 'memememe', personas })).toBe('default');
  });

  it('falls back when the override is gone or unusable', () => {
    expect(resolvePersona({ spaceOverride: 'gonegone', defaultId: 'memememe', personas })).toBe(me);
    const usable = (p) => p.id !== 'workwork';
    expect(
      resolvePersona({ spaceOverride: 'workwork', defaultId: 'memememe', personas, usable })
    ).toBe(me);
    expect(
      resolvePersona({ spaceOverride: 'workwork', defaultId: 'workwork', personas, usable })
    ).toBeNull();
  });
});

describe('profileState (ADR-0031 §5)', () => {
  const p = persona('workwork', 'Work');

  it('is usable when every writer is one of the user’s Devices', () => {
    expect(profileState({ persona: p, deviceKeys: [DEV1, DEV2], writers: [] }).state).toBe(
      'usable'
    );
    expect(profileState({ persona: p, deviceKeys: [DEV1, DEV2], writers: [DEV1, K1] }).state).toBe(
      'usable'
    );
  });

  it('flags a writer that isn’t one of the user’s Devices', () => {
    const s = profileState({ persona: p, deviceKeys: [DEV1], writers: [DEV1, FOREIGN] });
    expect(s.state).toBe('foreign-writers');
    expect(s.foreign).toEqual([FOREIGN]);
  });

  it('flags a drive the user’s Devices didn’t make', () => {
    const other = makePersona({ id: 'otherone', label: 'X', profileUrl: `hyper://${K2}/` });
    expect(profileState({ persona: other, deviceKeys: [DEV1], writers: [] }).state).toBe(
      'foreign-writers'
    );
  });

  it('says “not ready”, never “invalid”, before the Vault or the drive has synced', () => {
    expect(profileState({ persona: p, vaultReady: false, writers: [FOREIGN] }).state).toBe(
      'not-ready'
    );
    expect(profileState({ persona: p, deviceKeys: [DEV1], writers: null }).state).toBe('not-ready');
    expect(profileState({ persona: p, deviceKeys: [DEV1], writers: [], loaded: false }).state).toBe(
      'not-ready'
    );
  });
});

describe('Session permissions (ADR-0031 §9)', () => {
  it('turns page names into tokens for the Persona’s own drive', () => {
    expect(requestedPerms(undefined, K1)).toEqual([]);
    expect(requestedPerms(['profile'], K1)).toEqual(['profile']);
    expect(requestedPerms(['profile', 'modifyDrive', 'profile'], K1)).toEqual([
      'profile',
      `modifyDrive:${K1}`,
    ]);
    expect(requestedPerms([`modifyDrive:${K1}`], K1)).toEqual([`modifyDrive:${K1}`]);
  });

  it('refuses anything else', () => {
    expect(() => requestedPerms(['createDrive'], K1)).toThrow(/can’t grant/);
    expect(() => requestedPerms([`modifyDrive:${K2}`], K1)).toThrow(/own profile drive/);
    expect(() => requestedPerms('profile', K1)).toThrow(TypeError);
    expect(() => requestedPerms(['privateRead:/x'], K1)).toThrow();
  });

  it('grants what was left checked, and writing only with the profile', () => {
    const req = ['profile', `modifyDrive:${K1}`];
    expect(grantedPerms(req, req)).toEqual(req);
    expect(grantedPerms(req, [`modifyDrive:${K1}`])).toEqual([]);
    expect(grantedPerms(req, [])).toEqual([]);
    expect(grantedPerms(['profile'], ['profile', 'extra'])).toEqual(['profile']);
  });

  it('checks maxAge', () => {
    expect(normalizeMaxAge(undefined)).toBeNull();
    expect(normalizeMaxAge(60.7)).toBe(60);
    expect(normalizeMaxAge(1e12)).toBe(MAX_AGE_LIMIT);
    expect(() => normalizeMaxAge(0)).toThrow();
    expect(() => normalizeMaxAge('soon')).toThrow();
  });
});

describe('Sessions (ADR-0031 §8, §10)', () => {
  const now = new Date('2026-10-31T12:00:00.000Z');
  const base = {
    id: 'k3v',
    origin: 'https://example.com',
    personaId: 'workwork',
    space: SPACE,
    now,
  };

  it('makes a Session with no expiry by default', () => {
    const s = makeSession({ ...base, perms: ['profile', 'profile'] });
    expect(s).toEqual({
      type: 'nomad/session',
      id: 'k3v',
      origin: 'https://example.com',
      personaId: 'workwork',
      space: SPACE,
      perms: ['profile'],
      createdAt: '2026-10-31T12:00:00.000Z',
    });
    expect(isSession(s)).toBe(true);
    expect(isExpired(s, now.getTime() + 1e12)).toBe(false);
  });

  it('expires when the page asked for less', () => {
    const s = makeSession({ ...base, maxAge: 3600 });
    expect(s.expiresAt).toBe('2026-10-31T13:00:00.000Z');
    expect(isExpired(s, new Date('2026-10-31T12:59:59Z'))).toBe(false);
    expect(isExpired(s, new Date('2026-10-31T13:00:00Z'))).toBe(true);
  });

  it('refuses a Session without its key parts', () => {
    expect(() => makeSession({ ...base, origin: 'https://example.com/' })).toThrow(/origin/);
    expect(() => makeSession({ ...base, space: 'x' })).toThrow(/Space/);
    expect(() => makeSession({ ...base, personaId: '' })).toThrow(/Persona/);
  });

  it('grants only the tokens it holds, while live, never on the private drive', () => {
    const s = makeSession({ ...base, perms: ['profile', `modifyDrive:${K1}`], maxAge: 60 });
    expect(sessionGrants(s, `modifyDrive:${K1}`, now)).toBe(true);
    expect(sessionGrants(s, `modifyDrive:${K2}`, now)).toBe(false);
    expect(sessionGrants(s, 'createDrive', now)).toBe(false);
    expect(sessionGrants(s, `modifyDrive:${K1}`, now.getTime() + 61000)).toBe(false);
    expect(
      sessionGrants({ ...s, perms: ['privateRead:private'] }, 'privateRead:private', now)
    ).toBe(false);
    expect(sessionGrants(null, 'profile')).toBe(false);
  });

  it('shows a page its id, and the profile only with `profile`', () => {
    const profile = { url: `hyper://${K1}/`, title: 'Ada', thumb: '/thumb' };
    const stranger = makeSession({ ...base, perms: [] });
    expect(sessionView(stranger, profile)).toEqual({
      id: 'k3v',
      perms: [],
      createdAt: stranger.createdAt,
    });
    const known = makeSession({ ...base, perms: ['profile', `modifyDrive:${K1}`] });
    expect(sessionView(known, profile)).toEqual({
      id: 'k3v',
      perms: ['profile', 'modifyDrive'],
      createdAt: known.createdAt,
      profile,
    });
    expect(sessionView(null)).toBeNull();
  });

  it('sorts newest first and shortens origins', () => {
    const a = makeSession({ ...base, id: 'a', now: new Date('2026-01-01') });
    const b = makeSession({ ...base, id: 'b', now: new Date('2026-02-01') });
    expect(sortSessions([a, b]).map((s) => s.id)).toEqual(['b', 'a']);
    expect(shortOrigin('https://example.com')).toBe('example.com');
    expect(shortOrigin(`hyper://${K1}`)).toBe('hyper://aaaaaa…aaaa');
  });
});

describe('email (ADR-0031 amendment)', () => {
  const now = new Date('2026-10-31T12:00:00.000Z');
  const base = {
    id: 'k3v',
    origin: 'https://example.com',
    personaId: 'workwork',
    space: SPACE,
    now,
  };

  it('normalizes an address and refuses what isn’t one', () => {
    expect(normalizeEmail('  Ada.L+site@Example.ORG ')).toBe('Ada.L+site@example.org');
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    for (const bad of [
      'ada',
      '@example.org',
      'ada@',
      'ada@localhost',
      'a da@x.org',
      'ada@x..org',
      '<a>@x.org',
    ])
      expect(() => normalizeEmail(bad), bad).toThrow(/email/);
    expect(() => normalizeEmail(`${'a'.repeat(250)}@x.org`)).toThrow(/at most/);
  });

  it('keeps the email on the Persona record, and clears it when emptied', () => {
    const p = persona('abcd1234', 'Work', K1, { email: 'ada@example.org' });
    expect(p.email).toBe('ada@example.org');
    expect(makePersona({ label: 'Job' }, p).email).toBe('ada@example.org');
    expect(makePersona({ email: '' }, p)).not.toHaveProperty('email');
    expect(persona('abcd1234', 'Work')).not.toHaveProperty('email');
  });

  it('asks for email on its own, without the profile', () => {
    expect(requestedPerms(['email'], K1)).toEqual(['email']);
    expect(requestedPerms(['profile', 'email'], K1)).toEqual(['profile', 'email']);
    expect(() => requestedPerms(['email:x'], K1)).toThrow(/can’t grant/);
    expect(grantedPerms(['profile', 'email'], ['email'])).toEqual(['email']);
    expect(grantedPerms(['profile', 'email'], ['profile', 'email'], { hasEmail: false })).toEqual([
      'profile',
    ]);
  });

  it('shows a page the email only with `email`', () => {
    const profile = { url: `hyper://${K1}/`, title: 'Ada' };
    const s = makeSession({ ...base, perms: ['email'] });
    expect(sessionView(s, profile, 'ada@example.org')).toEqual({
      id: 'k3v',
      perms: ['email'],
      createdAt: s.createdAt,
      email: 'ada@example.org',
    });
    const p = makeSession({ ...base, perms: ['profile'] });
    expect(sessionView(p, profile, 'ada@example.org')).not.toHaveProperty('email');
    expect(sessionView(s, profile, null)).not.toHaveProperty('email');
    expect(sessionGrants(s, 'email', now)).toBe(true);
  });
});

describe('base32', () => {
  it('matches RFC 4648 test vectors (lowercase, unpadded)', () => {
    const enc = (s) => base32(new TextEncoder().encode(s));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('my');
    expect(enc('fo')).toBe('mzxq');
    expect(enc('foo')).toBe('mzxw6');
    expect(enc('foob')).toBe('mzxw6yq');
    expect(enc('fooba')).toBe('mzxw6ytb');
    expect(enc('foobar')).toBe('mzxw6ytboi');
  });
});
