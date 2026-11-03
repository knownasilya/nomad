// The Persona Inbox end to end (shared/inbox-engine.mjs, ADR-0036): two people, three Devices, real
// HyperDHT mailboxes on a local testnet, the Vault as an in-memory map per person (every Device of
// one person shares it, as they share the Vault). Deps load from app/node_modules.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import nodeCrypto from 'crypto';
import path from 'path';
import * as I from '../../shared/inbox.mjs';
import { createInboxEngine, dhtTransport } from '../../shared/inbox-engine.mjs';

const rq = createRequire(path.join(process.cwd(), 'app', 'package.json'));
let DHT, createTestnet, b4a, crypto, testnet;

const ALICE = `hyper://${'a'.repeat(64)}/`;
const BOB = `hyper://${'b'.repeat(64)}/`;
const CAROL = `hyper://${'c'.repeat(64)}/`;
const profiles = new Map(); // url -> index.json

function vault() {
  const m = new Map();
  return {
    m,
    async read(p) {
      return m.has(p) ? structuredClone(m.get(p)) : null;
    },
    async list(prefix) {
      return [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => structuredClone(v));
    },
    async listPaths(prefix) {
      return [...m.keys()].filter((k) => k.startsWith(prefix));
    },
    async put(p, v) {
      m.set(p, structuredClone(v));
    },
    async del(p) {
      m.delete(p);
    },
  };
}

const nodes = [];
async function device({ store, persona, deviceKey, deviceKeys, notes = [] }) {
  const node = new DHT({ bootstrap: testnet.bootstrap, ephemeral: true });
  await node.fullyBootstrapped();
  nodes.push(node);
  const engine = createInboxEngine({
    crypto,
    randomBytes: (n) => new Uint8Array(nodeCrypto.randomBytes(n)),
    sha256hex: (s) => nodeCrypto.createHash('sha256').update(s).digest('hex'),
    store,
    ...dhtTransport(node, DHT, b4a),
    personas: () => [{ ...persona, usable: true }],
    vaultReady: () => true,
    deviceKey: () => deviceKey,
    deviceKeys: () => deviceKeys,
    readProfile: async (url) => structuredClone(profiles.get(url) || null),
    writeProfileInbox: async (_id, inbox) => {
      const m = { ...(profiles.get(persona.profileUrl) || { type: 'walled.garden/person' }) };
      if (inbox) m.inbox = inbox;
      else delete m.inbox;
      profiles.set(persona.profileUrl, m);
      return true;
    },
    notify: (n) => notes.push(n),
  });
  engine.start();
  return { engine, node, notes };
}

const until = async (fn, ms = 20000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
};

const A = { id: 'alicepersona', label: 'Alice', profileUrl: ALICE };
const B = { id: 'bobpersona01', label: 'Bob', profileUrl: BOB };
const C = { id: 'carolpersona', label: 'Carol', profileUrl: CAROL };
const aliceVault = vault();
const bobVault = vault();
const carolVault = vault();
const ADESK = '1'.repeat(64);
const APHONE = '2'.repeat(64);
let aliceDesk, alicePhone, bob, carol;

const inbound = (store, personaId) =>
  store.list(I.messagesPrefix(personaId)).then((rs) => rs.filter((r) => r.direction === 'in'));

beforeAll(async () => {
  DHT = rq('hyperdht');
  createTestnet = rq('hyperdht/testnet');
  b4a = rq('b4a');
  crypto = I.cryptoFromSodium(rq('sodium-universal'));
  testnet = await createTestnet(8, { teardown: () => {} });
  for (const p of [A, B, C]) profiles.set(p.profileUrl, { type: 'walled.garden/person', title: p.label });
  const both = [ADESK, APHONE];
  aliceDesk = await device({ store: aliceVault, persona: A, deviceKey: ADESK, deviceKeys: both });
  alicePhone = await device({ store: aliceVault, persona: A, deviceKey: APHONE, deviceKeys: both });
  bob = await device({ store: bobVault, persona: B, deviceKey: '3'.repeat(64), deviceKeys: ['3'.repeat(64)] });
  carol = await device({ store: carolVault, persona: C, deviceKey: '4'.repeat(64), deviceKeys: ['4'.repeat(64)] });
}, 60000);

afterAll(async () => {
  for (const d of [aliceDesk, alicePhone, bob, carol]) await d?.engine.close();
  for (const n of nodes) await n.destroy();
  await testnet?.destroy();
});

describe('the Persona Inbox over a DHT testnet', () => {
  let link;

  it('turns on link-only and publishes only the sign key', async () => {
    await aliceDesk.engine.setMode(A.id, 'link');
    await alicePhone.engine.reconcile();
    const inbox = profiles.get(ALICE).inbox;
    expect(Object.keys(inbox).sort()).toEqual(['sign', 'v']);
    link = await aliceDesk.engine.linkFor(A.id);
    const parsed = I.parseMessageLink(link);
    expect(parsed.replyTo.mailboxes).toHaveLength(2); // one per Device (spike S1)
    expect(aliceDesk.engine.listening()).toEqual([A.id]);
    expect(alicePhone.engine.listening()).toEqual([A.id]);
  });

  it('a link holder lands in Requests, checked against their profile, with no notification', async () => {
    const { replyTo } = I.parseMessageLink(link);
    await bob.engine.send({ personaId: B.id, to: ALICE, text: 'Hi Alice, Bob here', replyTo });
    const [rec] = await until(async () => {
      const rs = await inbound(aliceVault, A.id);
      return rs.length && rs[0].verified !== false ? rs : null;
    });
    expect(rec).toMatchObject({ request: true, verified: true, status: 'received', sign: profiles.get(BOB).inbox.sign });
    expect(rec.message.text).toBe('Hi Alice, Bob here');
    expect(aliceDesk.notes.length + alicePhone.notes.length).toBe(0);
    const out = (await bobVault.list(I.messagesPrefix(B.id)))[0];
    await until(async () => (await bobVault.read(I.messagePath(B.id, out.message && (await convKeyOf(B, ALICE)), out.message)))?.status === 'delivered');
    const sum = await aliceDesk.engine.summary();
    expect(sum.requests).toHaveLength(1);
    expect(sum.conversations).toHaveLength(0);
  });

  it('holds a second request from the same stranger back', async () => {
    const { replyTo } = I.parseMessageLink(link);
    await bob.engine.send({ personaId: B.id, to: ALICE, text: 'Did you get it?', replyTo });
    await until(async () => (await bobVault.list(I.messagesPrefix(B.id))).every((r) => r.direction === 'in' || r.status === 'delivered'));
    expect(await inbound(aliceVault, A.id)).toHaveLength(1);
  });

  it('accepting and replying reaches Bob, who checks Alice against her profile', async () => {
    await aliceDesk.engine.accept(A.id, BOB);
    expect((await aliceDesk.engine.summary()).conversations).toHaveLength(1);
    await aliceDesk.engine.send({ personaId: A.id, to: BOB, text: 'Hey Bob!' });
    const [got] = await until(async () => {
      const rs = await inbound(bobVault, B.id);
      return rs.length && rs[0].verified !== false ? rs : null;
    });
    expect(got.message.text).toBe('Hey Bob!');
    expect(got.request).toBeUndefined();
    expect(bob.notes.map((n) => n.text)).toEqual(['Hey Bob!']);
    const contact = (await bobVault.list(I.contactsPrefix(B.id)))[0];
    expect(contact.sign).toBe(profiles.get(ALICE).inbox.sign);
  });

  it('a Contact goes straight to the inbox, and notifies', async () => {
    await bob.engine.send({ personaId: B.id, to: ALICE, text: 'Great to hear from you' });
    await until(async () => (await inbound(aliceVault, A.id)).some((r) => r.message.text === 'Great to hear from you'));
    expect([...aliceDesk.notes, ...alicePhone.notes].map((n) => n.text)).toContain('Great to hear from you');
  });

  it('the phone takes delivery when the desktop is gone', async () => {
    await aliceDesk.engine.close();
    await bob.engine.send({ personaId: B.id, to: ALICE, text: 'Desktop asleep?' });
    await until(async () => (await inbound(aliceVault, A.id)).some((r) => r.message.text === 'Desktop asleep?'));
    expect(alicePhone.notes.map((n) => n.text)).toContain('Desktop asleep?');
  });

  it('Off drops strangers, but the same ack goes back', async () => {
    // Carol learned Alice's keys somehow (an old link) while Alice is Off.
    await alicePhone.engine.setMode(A.id, 'off');
    const { replyTo } = I.parseMessageLink(link);
    await carol.engine.send({ personaId: C.id, to: ALICE, text: 'Hello?', replyTo });
    await until(async () => (await carolVault.list(I.messagesPrefix(C.id)))[0]?.status === 'delivered');
    expect((await inbound(aliceVault, A.id)).some((r) => r.message.from === CAROL)).toBe(false);
  });

  it('blocked senders are dropped on arrival', async () => {
    await alicePhone.engine.block(A.id, BOB);
    await bob.engine.send({ personaId: B.id, to: ALICE, text: 'After the block' });
    await until(async () => (await bobVault.list(I.messagesPrefix(B.id))).every((r) => r.direction === 'in' || r.status === 'delivered'));
    expect((await inbound(aliceVault, A.id)).some((r) => r.message.text === 'After the block')).toBe(false);
  });

  it('a Persona deleted takes its inbox, contacts and messages with it', async () => {
    await alicePhone.engine.forgetPersona(A.id);
    expect(await aliceVault.listPaths('/.vault/')).toEqual([]);
    expect(profiles.get(ALICE).inbox).toBeUndefined();
  });
}, 120000);

async function convKeyOf(p, other) {
  return nodeCrypto.createHash('sha256').update(I.conversationKeyInput(p.profileUrl, other)).digest('hex');
}
