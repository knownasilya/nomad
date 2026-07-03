// De-risk for the mobile paired-drive writable open (ADR-0010 Phase 5).
// QUESTION: a paired device writes to a Space drive using its ONE writer identity — the root
// corestore's exclusive `local` core (Autobase.getLocalCore(store) → store.get({name:'local',
// exclusive:true})). But the Vault is ALSO open on that same root store and holds that same
// exclusive `local`. Can a SECOND Autobase (the space drive) open on the same store while the
// first (the Vault) is open, or does it BLOCK forever on the exclusive local-core lock?
//
// If the second base readies + becomes writable → paired-drive open on the root store is viable.
// If it hangs → the naive approach deadlocks and we need a different writer model.
//
//   cd ~/maintained/nomad/app && node scripts/spike-shared-local-core.mjs
import os from 'os';
import path from 'path';
import fs from 'fs';
import Corestore from 'corestore';
import Autobase from 'autobase';
import Hyperbee from 'hyperbee';
import b4a from 'b4a';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-local-'));
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
const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT:' + label)), ms)),
  ]);

async function main() {
  console.log('\n=== two Autobases sharing one root corestore (Vault + space drive) ===\n');
  const store = new Corestore(path.join(TMP, 'root'));
  await store.ready();

  // Base A = the "Vault": created on the root store, becomes writable, stays open.
  const vault = new Autobase(store, null, OPTS);
  await vault.ready();
  await vault.append({ op: 'put', path: '/meta', data: { v: 1 } });
  await vault.update();
  console.log(
    '  Vault ready + writable:',
    vault.writable,
    '| local key',
    b4a.toString(vault.local.key, 'hex').slice(0, 8)
  );

  // A separate device/store creates a "space drive" and adds our root local key as a writer,
  // so opening it on our root store SHOULD be writable via the shared local core.
  const other = new Corestore(path.join(TMP, 'other'));
  await other.ready();
  const space = new Autobase(other, null, OPTS);
  await space.ready();
  await space.append({ op: 'put', path: '/index.json', data: { title: 'space' } });
  await space.append({ addWriter: b4a.toString(vault.local.key, 'hex') }); // add our device as a writer
  await space.update();
  const spaceKey = space.key;

  // replicate so our root store can load the space drive
  const s1 = store.replicate(true),
    s2 = other.replicate(false);
  s1.on('error', () => {});
  s2.on('error', () => {});
  s1.pipe(s2).pipe(s1);

  // THE TEST: open the space drive on OUR ROOT STORE while the Vault is still open on it.
  console.log('\n  opening the space drive on the SAME root store (Vault still open)…');
  let secondBase;
  try {
    secondBase = new Autobase(store, spaceKey, OPTS);
    await withTimeout(secondBase.ready(), 8000, 'second-ready');
    console.log('  ✅ second base ready() returned (no exclusive-local deadlock)');
  } catch (e) {
    console.log('  ❌ second base ready() FAILED:', e.message);
    console.log(
      '\n  VERDICT: opening a space drive on the root store DEADLOCKS/errs while the Vault is'
    );
    console.log(
      '  open — the shared exclusive `local` core blocks. Paired-drive writable open needs a'
    );
    console.log('  different writer model (per-drive device key, or a Vault-mediated writer).');
    await cleanup(store, other, vault, space);
    process.exit(1);
  }

  // Does it become writable (our root local key was added as a writer)?
  const writable = await (async () => {
    const deadline = Date.now() + 8000;
    await secondBase.update();
    while (!secondBase.writable && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      await secondBase.update();
    }
    return secondBase.writable;
  })();
  console.log('  second base writable via shared local core:', writable);

  if (writable) {
    // and can BOTH still append without corrupting each other's local core?
    try {
      await withTimeout(
        secondBase.append({ op: 'put', path: '/from-device', data: { ok: true } }),
        8000,
        'second-append'
      );
      await secondBase.update();
      await withTimeout(
        vault.append({ op: 'put', path: '/vault-2', data: { ok: true } }),
        8000,
        'vault-append'
      );
      await vault.update();
      console.log('  ✅ both bases append on the shared local core without deadlock');
      console.log(
        '\n  VERDICT: paired-drive writable open on the root store WORKS — implement it.'
      );
    } catch (e) {
      console.log('  ❌ concurrent append failed:', e.message);
      console.log(
        '\n  VERDICT: bases open but can’t both append on the shared local core — NOT viable.'
      );
    }
  } else {
    console.log(
      '\n  VERDICT: second base opens but never becomes writable — the shared-local-core writer'
    );
    console.log('  identity is not honored this way; needs a different model.');
  }

  await cleanup(store, other, vault, space, secondBase);
  process.exit(writable ? 0 : 1);
}

async function cleanup(...xs) {
  for (const x of xs) {
    try {
      await x.close?.();
    } catch {}
  }
  fs.rmSync(TMP, { recursive: true, force: true });
}

main().catch((e) => {
  console.error('\nSPIKE CRASHED:', e.stack || e);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(2);
});
