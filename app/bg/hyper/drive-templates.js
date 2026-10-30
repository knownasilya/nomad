// Making a Drive from a built-in template (the list is app/lib/drive-templates.ts). The Create
// Drive dialog and nomad.fs.createDrive({ template }) take one by id. A template sets the manifest
// (`type`, `fallback`, whether it accepts writers) and lists the files copied in from
// app/drive-templates/<id>/; only listed files ship, so a template's src/ stays out of user Drives.

import path from 'path';
import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import { DRIVE_TEMPLATES } from '../../lib/drive-templates';

export { DRIVE_TEMPLATES };

// Where the template files are: app/drive-templates (the bundled main process runs from app/).
let templatesDir = path.join(__dirname, 'drive-templates');
export function setTemplatesDir(dir) {
  templatesDir = dir;
}

export function getTemplate(id = 'blank') {
  const tpl = DRIVE_TEMPLATES.find((t) => t.id === (id || 'blank'));
  if (!tpl) throw new Error(`Unknown drive template: ${id}`);
  return tpl;
}

// The manifest a Drive made from `tpl` starts with. The caller's own fields win, except `type` and
// `fallback`, which the template's files depend on.
/**
 * @param {import('../../lib/drive-templates').DriveTemplate} tpl
 * @param {Record<string, any>} [meta]
 * @returns {Record<string, any>}
 */
export function templateManifest(tpl, meta = {}) {
  const out = { ...meta };
  if (tpl.type) out.type = tpl.type;
  if (tpl.fallback) out.fallback = tpl.fallback;
  if (typeof out.collaborative === 'undefined' && tpl.collaborative) out.collaborative = true;
  return out;
}

// The files to write into the new Drive: [{ path, data, inline }]. Small control records go inline.
/**
 * @param {import('../../lib/drive-templates').DriveTemplate} tpl
 * @param {{ title?: string, now?: Date }} [opts]
 */
export async function templateFiles(tpl, { title = '', now = new Date() } = {}) {
  const out = [];
  for (const file of tpl.files || []) {
    out.push({
      path: file,
      data: await fs.readFile(path.join(templatesDir, tpl.id, file)),
      inline: false,
    });
  }
  if (tpl.id === 'document') {
    const doc = {
      type: 'walled.garden/live-doc',
      id: randomBytes(8).toString('hex'),
      format: 'yjs/1',
      schema: 'text',
      title,
      createdAt: now.toISOString(),
    };
    out.push({
      path: '/doc/doc.json',
      data: Buffer.from(JSON.stringify(doc, null, 2)),
      inline: true,
    });
  }
  return out;
}
