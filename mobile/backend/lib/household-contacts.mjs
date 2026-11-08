// The phone's household contacts: the same records as desktop's My Library → Contacts
// (app/bg/web-apis/bg/household-contacts.ts), on the same rules (shared/household-contacts.mjs).
// A Space's contacts are in the Vault until it's shared, then in its Space Library, so the whole
// household reads and edits one list; a viewer only reads it.

import * as hc from '../../../shared/household-contacts.mjs'
import { isSpaceKey } from '../../../shared/vault-apps.mjs'
import { recordsOf } from './vault-apps.mjs'
import { memberRecords } from './space-library.mjs'

const spaceOrNull = (space) => (isSpaceKey(space) ? space : null)

async function writable (base, s) {
  return s.shared ? !!s.writable : !!base.writable
}

// { space, shared, canWrite, contacts }, as desktop's.
export async function listContacts (base, space) {
  space = spaceOrNull(space)
  const s = await recordsOf(base, space, 'contacts')
  return {
    space,
    shared: !!s.shared,
    canWrite: await writable(base, s),
    contacts: hc.sortContacts(await s.list().catch(() => []))
  }
}

export async function saveContact (base, space, fields = {}) {
  space = spaceOrNull(space)
  const s = await recordsOf(base, space, 'contacts')
  if (!(await writable(base, s))) throw new Error('You can view this Space’s contacts, but not change them')
  const id = fields.id ? String(fields.id) : hc.newContactId()
  const prev = fields.id ? await s.get(hc.contactFile(id)).catch(() => null) : null
  if (fields.id && !hc.isContact(prev)) throw new Error('That contact was deleted')
  if (!prev && (await s.list().catch(() => [])).length >= hc.MAX_CONTACTS) throw new Error(`A Space can keep at most ${hc.MAX_CONTACTS} contacts`)
  let by = ''
  if (s.shared && s.lib) {
    const mine = (await memberRecords(s.lib).catch(() => [])).find((m) => m.memberId === s.lib.memberId)
    by = (mine && mine.name) || ''
  }
  const rec = hc.makeContact({ ...fields, id, by }, prev)
  await s.put(hc.contactFile(id), rec)
  return rec
}

export async function deleteContact (base, space, id) {
  space = spaceOrNull(space)
  id = String(id || '')
  if (!hc.isContactId(id)) return false
  const s = await recordsOf(base, space, 'contacts')
  if (!(await writable(base, s))) throw new Error('You can view this Space’s contacts, but not change them')
  if (!(await s.get(hc.contactFile(id)).catch(() => null))) return false
  await s.del(hc.contactFile(id))
  return true
}
