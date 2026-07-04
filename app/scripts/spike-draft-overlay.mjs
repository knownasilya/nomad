// Spike for ADR-0012 (Drive Draft Mode — device-private staging hosted in the Vault).
// THROWAWAY — not wired into the app. Validates the overlay SEMANTICS against the REAL
// shared/fs-core.mjs reducer, in-process (no swarm):
//
//   1. Stage-over-base: a staged put shadows the published file; a staged del reads as a
//      tombstone (absent) in the merged view while the base still has the file.
//   2. Isolation: the base Drive's view is UNTOUCHED by staging (a follower would see nothing).
//   3. Publish: staged puts/dels fold onto the base as one append-batch + one update(); the base
//      view then reflects them and the Draft is cleared.
//   4. Subset publish: publishing one subtree leaves the rest staged.
//   5. Conflict detection: if the base record moves under a staged path between stage and publish,
//      it is flagged (observed-base vs current-base), and a non-forced publish skips it.
//
// Blob re-homing on publish is NOT re-proven here — cross-writer blob resolve is already covered by
// ADR-0010 Q1 (spike-autobase-fs.mjs). This spike uses inline content so it stays store-simple and
// focuses on the overlay logic that is new to ADR-0012.
//
// Run from the app dir so deps resolve (autobase/corestore/hyperbee live in app/node_modules):
//   cd ~/maintained/nomad/app && node scripts/spike-draft-overlay.mjs
// Exit 0 = all checks passed; 1 = a check failed.

import os from 'os';
import path from 'path';
import fs from 'fs';
import Corestore from 'corestore';
import Autobase from 'autobase';
import Hyperbee from 'hyperbee';
import b4a from 'b4a';
import { createFsCore, makeMetadata, AUTOBASE_OPTS } from '../../shared/fs-core.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-draft-'));
const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`  ${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// --- A minimal Drive over the REAL fs-core reducer --------------------------

const fsCore = createFsCore({ Hyperbee, b4a });

async function makeDrive(dir) {
  const store = new Corestore(path.join(TMP, dir));
  const base = new Autobase(store, null, { ...AUTOBASE_OPTS, open: fsCore.open, apply: fsCore.apply });
  await base.ready();
  return base;
}

const meta = () => makeMetadata({ mtime: 1, ctime: 1 });
const enc = (str) => b4a.toString(b4a.from(str), 'base64');
const dec = (rec) => (rec && rec.value != null ? b4a.toString(b4a.from(rec.value, 'base64')) : null);

// Ops appended to a base. Content is inline `value` (see header note on blobs).
const putStr = (p, str) => ({ op: 'put', path: p, metadata: meta(), value: enc(str) });
const putJson = (p, obj) => ({ op: 'put', path: p, metadata: meta(), value: enc(JSON.stringify(obj)) });
const del = (p) => ({ op: 'del', path: p });

async function record(base, p) {
  const node = await base.view.get(p);
  return node ? node.value : null;
}
const content = async (base, p) => dec(await record(base, p));

// --- The Draft overlay algorithm (mirrors app/bg/hyper/drafts.js) -----------
// base   = the published Drive; vault = the private, multi-Device draft host.
const filesPrefix = (baseKey) => `/.drafts/${baseKey}/files`;
const draftPath = (baseKey, p) => `${filesPrefix(baseKey)}${p}`;

async function stagePut(vault, baseKey, base, p, str) {
  await vault.append(putJson(draftPath(baseKey, p), {
    op: 'put',
    contentB64: enc(str),
    base: await record(base, p),
    stagedAt: 1,
  }));
  await vault.update();
}
async function stageDel(vault, baseKey, base, p) {
  await vault.append(putJson(draftPath(baseKey, p), { op: 'del', base: await record(base, p), stagedAt: 1 }));
  await vault.update();
}
async function entry(vault, baseKey, p) {
  const node = await vault.view.get(draftPath(baseKey, p));
  return node ? JSON.parse(dec(node.value)) : null;
}
async function readMerged(vault, baseKey, base, p) {
  const e = await entry(vault, baseKey, p);
  if (e) return e.op === 'del' ? null : b4a.toString(b4a.from(e.contentB64, 'base64'));
  return content(base, p);
}
async function listDraft(vault, baseKey, base) {
  const out = [];
  const pfx = filesPrefix(baseKey);
  for await (const node of vault.view.createReadStream({ gte: pfx, lt: `${pfx}\xff` })) {
    const e = JSON.parse(dec(node.value));
    const key = typeof node.key === 'string' ? node.key : b4a.toString(node.key);
    const p = key.slice(pfx.length);
    const cur = await record(base, p);
    out.push({ path: p, op: e.op, conflict: JSON.stringify(cur) !== JSON.stringify(e.base) });
  }
  return out;
}
async function publish(vault, baseKey, base, { paths = null, force = false } = {}) {
  const sel = (p) => !paths || paths.some((x) => p === x || p.startsWith(x.endsWith('/') ? x : `${x}/`));
  const rows = (await listDraft(vault, baseKey, base)).filter((r) => sel(r.path));
  const apply = force ? rows : rows.filter((r) => !r.conflict);
  const done = [];
  for (const r of apply) {
    const e = await entry(vault, baseKey, r.path);
    await base.append(e.op === 'del' ? del(r.path) : putStr(r.path, b4a.toString(b4a.from(e.contentB64, 'base64'))));
    done.push(r.path);
  }
  if (done.length) await base.update();
  for (const p of done) { await vault.append(del(draftPath(baseKey, p))); }
  if (done.length) await vault.update();
  return { published: done, conflicts: force ? [] : rows.filter((r) => r.conflict).map((r) => r.path) };
}

// --- Run --------------------------------------------------------------------

async function main() {
  const base = await makeDrive('base');
  const vault = await makeDrive('vault');
  const baseKey = b4a.toString(base.key, 'hex');

  // Seed the published Drive.
  await base.append(putStr('/index.html', 'PUBLISHED v1'));
  await base.append(putStr('/keep.txt', 'keep me'));
  await base.append(putJson('/posts/old/post.json', { title: 'old' }));
  await base.update();

  // Stage: edit index.html, delete keep.txt, add a new post.
  await stagePut(vault, baseKey, base, '/index.html', 'DRAFT v2');
  await stageDel(vault, baseKey, base, '/keep.txt');
  await stagePut(vault, baseKey, base, '/posts/new/post.json', JSON.stringify({ title: 'new' }));

  // 1. Merged view reflects staging; base is untouched.
  check('merged: staged put shadows base', (await readMerged(vault, baseKey, base, '/index.html')) === 'DRAFT v2');
  check('merged: staged del is a tombstone', (await readMerged(vault, baseKey, base, '/keep.txt')) === null);
  check('merged: staged new file visible', (await readMerged(vault, baseKey, base, '/posts/new/post.json')) !== null);
  check('isolation: base index.html still v1', (await content(base, '/index.html')) === 'PUBLISHED v1');
  check('isolation: base keep.txt still present', (await content(base, '/keep.txt')) === 'keep me');

  // 2. Subset publish — only the new post; the rest stays staged.
  const sub = await publish(vault, baseKey, base, { paths: ['/posts/new/'] });
  check('subset publish: applied the subtree', sub.published.includes('/posts/new/post.json'));
  check('subset publish: base has the new post', (await content(base, '/posts/new/post.json')) !== null);
  check('subset publish: index.html still staged', (await readMerged(vault, baseKey, base, '/index.html')) === 'DRAFT v2');
  check('subset publish: base index.html unchanged', (await content(base, '/index.html')) === 'PUBLISHED v1');

  // 3. Conflict: the base moves under a staged path before publishing it.
  await base.append(putStr('/index.html', 'EXTERNAL EDIT'));
  await base.update();
  const rowsC = await listDraft(vault, baseKey, base);
  const idxRow = rowsC.find((r) => r.path === '/index.html');
  check('conflict: base-changed-under-me detected', idxRow && idxRow.conflict === true);

  const nonForced = await publish(vault, baseKey, base);
  check('conflict: non-forced publish skips conflicting path', nonForced.conflicts.includes('/index.html'));
  check('conflict: keep.txt (no conflict) still published', (await content(base, '/keep.txt')) === null); // staged del applied
  check('conflict: base index.html kept external edit', (await content(base, '/index.html')) === 'EXTERNAL EDIT');

  // 4. Force publish resolves the conflict (last-writer-wins).
  const forced = await publish(vault, baseKey, base, { force: true });
  check('force publish: conflicting path applied', forced.published.includes('/index.html'));
  check('force publish: base now has draft content', (await content(base, '/index.html')) === 'DRAFT v2');
  check('force publish: Draft is now empty', (await listDraft(vault, baseKey, base)).length === 0);

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(1);
});
