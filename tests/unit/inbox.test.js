// The Persona Inbox's rules (shared/inbox.mjs, ADR-0036): key derivation, the message link, the
// sealed frame, consent and limits. The GOLDEN values below pin the bytes: the phone
// (mobile/backend/lib/inbox.mjs) runs the same file, and a Message sealed on one must open on the
// other. Change them only with a new SIG_CONTEXT / frame VERSION.
//
// Crypto loads from app/node_modules (the repo root has none).

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import * as I from '../../shared/inbox.mjs';

let crypto;
beforeAll(() => {
  const rq = createRequire(path.join(process.cwd(), 'app', 'package.json'));
  crypto = I.cryptoFromSodium(rq('sodium-universal'));
});

const P1 = `hyper://${'1'.repeat(64)}/`;
const P2 = `hyper://${'2'.repeat(64)}/`;
const DEV = 'd'.repeat(64);
const DEV2 = 'e'.repeat(64);
const PID = 'persona0001';
const R_SEED = new Uint8Array(32).map((_, i) => i);
const S_SEED = new Uint8Array(32).map((_, i) => 255 - i);
const AT = '2026-11-03T12:00:00.000Z';

const GOLDEN = {
  recipient: {
    sign: '4aa05440abcc977a0d2aaae75ffaf0489442540df5fbd6e345f0fadb70c3df8b',
    box: 'b972c6ab0d27f4a47f2208c5d9beaad2505b9a02deb7535c71ffc7108efdea03',
    mailboxes: ['96a7349fc618eb4599bfbb431a88c69dd6c9edbeb43eff9721588943e1d4355f'],
  },
  sender: {
    sign: '660b51eb536273788a6fc4b631c958b17559554c3a20e09c5a8d320ffd78f09a',
    box: 'bceab63ad32b5c1315a3b947948b25fe39b9633a70efc17290fd7f3b5dbe1917',
    mailboxes: ['9b6b371420b69e69d1601cee852b191bca22b202da66ba3deabe1b73a60b3f22'],
  },
  canonical:
    '{"createdAt":"2026-11-03T12:00:00.000Z","from":"' +
    P1 +
    '","id":"aaaaaaaaaaaaaaaaaaaaaaaaaa","inReplyTo":"bbbbbbbbbbbbbbbbbbbbbbbbbb","text":"Hello, world. Ünïcode ✓","to":"' +
    P2 +
    '","type":"walled.garden/message"}',
  sig: '35f0ecdf29dbf95dae24033c8061618015f609c709b2e0c7f4f315301314aafea80d31c711ab004c2a21a64d07c46c6a3317d231d68aa5fefd6751bcf5de4b02',
  // sealMessage() of the message below, to the recipient, with invite 'inv123'. A sealed box is
  // randomized, so this was made once; every runtime must open it.
  sealed: 'ebd63fb50d55c0a51e6d7e44dc448e7b2007c1f980478f92d7e3dfdec5ed394b71196b302c7235fbc278a14a807a24d46e23019c9316a974f976ecdd330453af563a8a11c350a62b650d15043826902093a924095013bad248acb1e9b3a30e944fadb1ba0c4d2c3830861382357bf85078709c793085d5d7a21d4e7fc0e9773e69a65d897e857b7af9b0669384d39695a82ea832516bc5e0f45782ab454cb1f2413125715fc6c2426b192d5c90b778d231635c57d0ae251d7f03efe7e2bc7e5cbb2a8de3ae32931fb98457e4d7127b26f78c819fd29f3d5bd8b910fd5f8fc4a1725d67eeee3aa0022a7b076427014cfa798bbd38054f26b0b3ee8c09bcd83be805eeaf785fc0636bb6760a5388e45ae4bcaa7c7dcccc46e5abc75e1e31f6e90e8bad3f68d05e702e0121149ee87349fde1edd6b353759d5e35563b9c84f21761b547e54910ca73701b04185bc3d9c3d831e8c5bc66aac4029614097eb7823e849af5af2d36a4699dc796fd873ec8987b67bb5b804b1e8e72eb9f64c6b9039eb28eac82d6f5473cba176e978dec77accb802d3172cd33c11d56433734e49693f968be07ae14581142daa256e31ce5c6c5f704db58044a17af9e8e94b4de022126663ec909de8a3ff0d5271ed8a130a0dc67adc24a37f2a4b7572dac7b0b79b00e93149c69bc6193d51567b631d011ffdb78ff9d122969f872e735f7d6904891dee5c93133aafa5e2870aeec4d275438da31198a5a1c5c05d32857fd9580d1be84e70588ef17292ca308b2066b1a01cc2a7543a31e79abeeff574b4757f9c4f71db0da24adc76ba51ceaa14a70e86ae4a0cf331db9a1f225f4e9153093c0169fec22def544ee8963f7c94731efe141d0af5aebc324a32b45285028dbbdc5db74ec4cc37f750a3718814f92dc24adbd5ff9a8cab1d92a560ee0893eba91386ce141c54e9b5ac06b2791d8bc6962fdfce630c9a6b9e4d454571186f124219d3c4f9643d53756c4cf015428e4729086514dc3a7573342e9b018403b5bda1917501d7fe9b199968471209adcd53907579b47d5bac98985ed76275ce886a19576aab6f8cf0ed2d5a2a0f8197f10141a64ccf0483eec442f0cddb7bb686f3c5bc07e57295fd5',
};

const goldenMessage = () =>
  I.makeMessage(
    {
      id: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
      from: P1,
      to: P2,
      text: 'Hello, world. Ünïcode ✓',
      inReplyTo: 'bbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
    AT
  );

describe('keys (golden)', () => {
  it('derives the same sign, box and per-Device mailbox keys from a seed', () => {
    expect(I.publicKeys(I.inboxKeys(R_SEED, crypto, [DEV]))).toEqual(GOLDEN.recipient);
    expect(I.publicKeys(I.inboxKeys(S_SEED, crypto, [DEV]))).toEqual(GOLDEN.sender);
  });

  it('separates every use, and every Device', () => {
    const k = I.publicKeys(I.inboxKeys(R_SEED, crypto, [DEV, DEV2]));
    expect(new Set([k.sign, k.box, ...k.mailboxes]).size).toBe(4);
    expect(I.deriveLabel('box')).toBe('nomad/inbox/box/v1');
  });

  it('takes the seed as hex too', () => {
    expect(I.publicKeys(I.inboxKeys(I.toHex(R_SEED), crypto, [DEV]))).toEqual(GOLDEN.recipient);
  });
});

describe('the frame (golden)', () => {
  it('signs the canonical message bound to the recipient box', () => {
    const m = goldenMessage();
    expect(I.canonicalJSON(m)).toBe(GOLDEN.canonical);
    const sender = I.inboxKeys(S_SEED, crypto, [DEV]);
    const sig = crypto.sign(I.signedBytes(m, GOLDEN.recipient.box), sender.sign.secretKey);
    expect(I.toHex(sig)).toBe(GOLDEN.sig);
  });

  it('opens the stored sealed frame', () => {
    const r = I.inboxKeys(R_SEED, crypto, [DEV]);
    const opened = I.openSealed(I.fromHex(GOLDEN.sealed), [r.box], crypto);
    expect(opened).toEqual({
      message: goldenMessage(),
      sign: GOLDEN.sender.sign,
      replyTo: { box: GOLDEN.sender.box, mailboxes: GOLDEN.sender.mailboxes },
      invite: 'inv123',
    });
  });

  it('round-trips and refuses the wrong key, a tampered frame, a forwarded one', () => {
    const r = I.inboxKeys(R_SEED, crypto, [DEV]);
    const s = I.inboxKeys(S_SEED, crypto, [DEV]);
    const m = goldenMessage();
    const sealed = I.sealMessage({ message: m, sign: s.sign, recipientBox: r.box.publicKey }, crypto);
    expect(I.openSealed(sealed, [r.box], crypto).message).toEqual(m);
    expect(I.openSealed(sealed, [s.box], crypto)).toBe(null);
    const bad = sealed.slice();
    bad[bad.length - 1] ^= 1;
    expect(I.openSealed(bad, [r.box], crypto)).toBe(null);
    // The recipient re-seals the same signed body to someone else: the signature names the first box.
    const third = I.inboxKeys(new Uint8Array(32).fill(9), crypto, []);
    const body = JSON.parse(I.fromUtf8(crypto.unseal(sealed, r.box.publicKey, r.box.secretKey)));
    const forwarded = crypto.seal(I.utf8(JSON.stringify(body)), third.box.publicKey);
    expect(I.openSealed(forwarded, [third.box], crypto)).toBe(null);
  });

  it('opens with the previous box after a rotation', () => {
    const old = I.inboxKeys(R_SEED, crypto, []);
    const fresh = I.inboxKeys(new Uint8Array(32).fill(3), crypto, []);
    const s = I.inboxKeys(S_SEED, crypto, []);
    const sealed = I.sealMessage({ message: goldenMessage(), sign: s.sign, recipientBox: old.box.publicKey }, crypto);
    expect(I.openSealed(sealed, [fresh.box, old.box], crypto)).not.toBe(null);
  });

  it('frames with a version byte and a length prefix, and caps the size', () => {
    const f = I.encodeFrame(new Uint8Array([9, 9, 9]));
    expect([...f]).toEqual([1, 9, 9, 9]);
    expect([...I.lengthPrefix(f)]).toEqual([0, 0, 0, 4, 1, 9, 9, 9]);
    expect([...I.decodeFrame(f)]).toEqual([9, 9, 9]);
    expect(() => I.decodeFrame(new Uint8Array([2, 1]))).toThrow();
    expect(I.isAck(I.ACK)).toBe(true);
    expect(() => I.encodeFrame(new Uint8Array(I.MAX_FRAME))).toThrow();
  });

  it('reads frames split across chunks and refuses a huge length before buffering it', () => {
    const r = I.frameReader();
    const whole = I.lengthPrefix(new Uint8Array([1, 2, 3, 4, 5]));
    expect(r.push(whole.slice(0, 3))).toEqual([]);
    expect(r.push(whole.slice(3)).map((f) => [...f])).toEqual([[1, 2, 3, 4, 5]]);
    const big = new Uint8Array(4);
    new DataView(big.buffer).setUint32(0, I.MAX_FRAME + 1);
    expect(() => I.frameReader().push(big)).toThrow(/too large/);
  });
});

describe('messages', () => {
  it('makes a valid walled.garden/message', () => {
    const m = I.makeMessage({ id: I.newMessageId(new Uint8Array(16).fill(5)), from: P1, to: P2, text: '  hi\r\n there ' }, AT);
    expect(m).toEqual({ type: 'walled.garden/message', id: m.id, from: P1, to: P2, createdAt: AT, text: 'hi\n there' });
    expect(m.id).toHaveLength(26);
    expect(I.messageError(m)).toBe(null);
  });

  it('refuses what the schema refuses', () => {
    const m = goldenMessage();
    expect(I.messageError({ ...m, text: '' })).toBe('bad text');
    expect(I.messageError({ ...m, text: 'x'.repeat(8001) })).toBe('bad text');
    expect(I.messageError({ ...m, html: '<img>' })).toBe('unknown field html');
    expect(I.messageError({ ...m, to: m.from })).toBe('to self');
    expect(I.messageError({ ...m, from: 'https://example.com/' })).toBe('bad from');
    expect(() => I.makeMessage({ id: 'x', from: P1, to: P2, text: 'a' })).toThrow();
    expect(() => I.normalizeText('   ')).toThrow(/Write something/);
  });

  it('keeps record paths in time order and parses them back', () => {
    const ck = 'c'.repeat(64);
    const p = I.messagePath(PID, ck, goldenMessage());
    expect(p).toBe(`/.vault/messages/${PID}/${ck}/${AT}-aaaaaaaaaaaaaaaaaaaaaaaaaa.json`);
    expect(I.parseMessagePath(p)).toEqual({ personaId: PID, conversationKey: ck, createdAt: AT, id: 'aaaaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(I.conversationKeyInput(P2, P1)).toBe(I.conversationKeyInput(P1, P2));
  });
});

describe('the inbox record', () => {
  it('makes, rotates and forgets the previous seed after 14 days', () => {
    const rec = I.makeInbox({ personaId: PID, seed: R_SEED, mode: 'link' }, AT);
    expect(I.isInbox(rec)).toBe(true);
    const next = I.rotateInbox(rec, S_SEED, AT);
    expect(next.previous).toEqual({ seed: I.toHex(R_SEED), until: '2026-11-17T12:00:00.000Z' });
    expect(I.liveSeeds(next, Date.parse(AT))).toEqual([I.toHex(S_SEED), I.toHex(R_SEED)]);
    const later = Date.parse('2026-11-18T00:00:00.000Z');
    expect(I.liveSeeds(next, later)).toEqual([I.toHex(S_SEED)]);
    expect(I.forgetLapsed(next, later).previous).toBeUndefined();
    expect(() => I.makeInbox({ personaId: PID, seed: R_SEED, mode: 'everyone' })).toThrow();
  });

  it('publishes per mode (§3)', () => {
    const pub = { sign: 's'.padEnd(64, '0'), box: 'b'.padEnd(64, '0'), mailboxes: ['m'.padEnd(64, '0')] };
    const rec = I.makeInbox({ personaId: PID, seed: R_SEED }, AT);
    expect(I.publishedInbox(rec, pub)).toBe(null);
    expect(I.publishedInbox(I.markSent(rec), pub)).toEqual({ v: 1, sign: pub.sign });
    expect(I.publishedInbox(I.setMode(rec, 'link'), pub)).toEqual({ v: 1, sign: pub.sign });
    expect(I.publishedInbox(I.setMode(rec, 'anyone'), pub)).toEqual({ v: 1, ...pub });
  });

  it('tells an out-of-date profile from a changed one (§7.3)', () => {
    const mine = { sign: '1'.repeat(64), box: '2'.repeat(64), mailboxes: ['3'.repeat(64)] };
    const wanted = { v: 1, ...mine };
    expect(I.checkPublished(wanted, wanted, [mine])).toBe('ok');
    expect(I.checkPublished(undefined, wanted, [mine])).toBe('update');
    expect(I.checkPublished({ v: 1, sign: mine.sign }, wanted, [mine])).toBe('update');
    expect(I.checkPublished({ ...wanted, mailboxes: ['4'.repeat(64)] }, wanted, [mine])).toBe('update');
    expect(I.checkPublished({ ...wanted, box: '9'.repeat(64) }, wanted, [mine])).toBe('changed');
    expect(I.checkPublished({ v: 1, sign: '9'.repeat(64) }, wanted, [mine])).toBe('changed');
    expect(I.checkPublished(null, null, [mine])).toBe('ok');
  });
});

describe('the message link', () => {
  it('round-trips with several mailboxes', () => {
    const box = 'b'.repeat(64);
    const mailboxes = ['1'.repeat(64), '2'.repeat(64)];
    const link = I.messageLink({ profileUrl: P1, box, mailboxes });
    expect(link).toBe(`nomad://messages/new?to=${encodeURIComponent(P1)}&box=${box}&mailbox=${mailboxes[0]}&mailbox=${mailboxes[1]}`);
    expect(I.parseMessageLink(link)).toEqual({ profileUrl: P1, replyTo: { box, mailboxes } });
  });

  it('ignores anything that is not one', () => {
    expect(I.parseMessageLink('https://example.com/new?to=x')).toBe(null);
    expect(I.parseMessageLink('nomad://messages/new?to=nope')).toBe(null);
    expect(I.parseMessageLink(`nomad://messages/new?to=${P1}`)).toEqual({ profileUrl: P1, replyTo: null });
  });
});

describe('consent (§3, §6)', () => {
  const sign = 'a'.repeat(64);
  const accepted = { state: 'accepted', sign };
  it('lets Contacts in, drops blocked, asks for strangers by mode', () => {
    expect(I.classify({ contact: accepted, sign })).toBe('inbox');
    expect(I.classify({ contact: { state: 'accepted', sign: 'b'.repeat(64) }, sign })).toBe('check');
    expect(I.classify({ contact: { state: 'blocked' }, mode: 'anyone', sign })).toBe('drop');
    expect(I.classify({ mode: 'off', sign })).toBe('drop');
    expect(I.classify({ mode: 'link', sign })).toBe('request');
    expect(I.classify({ mode: 'anyone', sign })).toBe('request');
    expect(I.classify({ mode: 'anyone', sign, pendingFromSender: true })).toBe('drop');
  });

  it('keeps the newest 200 requests', () => {
    const reqs = Array.from({ length: 203 }, (_, i) => ({ receivedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
    const gone = I.requestsToPrune(reqs);
    expect(gone).toHaveLength(3);
    expect(gone.map((r) => r.receivedAt)).toEqual(reqs.slice(0, 3).map((r) => r.receivedAt).reverse());
  });

  it('drops a request it could not check within 7 days', () => {
    const rec = { request: true, verified: false, receivedAt: AT };
    expect(I.uncheckedExpired(rec, Date.parse(AT) + 6 * 864e5)).toBe(false);
    expect(I.uncheckedExpired(rec, Date.parse(AT) + 8 * 864e5)).toBe(true);
    expect(I.uncheckedExpired({ ...rec, verified: true }, Date.parse(AT) + 8 * 864e5)).toBe(false);
  });

  it('rate-limits one address per hour and strangers per minute', () => {
    const rl = I.rateLimiter({ perAddressHour: 2, strangersPerMinute: 1 });
    const t = 1e12;
    expect([rl.address('1.2.3.4', t), rl.address('1.2.3.4', t), rl.address('1.2.3.4', t)]).toEqual([true, true, false]);
    expect(rl.address('1.2.3.4', t + 3600e3 + 1)).toBe(true);
    expect([rl.stranger(t), rl.stranger(t), rl.stranger(t + 60e3 + 1)]).toEqual([true, false, true]);
  });
});

describe('the outbox', () => {
  const queued = () => I.makeRecord({ personaId: PID, direction: 'out', message: goldenMessage(), status: 'queued' });
  it('backs off to every 30 minutes and fails after 30 days', () => {
    const t0 = Date.parse(AT);
    let r = queued();
    expect(I.outboxDue(r, t0)).toBe(true);
    r = I.afterAttempt(r, false, t0);
    expect(r.nextAttemptAt).toBe(new Date(t0 + 15e3).toISOString());
    expect(I.outboxDue(r, t0 + 1000)).toBe(false);
    for (let i = 0; i < 10; i++) r = I.afterAttempt(r, false, t0);
    expect(Date.parse(r.nextAttemptAt) - t0).toBe(30 * 60e3);
    const failed = I.afterAttempt(r, false, t0 + I.OUTBOX_MS + 1);
    expect(failed.status).toBe('failed');
    expect(I.retryNow(failed)).toMatchObject({ status: 'queued', attempts: 0 });
    expect(I.afterAttempt(queued(), true, t0)).toMatchObject({ status: 'delivered', deliveredAt: AT });
  });

  it('groups records into Conversations', () => {
    const out = queued();
    const inc = I.makeRecord({ personaId: PID, direction: 'in', status: 'received', request: true, message: { ...goldenMessage(), id: 'cccccccccccccccccccccccccc', from: P2, to: P1, createdAt: '2026-11-03T13:00:00.000Z' } });
    const [c] = I.conversations([out, inc]);
    expect(c).toMatchObject({ personaId: PID, other: P2, unread: 1, request: false, count: 2 });
    expect(c.last).toBe(inc);
    const [r] = I.conversations([inc]);
    expect(r.request).toBe(true);
  });
});

describe('the Zod schemas agree', () => {
  it('walled.garden/message and the inbox field on walled.garden/person', async () => {
    const { MessageSchema, PersonSchema, SCHEMAS } = await import('../../app/lib/schemas/walled.garden/index.ts');
    expect(SCHEMAS['walled.garden/message']).toBe(MessageSchema);
    const m = goldenMessage();
    expect(MessageSchema.safeParse(m).success).toBe(true);
    for (const bad of [{ ...m, text: '' }, { ...m, html: '<img>' }, { ...m, id: 'short' }])
      expect(MessageSchema.safeParse(bad).success).toBe(!I.messageError(bad));
    const pub = I.publicKeys(I.inboxKeys(R_SEED, crypto, [DEV, DEV2]));
    const rec = I.setMode(I.makeInbox({ personaId: PID, seed: R_SEED }, AT), 'anyone');
    const person = { type: 'walled.garden/person', title: 'A', inbox: I.publishedInbox(rec, pub) };
    expect(PersonSchema.safeParse(person).success).toBe(true);
  });
});

describe('phone notifications', () => {
  const rec = (id, at, extra = {}) =>
    I.makeRecord({ personaId: PID, direction: 'in', status: 'received', receivedAt: at, message: { ...goldenMessage(), id: id.padEnd(26, 'a') }, ...extra });
  it('shows new Contact messages after the mark, never requests or unchecked ones', () => {
    const rs = [
      rec('b', '2026-11-03T12:00:01.000Z'),
      rec('c', '2026-11-03T12:00:02.000Z', { request: true }),
      rec('d', '2026-11-03T12:00:03.000Z', { verified: false }),
      rec('e', '2026-11-03T12:00:04.000Z', { readAt: AT }),
      rec('f', '2026-11-03T12:00:05.000Z'),
    ];
    expect(I.pendingNotifications(rs, null)).toEqual({ notify: [], since: '2026-11-03T12:00:05.000Z' });
    const r = I.pendingNotifications(rs, '2026-11-03T12:00:00.000Z');
    expect(r.notify.map((x) => x.message.id[0])).toEqual(['b', 'f']);
    expect(r.since).toBe('2026-11-03T12:00:05.000Z');
    expect(I.pendingNotifications(rs, r.since).notify).toEqual([]);
  });
});
