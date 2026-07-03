// Spike for ADR-0010 (unify the filesystem on Autobase behind beaker.fs).
// THROWAWAY — not wired into the app. Validates the load-bearing unknowns:
//
//   1. Blob design (option b): a writer puts file bytes into its OWN Hyperblobs core
//      OUTSIDE apply; the Autobase op carries only a pointer { core, id }; apply records
//      an idempotent { metadata, blob } into the view. (The replay-safe shape.)
//   2. Cross-writer resolve ONLINE: a second device reads + range-reads the first
//      device's blob through the shared corestore replication.
//   3. Cross-writer resolve OFFLINE-BUT-REPLICATED: after the reader has downloaded the
//      blob, cut replication and confirm it still serves from local cache.
//   4. Availability model: a blob the reader never downloaded is unreadable while the
//      owner is offline (confirms the honest failure mode).
//   5. Replay-safety / convergence: partition two writers, append concurrently, heal,
//      and confirm Autobase re-runs apply on reorg WITHOUT corrupting the view — both
//      devices converge to identical state and every blob pointer still resolves.
//
// Run from the app dir so deps resolve (autobase/corestore/hyperblobs live in app/node_modules):
//   cd ~/maintained/nomad/app && node scripts/spike-autobase-fs.mjs [blobMB=50]
//
// Exit code 0 = all phases passed; 1 = a phase failed (you're on the hybrid-backend
// fallback / option-2 branch of the ADR).

import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import Corestore from 'corestore';
import Autobase from 'autobase';
import Hyperbee from 'hyperbee';
import Hyperblobs from 'hyperblobs';

const BLOB_MB = Number(process.argv[2] || 50);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-fs-'));
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function log(msg) {
  console.log(msg);
}
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
async function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`timeout:${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(t);
  }
}
async function waitFor(fn, ms = 15000, every = 150) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(every);
  }
  return false;
}

// --- The PROPOSED beaker.fs view + reducer ------------------------------------
// View = a Hyperbee of path -> { metadata, blob }. apply is a PURE, REPLAY-SAFE reducer:
// keyed puts only, NO blob writes, NO core opening (per the Autobase "mutate only the
// view / side effects belong outside the linearization path" rule).
function open(store) {
  return new Hyperbee(store.get({ name: 'db' }), { keyEncoding: 'utf-8', valueEncoding: 'json' });
}
async function apply(nodes, view, host) {
  for (const { value } of nodes) {
    if (!value) continue;
    if (value.addWriter) {
      await host.addWriter(Buffer.from(value.addWriter, 'hex'), { indexer: true });
      continue;
    }
    if (value.op === 'put') {
      await view.put(value.path, value.record);
      continue;
    }
    if (value.op === 'del') {
      await view.del(value.path);
      continue;
    }
  }
}

// --- A "device": its own corestore, autobase, and Hyperblobs content core -----
async function makeDevice(name, bootstrapKey = null) {
  const store = new Corestore(path.join(TMP, name));
  await store.ready();
  const base = new Autobase(store, bootstrapKey, {
    open,
    apply,
    valueEncoding: 'json',
    ackInterval: 1000,
  });
  await base.ready();
  const blobs = new Hyperblobs(store.get({ name: 'blobs' })); // this device's OWN content store
  await blobs.ready();
  return { name, store, base, blobs };
}

// Connect two devices' corestores; returns a disconnect() that partitions them.
function connect(a, b) {
  const s1 = a.store.replicate(true);
  const s2 = b.store.replicate(false);
  s1.on('error', () => {});
  s2.on('error', () => {});
  s1.pipe(s2).pipe(s1);
  return () => {
    s1.destroy();
    s2.destroy();
  };
}

// Writer-side: put bytes into MY OWN blobs core (outside apply), return a pointer.
async function putFile(dev, buf, meta = {}) {
  const id = await dev.blobs.put(buf);
  return {
    metadata: { mtime: meta.mtime ?? 1, ctime: meta.ctime ?? 1, size: buf.length },
    blob: { core: dev.blobs.key.toString('hex'), id },
  };
}
// Reader-side: resolve a pointer through MY store (fetches the owner's core over replication).
async function getFile(dev, pointer, range) {
  const core = dev.store.get({ key: Buffer.from(pointer.blob.core, 'hex') });
  await core.ready();
  const blobs = new Hyperblobs(core);
  return range ? blobs.get(pointer.blob.id, range) : blobs.get(pointer.blob.id);
}
async function readRecord(dev, p) {
  const n = await dev.base.view.get(p);
  return n && n.value;
}
async function dumpView(dev) {
  const out = [];
  for await (const e of dev.base.view.createReadStream())
    out.push(`${e.key}=${JSON.stringify(e.value)}`);
  return out.sort().join('\n');
}

async function main() {
  console.log(`\n=== ADR-0010 spike — ${BLOB_MB}MB blob — tmp ${TMP} ===\n`);

  // Build a deterministic blob and its hash up front.
  const big = Buffer.allocUnsafe(BLOB_MB * 1024 * 1024);
  for (let i = 0; i < big.length; i++) big[i] = i & 255;
  const bigHash = sha(big);

  // ---- Setup: A (bootstrap writer) + B (second writer) --------------------
  log('PHASE 0 — pair two writers');
  const A = await makeDevice('A');
  await A.base.append({
    op: 'put',
    path: '/index.json',
    record: { metadata: { mtime: 1, ctime: 1 }, blob: null },
  });
  await A.base.update();
  const B = await makeDevice('B', A.base.key); // bootstrap on A's key
  let disconnect = connect(A, B);
  await waitFor(async () => {
    await B.base.update();
    return !!(await readRecord(B, '/index.json'));
  }, 15000);
  // A grants B writer access; B becomes writable once it linearizes the addWriter op.
  await A.base.append({ addWriter: B.base.local.key.toString('hex') });
  await A.base.update();
  const bWritable = await waitFor(async () => {
    await A.base.update();
    await B.base.update();
    return B.base.writable;
  }, 20000);
  check("B becomes a writer of A's base", bWritable);
  check("B replicated A's /index.json", !!(await readRecord(B, '/index.json')));

  // ---- PHASE 1 + 2: blob via pointer, cross-writer resolve ONLINE ---------
  log(`\nPHASE 1/2 — A stores a ${BLOB_MB}MB blob (outside apply); B resolves the pointer online`);
  const ptr = await putFile(A, big, { mtime: 2, ctime: 2 });
  await A.base.append({ op: 'put', path: '/big.bin', record: ptr });
  await A.base.update();
  const gotPtr = await waitFor(async () => {
    await B.base.update();
    return !!(await readRecord(B, '/big.bin'));
  }, 15000);
  check('B sees the /big.bin pointer in the view', gotPtr);
  const recB = await readRecord(B, '/big.bin');
  check(
    'pointer carries { core, id } (no inline bytes)',
    !!(recB?.blob?.core && recB?.blob?.id && recB.blob.id.byteLength === big.length)
  );
  const full = await withTimeout(getFile(B, recB), 60000, 'online-full').catch((e) => e);
  check(
    "B reads A's full blob, bytes match",
    Buffer.isBuffer(full) && sha(full) === bigHash,
    Buffer.isBuffer(full) ? '' : String(full.message || full)
  );
  const mid = await withTimeout(
    getFile(B, recB, { start: 1_000_000, length: 65536 }),
    30000,
    'online-range'
  ).catch((e) => e);
  check(
    'B range-reads [1MB, +64KB), bytes match',
    Buffer.isBuffer(mid) && Buffer.compare(mid, big.subarray(1_000_000, 1_000_000 + 65536)) === 0
  );

  // ---- PHASE 3: OFFLINE but already replicated ---------------------------
  log('\nPHASE 3 — cut replication; B must still serve the blob it already downloaded');
  disconnect(); // A goes offline
  await sleep(300);
  const offline = await withTimeout(
    getFile(B, recB, { start: 0, length: 131072 }),
    8000,
    'offline-cached'
  ).catch((e) => e);
  check(
    'B serves cached blob with A offline',
    Buffer.isBuffer(offline) && Buffer.compare(offline, big.subarray(0, 131072)) === 0,
    Buffer.isBuffer(offline) ? '' : String(offline.message || offline)
  );

  // ---- PHASE 4: never-downloaded blob while owner offline = unavailable ---
  log('\nPHASE 4 — a blob B never downloaded is unreadable while A is offline (honest failure)');
  // A writes a second blob while still partitioned; B has never seen its bytes.
  const small = Buffer.from('secret-' + 'x'.repeat(50000));
  const ptr2 = await putFile(A, small);
  await A.base.append({ op: 'put', path: '/unseen.bin', record: ptr2 });
  await A.base.update();
  const unreadable = await withTimeout(
    getFile(B, ptr2, { start: 0, length: 16 }),
    4000,
    'unavailable'
  )
    .then(() => false)
    .catch(() => true);
  check('unseen blob correctly unavailable while A offline', unreadable);

  // ---- PHASE 5: partition → concurrent writes → heal → reorg convergence --
  log(
    '\nPHASE 5 — replay-safety: concurrent writes across a partition must converge (apply re-runs on reorg)'
  );
  // Reconnect and fully sync first so both share a causal base.
  disconnect = connect(A, B);
  await waitFor(async () => {
    await A.base.update();
    await B.base.update();
    return !!(await readRecord(B, '/unseen.bin'));
  }, 15000);
  // Partition, then BOTH append concurrently (causally independent ops → forces a reorder).
  disconnect();
  await sleep(300);
  const aFile = await putFile(A, Buffer.from('A'.repeat(20000)));
  const bFile = await putFile(B, Buffer.from('B'.repeat(20000)));
  await A.base.append({ op: 'put', path: '/from-a.txt', record: aFile });
  await B.base.append({ op: 'put', path: '/from-b.txt', record: bFile });
  await A.base.update();
  await B.base.update();
  // Heal the partition; both linearize the merged history (apply re-runs on the reorg).
  disconnect = connect(A, B);
  const converged = await waitFor(async () => {
    await A.base.update();
    await B.base.update();
    const da = await dumpView(A),
      db = await dumpView(B);
    return da === db && da.includes('/from-a.txt') && da.includes('/from-b.txt');
  }, 25000);
  check('both writers converge to identical view after reorg', converged);
  // And every pointer still resolves cross-writer after the merge.
  const recAB = await readRecord(B, '/from-a.txt'); // B resolves A's blob
  const recBA = await readRecord(A, '/from-b.txt'); // A resolves B's blob
  const crossB = await withTimeout(getFile(B, recAB), 15000, 'x-a').catch((e) => e);
  const crossA = await withTimeout(getFile(A, recBA), 15000, 'x-b').catch((e) => e);
  check(
    'post-reorg pointers still resolve both directions',
    Buffer.isBuffer(crossB) &&
      crossB.length === 20000 &&
      Buffer.isBuffer(crossA) &&
      crossA.length === 20000
  );

  disconnect();
  await Promise.all([A.base.close(), B.base.close()]);
}

main()
  .then(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
    if (failed.length) console.log('FAILED:', failed.map((r) => r.name).join(' | '));
    console.log(
      'Verdict:',
      failed.length
        ? 'option-2 (hybrid backend) — Autobase-only blob model not proven'
        : 'Autobase-only model VALIDATED — proceed with ADR-0010 option (b)'
    );
    fs.rmSync(TMP, { recursive: true, force: true });
    process.exit(failed.length ? 1 : 0);
  })
  .catch((e) => {
    console.error('\nSPIKE CRASHED:', e.stack || e);
    fs.rmSync(TMP, { recursive: true, force: true });
    process.exit(2);
  });
