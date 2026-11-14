// The phone's copy of the built-in drive templates (scripts/build-phone-templates.mjs writes it to
// mobile/lib/driveTemplates.json; tests/unit/drive-templates.test.js compares the two). Each
// template keeps what the phone needs to make the drive: its manifest fields and its files' text.
// `icon` is the Font Awesome 5 name without its style ('far fa-file-alt' → 'file-alt').

import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// Templates the phone leaves out: Blank, which its New drive form draws itself, and Document, which
// it can't edit yet (ADR-0026's phases aren't built), with its half-megabyte editor.
export const PHONE_SKIP = ['blank', 'document'];

export async function phoneTemplates(root) {
  const { DRIVE_TEMPLATES } = await import(pathToFileURL(path.join(root, 'app/lib/drive-templates.ts')).href);
  return DRIVE_TEMPLATES.filter((t) => !PHONE_SKIP.includes(t.id)).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    icon: t.icon.split(' ').find((c) => c.startsWith('fa-') && c !== 'fa-fw').slice(3),
    ...(t.type ? { type: t.type } : {}),
    ...(t.fallback ? { fallback: t.fallback } : {}),
    ...(t.collaborative ? { collaborative: true } : {}),
    ...(t.manifest ? { manifest: t.manifest } : {}),
    files: (t.files || []).map((f) => ({
      path: f,
      text: fs.readFileSync(path.join(root, 'app/drive-templates', t.id, f), 'utf8'),
    })),
  }));
}
