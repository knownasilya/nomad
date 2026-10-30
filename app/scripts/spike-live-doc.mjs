// Spike for ADR-0025 (Live Docs: a Yjs document stored as per-writer update files in its Drive).
// THROWAWAY — not wired into the app. Two Writers on the REAL shared/fs-core.mjs reducer,
// in-process, replicating over a corestore stream pair that can add a one-way delay to stand in
// for the network. Answers the ADR's open questions:
//
//   Q1  Durable-path latency (B writes an update file → A's view has it) at 0 / 25 / 75 ms one-way,
//       next to the live path (one Protomux message on the same pipe); and storage after a long
//       typing session by two people (oplogs, view, blobs; logical bytes and on disk).
//   Q2  Open cost: list + read + Y.mergeUpdates + apply with 10,000 update files, warm and cold,
//       then the same after one compaction batch. Plus compaction correctness: two Writers
//       compacting at once while partitioned, with a new edit landing during it.
//   Q3  Writer proof: the base's `local` keypair signs (nonce ‖ handshakeHash); membership is
//       `base.system.get(key)` and not removed; a removed Writer fails it.
//   Q4  Inline (`value`) vs blob update files, for both of the above. Snapshots are always blobs.
//
// Run from the app dir so deps resolve (autobase/corestore/hyperbee/hyperblobs in app/node_modules).
// Yjs isn't an app dependency yet, so add it without saving first:
//   cd ~/maintained/nomad/app && npm i --no-save yjs@13 && node scripts/spike-live-doc.mjs
// --batches=N sets the update files per Writer (default 5000 → 10,000 files, ~7 min);
// --samples=N the latency samples per delay (default 60).
// Exit 0 = all checks passed; 1 = a check failed. Numbers are printed for the ADR.

import os from 'os';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import Corestore from 'corestore';
import Autobase from 'autobase';
import Hyperbee from 'hyperbee';
import Hyperblobs from 'hyperblobs';
import Protomux from 'protomux';
import c from 'compact-encoding';
import crypto from 'hypercore-crypto';
import b4a from 'b4a';
import * as Y from 'yjs';
import {
  createFsCore,
  createBlobStore,
  createContentReader,
  makeMetadata,
  AUTOBASE_OPTS,
  BLOBS_CORE_NAME,
} from '../../shared/fs-core.mjs';

const arg = (name, dflt) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : dflt;
};
const BATCHES = arg('batches', 5000); // per Writer; 2 Writers → 2×BATCHES update files
const CHARS_PER_BATCH = 3.5; // ~40 wpm, one batch per second of typing
const LATENCY_SAMPLES = arg('samples', 60);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-live-doc-'));
const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`  ${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const hex = (b) => b4a.toString(b, 'hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmtMs = (x) => `${x.toFixed(1)} ms`;
const fmtB = (n) =>
  n > 1e6 ? `${(n / 1e6).toFixed(2)} MB` : n > 1e3 ? `${(n / 1e3).toFixed(1)} KB` : `${n} B`;
const du = (dir) => Number(execSync(`du -sb ${dir}`).toString().split('\t')[0]);

// --- A Drive and its Writers, mirroring app/bg/hyper/autobases.js ------------

const fsCore = createFsCore({ Hyperbee, b4a });
const blobStore = createBlobStore({ Hyperblobs, b4a });
const reader = createContentReader({ Hyperblobs, b4a });

async function openWriter(dir, key = null) {
  const store = new Corestore(path.join(TMP, dir));
  // The creator gets its own namespace (createCollaborativeDrive); a loader uses the root store.
  const baseStore = key ? store : store.namespace(dir);
  const base = new Autobase(baseStore, key, { ...AUTOBASE_OPTS, open: fsCore.open, apply: fsCore.apply });
  await base.ready();
  const w = { dir, store, base, blobs: null };
  return w;
}
function blobsFor(w) {
  if (!w.blobs) {
    const ns = w.store.namespace(hex(w.base.local.key));
    w.blobs = new Hyperblobs(ns.get({ name: BLOBS_CORE_NAME }));
  }
  return w.blobs;
}

async function makeDrive(tag) {
  const A = await openWriter(`${tag}-a`);
  const B = await openWriter(`${tag}-b`, A.base.key);
  const link = connect(A, B);
  await A.base.append({ addWriter: hex(B.base.local.key) });
  await A.base.update();
  await until(async () => (await B.base.update(), B.base.writable), 'B becomes writable');
  return { A, B, link };
}

// Replicate two Writers' stores. `delay` is a one-way delay per chunk, in order (setTimeout FIFO).
function connect(a, b, delay = 0) {
  const s1 = a.store.replicate(true);
  const s2 = b.store.replicate(false);
  s1.on('error', () => {});
  s2.on('error', () => {});
  const link = { s1, s2, delay };
  s1.on('data', (d) => (link.delay ? setTimeout(() => s2.write(d), link.delay) : s2.write(d)));
  s2.on('data', (d) => (link.delay ? setTimeout(() => s1.write(d), link.delay) : s1.write(d)));
  link.close = () => {
    s1.destroy();
    s2.destroy();
  };
  return link;
}

async function until(fn, what, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(5);
  }
  throw new Error(`timed out waiting for: ${what}`);
}

// --- The Live Doc layout (ADR-0025 §1) ---------------------------------------

const DOC = '/pages/spike';
let seq = 0;
const updatePath = (w) =>
  `${DOC}/updates/${hex(w.base.local.key)}/${Date.now()}-${(seq++).toString(36)}.yupdate`;

async function buildPut(w, p, bytes, mode) {
  const metadata = makeMetadata({ mtime: Date.now(), ctime: Date.now() });
  if (mode === 'inline') return { op: 'put', path: p, metadata, value: b4a.toString(bytes, 'base64') };
  return { op: 'put', path: p, metadata, blob: await blobStore.putBlob(blobsFor(w), bytes) };
}
// One nomad.fs-style write: append + update().
async function writeFile(w, p, bytes, mode) {
  await w.base.append(await buildPut(w, p, bytes, mode));
  await w.base.update();
}

async function listDoc(w) {
  const out = [];
  for await (const node of w.base.view.createReadStream({ gte: `${DOC}/`, lt: `${DOC}/\xff` })) {
    if (node.key.includes('/updates/') || node.key.includes('/snapshots/')) out.push(node);
  }
  return out;
}
function treeMerge(updates, n = 64) {
  while (updates.length > 1) {
    const next = [];
    for (let i = 0; i < updates.length; i += n) next.push(Y.mergeUpdates(updates.slice(i, i + n)));
    updates = next;
  }
  return updates[0];
}
async function readDoc(w) {
  const nodes = await listDoc(w);
  const parts = await Promise.all(nodes.map((n) => reader.readContent(n.value, { store: w.store })));
  // Merge in a tree of 64-file chunks, then apply once. The files come back in key order (one
  // Writer's, then the next's), not causal order, and each Writer's updates depend on the others':
  // applying them one by one parks most in Yjs's pending queue and goes quadratic (16 s for 10k),
  // and one Y.mergeUpdates over all of them is superlinear (~2 s). The tree is ~80 ms in any order.
  // Compaction snapshots this doc built only from files, never the live in-memory doc.
  const doc = new Y.Doc();
  if (parts.length) Y.applyUpdate(doc, treeMerge(parts.map((p) => new Uint8Array(p))));
  const merged = Y.encodeStateAsUpdate(doc);
  return { text: doc.getText('t').toString(), files: nodes.length, nodes, merged };
}

// Compaction (§6): one batch, snapshot first, then the deletes of exactly what was read.
// Snapshots are blobs: they are large and should stay out of the oplog.
async function compact(w) {
  const { nodes, merged } = await readDoc(w);
  const snap = `${DOC}/snapshots/${hex(w.base.local.key)}-${Date.now()}.ystate`;
  const ops = [await buildPut(w, snap, b4a.from(merged), 'blob'), ...nodes.map((n) => ({ op: 'del', path: n.key }))];
  await w.base.append(ops);
  await w.base.update();
  return { deleted: nodes.length, snapshotBytes: merged.byteLength };
}

// --- Typing simulation: each Writer edits its own Y.Doc, synced live with the other -------

function makeTypist(name, rand) {
  const doc = new Y.Doc();
  const text = doc.getText('t');
  let pending = [];
  let cursor = 0;
  doc.on('update', (u, origin) => {
    if (origin !== 'remote') pending.push(u);
  });
  let carry = 0;
  return {
    doc,
    text,
    // One second of typing: ~3.5 characters, about 1 in 10 a backspace; now and then move the cursor.
    typeOneSecond() {
      carry += CHARS_PER_BATCH;
      const n = Math.floor(carry);
      carry -= n;
      if (rand() < 0.05) cursor = Math.floor(rand() * (text.length + 1));
      cursor = Math.min(cursor, text.length);
      for (let i = 0; i < n; i++) {
        if (rand() < 0.1 && cursor > 0) {
          text.delete(cursor - 1, 1);
          cursor--;
        } else {
          text.insert(cursor, rand() < 0.15 ? ' ' : String.fromCharCode(97 + Math.floor(rand() * 26)));
          cursor++;
        }
      }
      const out = pending.length ? Y.mergeUpdates(pending) : null;
      pending = [];
      return out;
    },
    receive(u) {
      Y.applyUpdate(doc, u, 'remote');
    },
  };
}
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function coreBytes(core) {
  await core.ready();
  return core.byteLength || 0;
}
async function storageOf(w, other) {
  const oplogA = await coreBytes(w.base.local);
  const oplogB = await coreBytes(w.store.get({ key: other.base.local.key }));
  const view = await coreBytes(w.base.view.core);
  const system = await coreBytes(w.base.core);
  let blobs = 0;
  for (const x of [w, other]) {
    if (!x.blobs) continue; // inline mode never opened a blobs core
    await x.blobs.core.ready();
    blobs += await coreBytes(w.store.get({ key: x.blobs.core.key }));
  }
  return { oplogs: oplogA + oplogB, view, system, blobs, total: oplogA + oplogB + view + system + blobs };
}

// --- Q1a: latency, durable path vs live path ---------------------------------

async function latency(mode) {
  console.log(`\nQ1a/Q4 — durable-path latency, ${mode} update files (${LATENCY_SAMPLES} samples per delay)`);
  const { A, B, link } = await makeDrive(`lat-${mode}`);
  const rows = [];
  for (const delay of [0, 25, 75]) {
    link.delay = delay;
    await sleep(300);
    const samples = [];
    for (let i = 0; i < LATENCY_SAMPLES; i++) {
      const p = updatePath(B);
      const bytes = b4a.from(crypto.randomBytes(120)); // a typical 1 s batch is ~50–150 bytes
      const t0 = performance.now();
      await writeFile(B, p, bytes, mode);
      await until(async () => {
        const node = await A.base.view.get(p);
        if (!node) return false;
        const got = await reader.readContent(node.value, { store: A.store });
        return got && got.length === bytes.length;
      }, `A sees ${p}`);
      samples.push(performance.now() - t0);
    }
    // Live path: one Protomux message on the same (delayed) pipe.
    const live = await livePathLatency(link);
    rows.push({ delay, p50: pct(samples, 50), p95: pct(samples, 95), live });
    console.log(
      `  one-way ${String(delay).padStart(2)} ms: durable p50 ${fmtMs(pct(samples, 50))}, p95 ${fmtMs(pct(samples, 95))}` +
        ` | live message p50 ${fmtMs(live)}`
    );
  }
  link.close();
  await A.base.close();
  await B.base.close();
  return rows;
}

let liveChannelId = 0;
async function livePathLatency(link) {
  const id = b4a.from(`live-${liveChannelId++}`);
  // corestore.replicate() wraps the Noise stream; its Protomux lives on noiseStream (a swarm
  // connection IS the Noise stream, which is why peersockets.ts can call Protomux.from(conn)).
  const m1 = Protomux.from(link.s1.noiseStream);
  const m2 = Protomux.from(link.s2.noiseStream);
  let resolveMsg;
  const c1 = m1.createChannel({ protocol: 'spike/live-doc', id, messages: [{ encoding: c.buffer }] });
  const c2 = m2.createChannel({
    protocol: 'spike/live-doc',
    id,
    messages: [{ encoding: c.buffer, onmessage: () => resolveMsg && resolveMsg() }],
  });
  c1.open();
  c2.open();
  await new Promise((r) => {
    const t = setInterval(() => {
      if (c1.opened && c2.opened) {
        clearInterval(t);
        r();
      }
    }, 5);
  });
  const samples = [];
  for (let i = 0; i < 20; i++) {
    const got = new Promise((r) => (resolveMsg = r));
    const t0 = performance.now();
    c1.messages[0].send(b4a.from(crypto.randomBytes(120)));
    await got;
    samples.push(performance.now() - t0);
  }
  c1.close();
  c2.close();
  return pct(samples, 50);
}

// --- Q1b + Q2: a long session, storage, open cost, compaction ----------------

async function session(mode) {
  const files = BATCHES * 2;
  console.log(`\nQ1b/Q2/Q4 — ${files} ${mode} update files (two Writers × ${BATCHES} s of continuous typing)`);
  const { A, B, link } = await makeDrive(`sess-${mode}`);
  const ta = makeTypist('A', mulberry32(1));
  const tb = makeTypist('B', mulberry32(2));
  let raw = 0;
  const t0 = performance.now();
  for (let i = 0; i < BATCHES; i++) {
    for (const [w, me, them] of [
      [A, ta, tb],
      [B, tb, ta],
    ]) {
      const u = me.typeOneSecond();
      if (!u) continue;
      them.receive(u); // the live path
      raw += u.byteLength;
      await writeFile(w, updatePath(w), b4a.from(u), mode);
    }
  }
  const writeMs = performance.now() - t0;
  await until(async () => (await A.base.update(), (await listDoc(A)).length === files), 'A has every file', 120000);
  await until(async () => (await B.base.update(), (await listDoc(B)).length === files), 'B has every file', 120000);
  const expected = ta.text.toString();
  check(`${mode}: both Writers' live docs agree`, expected === tb.text.toString());
  console.log(
    `  wrote ${files} files in ${(writeMs / 1000).toFixed(1)} s (${fmtMs(writeMs / files)} per write); ` +
      `doc is ${expected.length} chars; Yjs update bytes ${fmtB(raw)} (avg ${(raw / files).toFixed(0)} B/file)`
  );

  // Q2 warm open
  let t = performance.now();
  let r = await readDoc(A);
  const warm = performance.now() - t;
  check(`${mode}: merging the files gives the live text`, r.text === expected, `${r.files} files`);

  const st = await storageOf(A, B);
  const perHour = (n) => fmtB(Math.round((n / BATCHES) * 3600));
  console.log(
    `  storage on A: oplogs ${fmtB(st.oplogs)}, view ${fmtB(st.view)}, system ${fmtB(st.system)}, blobs ${fmtB(st.blobs)}` +
      ` = ${fmtB(st.total)} (≈ ${perHour(st.total)} per hour of two people typing)`
  );

  // Q2 cold open: close A, reopen from disk with the root store, as loadCollaborativeDrive does.
  link.close();
  await A.base.close();
  await A.store.close();
  const diskA = du(path.join(TMP, A.dir));
  t = performance.now();
  const A2 = await openWriter(A.dir, B.base.key);
  await A2.base.update();
  const reopen = performance.now() - t;
  r = await readDoc(A2);
  const cold = performance.now() - t;
  check(`${mode}: cold reopen reads the same text`, r.text === expected);
  console.log(
    `  read+merge warm ${fmtMs(warm)}; cold ${fmtMs(cold)} (of which reopening the Drive ${fmtMs(reopen)}); A on disk ${fmtB(diskA)}`
  );

  // Compaction by A2, then open cost with one snapshot.
  const link2 = connect(A2, B);
  t = performance.now();
  const comp = await compact(A2);
  const compMs = performance.now() - t;
  t = performance.now();
  r = await readDoc(A2);
  const after = performance.now() - t;
  check(`${mode}: after compaction one snapshot gives the same text`, r.text === expected && r.files === 1);
  await until(async () => (await B.base.update(), (await listDoc(B)).length === 1), 'B sees compaction', 60000);
  const rb = await readDoc(B);
  check(`${mode}: B converges on the compacted doc`, rb.text === expected);
  const st2 = await storageOf(A2, B);
  console.log(
    `  compaction: ${comp.deleted} deletes + 1 snapshot (${fmtB(comp.snapshotBytes)}) in one batch, ${fmtMs(compMs)}; ` +
      `read+merge after: ${fmtMs(after)}; storage on A ${fmtB(st.total)} → ${fmtB(st2.total)}`
  );
  link2.close();
  await A2.base.close();
  await B.base.close();
  return { files, raw, writeMs, warm, reopen, cold, compMs, after, storage: st, storageAfter: st2, diskA, chars: expected.length, snapshot: comp.snapshotBytes };
}

// --- Q2b: concurrent compaction under a partition ----------------------------

async function concurrentCompaction() {
  console.log('\nQ2b — two Writers compact at once while partitioned, and a new edit lands during it');
  const { A, B, link } = await makeDrive('conc');
  const ta = makeTypist('A', mulberry32(3));
  const tb = makeTypist('B', mulberry32(4));
  for (let i = 0; i < 200; i++) {
    for (const [w, me, them] of [
      [A, ta, tb],
      [B, tb, ta],
    ]) {
      const u = me.typeOneSecond();
      if (!u) continue;
      them.receive(u);
      await writeFile(w, updatePath(w), b4a.from(u), 'inline');
    }
  }
  await until(async () => (await A.base.update(), (await listDoc(A)).length === 400), 'A has 400');
  await until(async () => (await B.base.update(), (await listDoc(B)).length === 400), 'B has 400');
  link.close();
  await sleep(500); // let in-flight replication drain so the partition is real

  // Partitioned: both compact; A also keeps typing (the edit B's compaction can't know about).
  await compact(A);
  const late = ta.typeOneSecond() || ta.typeOneSecond();
  tb.receive(late);
  await writeFile(A, updatePath(A), b4a.from(late), 'inline');
  await B.base.update();
  const bBefore = await listDoc(B);
  check('B is really partitioned (sees none of A\'s compaction)', bBefore.length === 400 && !bBefore.some((n) => n.key.includes('/snapshots/')));
  await compact(B);

  const link2 = connect(A, B);
  const expected = ta.text.toString();
  await until(async () => {
    await A.base.update();
    await B.base.update();
    const [ra, rb] = [await readDoc(A), await readDoc(B)];
    // Text alone converges as soon as A's snapshot lands; wait for B's batch to reach A as well.
    const same = ra.nodes.map((n) => n.key).join() === rb.nodes.map((n) => n.key).join();
    return ra.text === expected && rb.text === expected && same && ra.files === 3;
  }, 'both converge after the partition heals');
  const ra = await readDoc(A);
  check('concurrent compactions + a late edit converge with nothing lost', ra.text === expected, `${ra.files} files remain (2 snapshots + 1 update)`);
  check('the set left is exactly two snapshots and the late update', ra.files === 3, ra.nodes.map((n) => n.key.split('/').slice(3).join('/').slice(0, 24)).join(', '));
  link2.close();
  await A.base.close();
  await B.base.close();
}

// --- Q3: the Writer proof -----------------------------------------------------

async function writerProof() {
  console.log('\nQ3 — Writer proof over the replication connection');
  const { A, B, link } = await makeDrive('proof');
  const C = await openWriter('proof-c', A.base.key); // a reader, never added

  // Both ends of a Noise stream share a handshake hash; binding the signature to it stops a relay.
  const hA = link.s1.noiseStream.handshakeHash;
  const hB = link.s2.noiseStream.handshakeHash;
  check('both ends see the same handshakeHash', !!hA && b4a.equals(hA, hB));

  check("B's base exposes its writer keypair", !!(B.base.local.keyPair && B.base.local.keyPair.secretKey));
  const nonce = crypto.randomBytes(32);
  const msg = b4a.concat([nonce, hB]);
  const sig = crypto.sign(msg, B.base.local.keyPair.secretKey);
  const claimed = B.base.local.key;

  async function isCurrentWriter(base, key) {
    if (b4a.equals(key, base.key)) return true; // the creator (bootstrap) is a Writer from birth
    const info = await base.system.get(key);
    return !!info && !info.isRemoved;
  }
  // The writer key is a manifest hash, not the ed25519 public key that signs (hypercore 11). The
  // verifier opens the writer core and checks against its manifest signer, as ai-bridge.js does.
  check('the writer key is not the signing key', !b4a.equals(claimed, B.base.local.keyPair.publicKey));
  const core = A.store.get({ key: claimed });
  await core.ready();
  const signer = core.manifest && core.manifest.signers && core.manifest.signers[0].publicKey;
  check('A finds B\'s signer in the writer core\'s manifest', !!signer && b4a.equals(signer, B.base.local.keyPair.publicKey));
  check('A verifies B\'s signature over nonce‖handshakeHash', crypto.verify(msg, sig, signer));
  check('A finds B in the writer set', await isCurrentWriter(A.base, claimed));
  check('the creator counts as a Writer', await isCurrentWriter(A.base, A.base.local.key));
  check('a signature over another connection\'s hash fails', !crypto.verify(b4a.concat([nonce, crypto.randomBytes(32)]), sig, signer));
  await C.base.update();
  check('a reader that was never added is not a Writer', !(await isCurrentWriter(A.base, C.base.local.key)));

  await A.base.append({ removeWriter: hex(B.base.local.key) });
  await A.base.update();
  check('after removeWriter, B is no longer a Writer', !(await isCurrentWriter(A.base, claimed)));
  link.close();
  await A.base.close();
  await B.base.close();
  await C.base.close();
}

// --- Run ------------------------------------------------------------------------

try {
  await writerProof();
  const latInline = await latency('inline');
  const latBlob = await latency('blob');
  await concurrentCompaction();
  const sInline = await session('inline');
  const sBlob = await session('blob');
  console.log('\nJSON summary');
  console.log(JSON.stringify({ batchesPerWriter: BATCHES, latInline, latBlob, sInline, sBlob }, null, 2));
} catch (err) {
  console.error(err);
  results.push(false);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
