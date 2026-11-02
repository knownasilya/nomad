// The createDrive capability: the user's own AI makes a new drive, as the Create Drive dialog does
// (fg/modals/create-drive.js). These are the pure parts; bg/web-apis/bg/ai.ts asks the user and
// makes the drive through nomad.fs. No Electron imports, so unit tests load this file.
//
// The dialog's folder sync and git import read this computer's files, so the AI gets neither: a
// title, a description, a template and whether others may ask to write.

// The template ids app/lib/drive-templates.ts lists (tests/unit/create-drive.test.js keeps them equal).
// This file can't import that one: search-execute.mjs, which the execute worker loads as plain
// JavaScript, takes its enum from here.
export const TEMPLATE_IDS = ['blank', 'document']

export const MAX_TITLE = 100
export const MAX_DESCRIPTION = 500

// The permission createDrive asks, once a turn. A Job's `writes.newDrives` grants it.
export const CREATE_DRIVE_PERM = 'aiCreateDrive'

/**
 * The options for nomad.fs.createDrive from the model's arguments. Throws a message the model can
 * act on for a bad one.
 * @param {any} args
 * @returns {{ title: string, description?: string, template: string, collaborative?: boolean }}
 */
export function newDriveOptions(args) {
  const a = args && typeof args === 'object' ? args : {}
  const title = typeof a.title === 'string' ? a.title.replace(/\s+/g, ' ').trim() : ''
  if (!title) throw new Error('createDrive needs a `title`, e.g. "Trip photos"')
  if (title.length > MAX_TITLE) throw new Error(`title is a short name, ${MAX_TITLE} characters at most`)
  const out = { title, template: 'blank' }
  if (a.description != null && a.description !== '') {
    if (typeof a.description !== 'string') throw new Error('description must be a string')
    const description = a.description.trim()
    if (description.length > MAX_DESCRIPTION) {
      throw new Error(`description is a sentence or two, ${MAX_DESCRIPTION} characters at most`)
    }
    if (description) out.description = description
  }
  if (a.template != null && a.template !== '') {
    const id = String(a.template).trim().toLowerCase()
    if (!TEMPLATE_IDS.includes(id)) {
      throw new Error(`template is one of ${TEMPLATE_IDS.map((t) => `"${t}"`).join(', ')}`)
    }
    out.template = id
  }
  // Left out, the template decides: a Document takes writers, a Blank drive is locked.
  if (a.collaborative != null) {
    if (typeof a.collaborative !== 'boolean') throw new Error('collaborative must be true or false')
    out.collaborative = a.collaborative
  }
  return out
}

/**
 * What createDrive returns to the model: the new drive's URL, which is also the link for the
 * answer (shared/item-links.mjs opens hyper:// pages as they are).
 * @param {string} url
 * @param {{ title: string, template: string, collaborative?: boolean }} opts
 * @param {{ collaborative: boolean, draft?: boolean }} made
 */
export function createdDrive(url, opts, made) {
  const root = String(url).replace(/\/?$/, '/')
  return {
    url: root,
    title: opts.title,
    template: opts.template,
    collaborative: !!made.collaborative,
    note:
      `Made the drive. Write files into it with writeDriveFile, passing ${root} as \`drive\`; ` +
      'you may write to it on this turn without asking again' +
      (made.draft ? ', and those writes stage in its Draft for the user to publish' : '') +
      `. Link it in your answer: [${opts.title}](${root}).`,
  }
}
