// Benchmark for ADR-0010 Open question 2 (per-drive open cost at browser scale).
// THROWAWAY. Answers the fork: does making EVERY drive an Autobase (autobase-only)
// cost too much vs today's single-writer Hyperdrive, when a session opens dozens?
//
// Measures, for single-writer Hyperdrive vs single-writer Autobase, all local (no swarm):
//   1. create/drive     — new drive, ready, write /index.json
//   2. cold-open/drive   — fresh corestore on the SAME on-disk storage, open by key,
//                          read /index.json back (the browser-startup scenario)
//   3. resident memory   — RSS/heap for N drives held open at once
//
// Matches nomad's real patterns: one shared Corestore, each drive under
// store.namespace(randomBytes(32)) (daemon.js createHyperdriveSession /
// autobases.js createCollaborativeDrive), reopen by key on the root store.
//
// Run (from app dir, --expose-gc for clean memory numbers):
//   cd ~/maintained/nomad/app && node --expose-gc scripts/bench-drive-open-cost.mjs [N=30]

import os from 'os';
import path from 'path';
import fs from 'fs';
import { randomBytes } from 'crypto';
import Corestore from 'corestore';
import Hyperdrive from 'hyperdrive';
import Autobase from 'autobase';
import Hyperbee from 'hyperbee';

const N = Number(process.argv[2] || 30);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-drive-'));
const META = JSON.stringify({ type: 'walled.garden/person', title: 'bench', ts: 1 });

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms, float
const gc = () => {
  if (global.gc) {
    global.gc();
    global.gc();
  }
};
const rssMB = () => process.memoryUsage().rss / 1048576;
const heapMB = () => process.memoryUsage().heapUsed / 1048576;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const p = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return {
    p50: p(0.5),
    p95: p(0.95),
    max: s[s.length - 1],
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
  };
}
const f = (n) => n.toFixed(1);

// --- Autobase view + reducer (same shape as the ADR-0010 spike) ---------------
const open = (store) =>
  new Hyperbee(store.get({ name: 'db' }), { keyEncoding: 'utf-8', valueEncoding: 'json' });
async function apply(nodes, view, host) {
  for (const { value } of nodes) {
    if (!value) continue;
    if (value.op === 'put') await view.put(value.path, value.data);
  }
}

// --- Per-type create / cold-open drivers --------------------------------------
const drivers = {
  hyperdrive: {
    async create(store) {
      const drive = new Hyperdrive(store.namespace(randomBytes(32)));
      await drive.ready();
      await drive.put('/index.json', Buffer.from(META));
      const key = drive.key.toString('hex');
      await drive.close();
      return key;
    },
    async openRead(store, key) {
      const drive = new Hyperdrive(store.namespace(randomBytes(32)), Buffer.from(key, 'hex'));
      await drive.ready();
      const buf = await drive.get('/index.json');
      return { handle: drive, text: buf && buf.toString() };
    },
    close: (h) => h.close(),
  },
  autobase: {
    async create(store) {
      const base = new Autobase(store.namespace(randomBytes(32)), null, {
        open,
        apply,
        valueEncoding: 'json',
        ackInterval: 1000,
      });
      await base.ready();
      await base.append({ op: 'put', path: '/index.json', data: META });
      await base.update();
      const key = base.key.toString('hex');
      await base.close();
      return key;
    },
    async openRead(store, key) {
      const base = new Autobase(store, Buffer.from(key, 'hex'), {
        open,
        apply,
        valueEncoding: 'json',
        ackInterval: 1000,
      });
      await base.ready();
      await base.update();
      const node = await base.view.get('/index.json');
      return { handle: base, text: node && node.value };
    },
    close: (h) => h.close(),
  },
};

// --- ADR-0010 Q2 caveat: does cold-open stay flat as the OPLOG grows? -----------
// The main suite gives every drive a 1-op oplog. Autobase persists a checkpointed
// linearized view and, on open, should replay only ops SINCE the checkpoint — so a
// 10k-op drive should cold-open about as fast as a 1-op drive. If instead open time
// scales with edit count, that refutes the "flat" assumption and edit-heavy drives
// (a long-lived Root Drive / Vault) would open slowly. This section builds a few
// autobase drives with a long oplog and compares their cold-open to the 1-op baseline.
const LONG_OPS = Number(process.env.LONG_OPS || 10000);
const LONG_N = Number(process.env.LONG_N || 4);

async function runLongOplogSuite(opsPerDrive, count) {
  const d = drivers.autobase;
  const dir = path.join(TMP, `autobase-long-${opsPerDrive}`);

  // ---- create phase: each drive gets index.json + (opsPerDrive-1) more put ops ----
  let store = new Corestore(dir);
  await store.ready();
  const createMs = [];
  const keys = [];
  for (let i = 0; i < count; i++) {
    const base = new Autobase(store.namespace(randomBytes(32)), null, {
      open,
      apply,
      valueEncoding: 'json',
      ackInterval: 1000,
    });
    await base.ready();
    const t = now();
    await base.append({ op: 'put', path: '/index.json', data: META });
    for (let j = 1; j < opsPerDrive; j++) {
      await base.append({ op: 'put', path: `/f/${j}.txt`, data: `v${j}` });
    }
    await base.update(); // linearize + persist the checkpointed view
    createMs.push(now() - t);
    keys.push(base.key.toString('hex'));
    await base.close();
  }
  await store.close();

  // ---- cold-open phase: fresh corestore on the same storage, read /index.json ----
  await sleep(50);
  gc();
  store = new Corestore(dir);
  await store.ready();
  const openMs = [];
  const handles = [];
  let correct = 0;
  for (const key of keys) {
    const t = now();
    const { handle, text } = await d.openRead(store, key);
    openMs.push(now() - t);
    if (text === META) correct++;
    handles.push(handle);
  }
  for (const h of handles) await d.close(h);
  await store.close();

  return {
    type: `autobase-${opsPerDrive}op`,
    create: stats(createMs),
    open: stats(openMs),
    correct,
    n: keys.length,
    opsPerDrive,
  };
}

async function runSuite(type) {
  const d = drivers[type];
  const dir = path.join(TMP, type);

  // ---- create phase ----
  let store = new Corestore(dir);
  await store.ready();
  const createMs = [];
  const keys = [];
  for (let i = 0; i < N; i++) {
    const t = now();
    keys.push(await d.create(store));
    createMs.push(now() - t);
  }
  await store.close();

  // ---- cold-open phase (fresh corestore, same storage) ----
  await sleep(50);
  gc();
  store = new Corestore(dir);
  await store.ready();
  const baseRss = rssMB();
  const baseHeap = heapMB();
  const openMs = [];
  const handles = [];
  let correct = 0;
  for (const key of keys) {
    const t = now();
    const { handle, text } = await d.openRead(store, key);
    openMs.push(now() - t);
    if (text === META) correct++;
    handles.push(handle); // keep open to measure resident memory
  }
  gc();
  const memRss = rssMB() - baseRss;
  const memHeap = heapMB() - baseHeap;

  for (const h of handles) await d.close(h);
  await store.close();

  return {
    type,
    create: stats(createMs),
    open: stats(openMs),
    memRss,
    memHeap,
    correct,
    n: keys.length,
  };
}

function row(label, hd, ab) {
  const ratio = ab / hd;
  console.log(
    `  ${label.padEnd(22)} ${f(hd).padStart(9)} ${f(ab).padStart(9)}   ${ratio.toFixed(1)}x`
  );
}

async function main() {
  console.log(
    `\n=== ADR-0010 drive open-cost bench — N=${N} drives/type — ${global.gc ? 'gc on' : 'NO --expose-gc (memory noisy)'} ===\n`
  );
  const hd = await runSuite('hyperdrive');
  const ab = await runSuite('autobase');

  for (const r of [hd, ab]) {
    if (r.correct !== r.n)
      console.log(
        `  ⚠️  ${r.type}: only ${r.correct}/${r.n} cold-opens read /index.json back correctly — timings suspect`
      );
  }

  console.log(
    `\n  ${''.padEnd(22)} ${'Hyperdrive'.padStart(9)} ${'Autobase'.padStart(9)}   overhead`
  );
  console.log('  ' + '-'.repeat(52));
  row('create p50 (ms)', hd.create.p50, ab.create.p50);
  row('create p95 (ms)', hd.create.p95, ab.create.p95);
  row('cold-open p50 (ms)', hd.open.p50, ab.open.p50);
  row('cold-open p95 (ms)', hd.open.p95, ab.open.p95);
  row('cold-open max (ms)', hd.open.max, ab.open.max);
  row(`open ${N} total (ms)`, hd.open.mean * N, ab.open.mean * N);
  row('RSS / drive (MB)', hd.memRss / N, ab.memRss / N);
  row(`RSS ${N} drives (MB)`, hd.memRss, ab.memRss);

  const openRatio = ab.open.p50 / hd.open.p50;
  const memRatio = ab.memRss / N / (hd.memRss / N);
  console.log('\n  Interpretation:');
  console.log(
    `   • Autobase cold-open is ~${openRatio.toFixed(1)}x Hyperdrive (${f(ab.open.p50)}ms vs ${f(hd.open.p50)}ms p50).`
  );
  console.log(
    `   • Opening ${N} autobase drives at startup ≈ ${f(ab.open.mean * N)}ms serial (${f(ab.open.mean * N - hd.open.mean * N)}ms more than Hyperdrive).`
  );
  console.log(
    `   • Memory/drive ≈ ${f(ab.memRss / N)}MB autobase vs ${f(hd.memRss / N)}MB hyperdrive (~${memRatio.toFixed(1)}x).`
  );
  console.log(
    '\n  Rule of thumb: if autobase cold-open p95 stays well under ~50ms and RSS/drive under a few MB,'
  );
  console.log(
    '  autobase-only is viable at browser scale (dozens of drives). If open scales poorly or memory'
  );
  console.log(
    '  balloons, prefer ADR-0010 option 2 (unified API, Hyperdrive kept for single-writer drives),'
  );
  console.log('  or lazy-promote (open lightweight, spin the full indexer only on first write).');

  // ---- ADR-0010 Q2 caveat: long-oplog cold-open ----
  console.log(
    `\n=== Long-oplog cold-open (Q2 caveat) — ${LONG_N} autobase drives × ${LONG_OPS} ops each ===\n`
  );
  const long = await runLongOplogSuite(LONG_OPS, LONG_N);
  if (long.correct !== long.n) {
    console.log(
      `  ⚠️  only ${long.correct}/${long.n} long-oplog cold-opens read /index.json back — timings suspect`
    );
  }
  console.log(
    `  ${''.padEnd(22)} ${'1-op'.padStart(9)} ${(LONG_OPS + '-op').padStart(9)}   growth`
  );
  console.log('  ' + '-'.repeat(52));
  row('cold-open p50 (ms)', ab.open.p50, long.open.p50);
  row('cold-open p95 (ms)', ab.open.p95, long.open.p95);
  row('cold-open max (ms)', ab.open.max, long.open.max);
  console.log(
    `  ${'create/drive (ms)'.padEnd(22)} ${''.padStart(9)} ${f(long.create.p50).padStart(9)}`
  );

  const openGrowth = long.open.p50 / ab.open.p50;
  console.log('\n  Interpretation:');
  console.log(
    `   • A ${LONG_OPS}-op drive cold-opens in ${f(long.open.p50)}ms p50 / ${f(long.open.p95)}ms p95`
  );
  console.log(
    `     vs ${f(ab.open.p50)}ms / ${f(ab.open.p95)}ms for a 1-op drive (~${openGrowth.toFixed(1)}× p50).`
  );
  if (long.open.p95 < 50 && openGrowth < 3) {
    console.log(
      '   • FLAT ENOUGH: open does NOT scale with edit count — Autobase checkpoints the view'
    );
    console.log(
      '     and replays only post-checkpoint ops. The Q2 caveat is CLOSED: long-history drives open fine.'
    );
  } else {
    console.log(
      '   • ⚠️ open GROWS with oplog length — Autobase is replaying a long tail on open. Investigate'
    );
    console.log(
      '     checkpoint cadence (ackInterval / fastForward) before committing to autobase-only for edit-heavy drives.'
    );
  }
}

main()
  .then(() => {
    fs.rmSync(TMP, { recursive: true, force: true });
    process.exit(0);
  })
  .catch((e) => {
    console.error('\nBENCH CRASHED:', e.stack || e);
    fs.rmSync(TMP, { recursive: true, force: true });
    process.exit(1);
  });
