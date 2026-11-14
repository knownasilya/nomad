#!/usr/bin/env node
// Copies the built-in drive templates that come from the nomad.dev gallery (`source` in
// app/lib/drive-templates.ts) from a nomad.dev checkout into app/drive-templates/<id>/, then
// rebuilds the phone's copy. nomad.dev is where they are written; run this after changing one there.
//
//   npm run sync:drive-templates [-- path/to/nomad.dev]   (default: ../nomad.dev)

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.env.__SYNC_TPL_STRIP) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __SYNC_TPL_STRIP: '1' } }
  );
  if (r.status) process.exit(r.status);
  const b = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'build-phone-templates.mjs')], { stdio: 'inherit' });
  process.exit(b.status ?? 1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.resolve(process.argv[2] || path.join(root, '../nomad.dev'));
const { DRIVE_TEMPLATES } = await import(pathToFileURL(path.join(root, 'app/lib/drive-templates.ts')).href);

for (const t of DRIVE_TEMPLATES) {
  if (!t.source) continue;
  const from = path.join(site, 'static/templates', t.source);
  if (!fs.existsSync(from)) throw new Error(`No template at ${from}`);
  const to = path.join(root, 'app/drive-templates', t.id);
  fs.mkdirSync(to, { recursive: true });
  for (const f of t.files || []) {
    fs.mkdirSync(path.dirname(path.join(to, f)), { recursive: true });
    fs.copyFileSync(path.join(from, f), path.join(to, f));
  }
  console.log('copied', t.source, '→', path.relative(root, to));
}
