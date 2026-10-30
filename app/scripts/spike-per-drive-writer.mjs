// Spike S1 for ADR-0029 (Shared Spaces), and ADR-0026's "Later": can a desktop write a Drive it
// didn't create, with the Vault open on the same corestore?
//
// spike-shared-local-core.mjs showed the root store's `local` core is exclusive, so a second
// Autobase on the root store can't write while the Vault holds it. ADR-0026 §1 gives the phone one
// namespace per Drive (`autobase:<keyHex>`), each with its own `local` core. This checks the same
// rule on the pinned autobase / corestore:
//
//   1. With the Vault open on the root store, open someone else's Drive in `autobase:<keyHex>`:
//      ready() returns, and its writer key is not the Vault's.
//   2. The owner appends addWriter for that key: base.writable turns true without reopening, a
//      write replicates back to the owner, and the Vault still appends.
//   3. Two such Drives open at once, each in its own namespace.
//   4. A key minted before the Drive's key is known (a Space invite, ADR-0029 §4): mint the
//      `local` core in a fresh namespace, then open the Space Library there once it's known.
//   5. For information, not the verdict: a Drive this Device already opened on the root store.
//      Its bootstrap core remembers the root `local` key (`autobase/local` user data, read by
//      autobase/lib/boot.js in any namespace), so opening it in `autobase:<key>` still waits on
//      the Vault's lock. Rotating it with base.setLocal() first opens, but the next apply asserts
//      ('has block') on autobase 7.28.1. Such Drives stay read-only here until that's solved.
//
//   cd ~/maintained/nomad/app && node scripts/spike-per-drive-writer.mjs
import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import Corestore from 'corestore';
import Autobase from 'autobase';
import Hyperbee from 'hyperbee';
import b4a from 'b4a';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-per-drive-'));
const open = (store) =>
  new Hyperbee(store.get({ name: 'db' }), { keyEncoding: 'utf-8', valueEncoding: 'json' });
const apply = async (nodes, view, host) => {
  for (const { value } of nodes) {
    if (!value) continue;
    if (value.addWriter) {
      await host.addWriter(b4a.from(value.addWriter, 'hex'), { indexer: true });
      continue;
    }
    if (value.op === 'put') await view.put(value.path, value.data);
  }
};
const OPTS = { open, apply, valueEncoding: 'json', ackInterval: 1000 };
const hex = (b) => b4a.toString(b, 'hex');
const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT:' + label)), ms))]);
const until = async (base, test, ms = 10000) => {
  const deadline = Date.now() + ms;
  await base.update();
  while (!test() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    await base.update();
  }
  return test();
};
const replicate = (a, b) => {
  const s1 = a.replicate(true);
  const s2 = b.replicate(false);
  s1.on('error', () => {});
  s2.on('error', () => {});
  s1.pipe(s2).pipe(s1);
};

const results = [];
const check = (label, ok) => {
  results.push(ok);
  console.log(`  ${ok ? '✅' : '❌'} ${label}`);
};

// The owner makes a Drive the way autobases.js createCollaborativeDrive does: its own namespace.
async function ownerDrive(store, title) {
  const base = new Autobase(store.namespace(crypto.randomBytes(32)), null, OPTS);
  await base.ready();
  await base.append({ op: 'put', path: '/index.json', data: { title } });
  await base.update();
  return base;
}

async function main() {
  console.log('\n=== S1: a per-drive writer key on a store whose Vault is open ===\n');
  const mine = new Corestore(path.join(TMP, 'member'));
  const theirs = new Corestore(path.join(TMP, 'owner'));
  await Promise.all([mine.ready(), theirs.ready()]);

  // This Device's Vault: on the root store, holding the exclusive root `local` core.
  const vault = new Autobase(mine, null, OPTS);
  await vault.ready();
  await vault.append({ op: 'put', path: '/.vault/meta.json', data: { version: 1 } });
  check('Vault open and writable on the root store', vault.writable);

  const driveA = await ownerDrive(theirs, 'A');
  const driveB = await ownerDrive(theirs, 'B');
  replicate(mine, theirs);

  // 1. Open the owner's Drive in its own namespace.
  const nsFor = (key) => mine.namespace('autobase:' + hex(key));
  const a = new Autobase(nsFor(driveA.key), driveA.key, OPTS);
  try {
    await withTimeout(a.ready(), 8000, 'ready A');
    check('opened Drive A in autobase:<key> with the Vault open (no deadlock)', true);
  } catch (e) {
    check('opened Drive A in autobase:<key>: ' + e.message, false);
    return finish(mine, theirs);
  }
  check('its writer key is not the Vault’s', !b4a.equals(a.local.key, vault.local.key));
  check('it reads the owner’s data', await until(a, () => a.view.core.length > 0));
  check('not writable before a grant', !a.writable);

  // 2. The owner grants that key.
  await driveA.append({ addWriter: hex(a.local.key) });
  await driveA.update();
  check('writable after the owner’s addWriter, without reopening', await until(a, () => a.writable));
  if (a.writable) {
    await withTimeout(a.append({ op: 'put', path: '/from-member', data: { ok: true } }), 8000, 'append A');
    const seen = await until(driveA, () => false, 1500).then(async () => (await driveA.view.get('/from-member'))?.value);
    check('the member’s write reaches the owner', !!seen?.ok);
  }
  await withTimeout(vault.append({ op: 'put', path: '/.vault/after', data: { ok: true } }), 8000, 'vault append');
  check('the Vault still appends', true);

  // 3. A second Drive at the same time, in its own namespace.
  const b = new Autobase(nsFor(driveB.key), driveB.key, OPTS);
  await withTimeout(b.ready(), 8000, 'ready B');
  await driveB.append({ addWriter: hex(b.local.key) });
  check('Drive B writable in its own namespace while A is open', await until(b, () => b.writable));
  check('A and B have different writer keys', !b4a.equals(a.local.key, b.local.key));

  // 4. Mint a key before the Space Library's key is known, then open the Library there.
  const nsName = crypto.randomBytes(32);
  const minted = Autobase.getLocalCore(mine.namespace(nsName));
  await minted.ready();
  const mintedKey = minted.key;
  await minted.close();
  const library = await ownerDrive(theirs, 'Space Library');
  await library.append({ addWriter: hex(mintedKey) }); // the owner approves the invite
  const joined = new Autobase(mine.namespace(nsName), library.key, OPTS);
  await withTimeout(joined.ready(), 8000, 'ready library');
  check('a key minted first is the one the Library opens with', b4a.equals(joined.local.key, mintedKey));
  check('and it is writable', await until(joined, () => joined.writable));

  // 5. A Drive opened on the root store before (today's desktop), reopened in its namespace.
  const legacyDrive = await ownerDrive(theirs, 'Legacy');
  const other = new Corestore(path.join(TMP, 'legacy'));
  await other.ready();
  replicate(other, theirs);
  const firstOpen = new Autobase(other.session(), legacyDrive.key, OPTS);
  await withTimeout(firstOpen.ready(), 8000, 'legacy ready');
  await until(firstOpen, () => firstOpen.view.core.length > 0);
  await firstOpen.close();
  const otherVault = new Autobase(other.session(), null, OPTS); // takes the root local core
  await otherVault.ready();
  const reopened = new Autobase(other.namespace('autobase:' + hex(legacyDrive.key)), legacyDrive.key, OPTS);
  const legacyOk = await withTimeout(reopened.ready(), 5000, 'legacy reopen').then(
    () => true,
    () => false
  );
  console.log(
    `  ℹ️  a Drive first opened on the root store ${legacyOk ? 'reopens' : 'still waits on the Vault’s lock'} in autobase:<key> (not part of the verdict)`
  );

  return finish(mine, theirs, vault, a, b, joined, driveA, driveB, library, legacyDrive, otherVault, other);
}

async function finish(...xs) {
  const ok = results.length > 0 && results.every(Boolean);
  console.log(
    ok
      ? '\n  VERDICT: per-drive namespaces work on desktop. Open Drives this Device didn’t create in autobase:<key>.'
      : '\n  VERDICT: something above failed; the per-drive writer model needs another look.'
  );
  for (const x of xs.reverse()) {
    try {
      await x.close?.();
    } catch {}
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
