#!/usr/bin/env node
// Writes mobile/lib/driveTemplates.json: the built-in drive templates (app/lib/drive-templates.ts)
// with their files' text, for the phone's New drive form. The phone's bundle can't reach app/, so
// this copy is committed; tests/unit/drive-templates.test.js fails when it falls behind. Rerun after
// changing a template's files or the list:
//
//   npm run build:phone-templates

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.env.__PHONE_TPL_STRIP) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url)],
    { stdio: 'inherit', env: { ...process.env, __PHONE_TPL_STRIP: '1' } }
  );
  process.exit(r.status ?? 1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { phoneTemplates } = await import(pathToFileURL(path.join(root, 'scripts/lib/phone-templates.mjs')).href);
const out = path.join(root, 'mobile/lib/driveTemplates.json');
fs.writeFileSync(out, JSON.stringify(await phoneTemplates(root), null, 1) + '\n');
console.log('wrote', path.relative(root, out));
