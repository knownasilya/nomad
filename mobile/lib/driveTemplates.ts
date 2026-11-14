// The built-in drive templates on the phone: the same list and files as desktop's Create Drive
// (app/lib/drive-templates.ts, app/drive-templates/<id>/), from driveTemplates.json, which
// `npm run build:phone-templates` writes (tests/unit/drive-templates.test.js keeps it equal).
// The phone's bundle can't reach app/, so it carries that copy. It leaves out Document, which the
// phone can't edit yet (scripts/lib/phone-templates.mjs PHONE_SKIP).

import type { IconName } from '../components/Icon'
import TEMPLATES from './driveTemplates.json'

export interface PhoneDriveTemplate {
  id: string
  title: string
  description: string
  icon: string
  type?: string
  fallback?: string
  collaborative?: boolean
  manifest?: Record<string, unknown>
  files: { path: string; text: string }[]
}

export const DRIVE_TEMPLATES = TEMPLATES as PhoneDriveTemplate[]

export const templateIcon = (t: PhoneDriveTemplate) => t.icon as IconName

// What backend.create takes for `tpl`: its manifest fields and its files, as desktop's
// app/bg/hyper/drive-templates.js makes them.
export function templateDrive (tpl: PhoneDriveTemplate, { collaborative }: { collaborative: boolean }) {
  const manifest: Record<string, unknown> = { ...(tpl.manifest || {}) }
  if (tpl.type) manifest.type = tpl.type
  if (tpl.fallback) manifest.fallback = tpl.fallback
  if (collaborative) manifest.collaborative = true
  const files = tpl.files.map((f) => ({ path: f.path, text: f.text }))
  return { manifest, files }
}
