#!/usr/bin/env node
// Bundles each built-in drive template's app (app/drive-templates/<id>/src/main.js) into the one
// file a new Drive gets (app/drive-templates/<id>/app.js). The output is committed: Drives copy it
// as-is, and every Drive keeps the version it was made with. Rerun after changing a template's src/,
// the Notes editor it reuses, or shared/vault-apps.mjs:
//
//   npm run build:drive-templates

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatesDir = path.join(root, 'app/drive-templates');
const vite = await import('vite');

for (const id of fs.readdirSync(templatesDir)) {
  const entry = path.join(templatesDir, id, 'src/main.js');
  if (!fs.existsSync(entry)) continue;
  const result = await vite.build({
    root: path.join(root, 'app'),
    logLevel: 'warn',
    configFile: false,
    build: {
      write: false,
      minify: true,
      target: 'es2020',
      lib: { entry, formats: ['iife'], name: 'NomadDriveTemplate', fileName: () => 'app.js' },
    },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs.flatMap((o) => o.output).find((o) => o.type === 'chunk');
  if (!chunk) throw new Error(`no bundle produced for ${id}`);
  const banner = `/* Nomad "${id}" drive template. Built from nomad/app/drive-templates/${id}/src by scripts/build-drive-templates.mjs. */\n`;
  const out = path.join(templatesDir, id, 'app.js');
  fs.writeFileSync(out, banner + chunk.code);
  console.log(`${path.relative(root, out)}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}
