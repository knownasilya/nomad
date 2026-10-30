#!/usr/bin/env node
// Writes app/lib/genui/schema.json, the JSON Schema of the AI Sidebar's OpenUI component library
// (app/lib/genui/library.mjs). The shell window's parser reads it, so the window bundles neither
// zod nor the library. Rerun after changing the library; tests/unit/genui.test.js fails until you do.

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../app');
const { genuiSchema } = await import(path.join(appDir, 'lib/genui/library.mjs'));

const out = path.join(appDir, 'lib/genui/schema.json');
fs.writeFileSync(out, JSON.stringify(genuiSchema(), null, 2) + '\n');
console.log(`Wrote ${path.relative(process.cwd(), out)}`);
