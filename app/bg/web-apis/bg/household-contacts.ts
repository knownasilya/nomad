// Household contacts on desktop (My Library → Contacts, the AI's listContacts), on the internal
// nomad.vault API (vault.ts). The rules are shared/household-contacts.mjs, which the phone's backend
// uses too (mobile/backend/lib/household-contacts.mjs).
//
// Contacts belong to a Space: in the Vault until it's shared, then in its Space Library (ADR-0029),
// so every member reads and edits one list and a viewer only reads it. `ctx` is the RPC event: it
// names the calling page, and so its Space.

import * as spaceLibrary from '../../hyper/space-library';
import * as vaultApps from './vault-apps';
import * as hc from '../../../../shared/household-contacts.mjs';

async function spaceOrNull(ctx) {
  return vaultApps.spaceKey(ctx).catch(() => null);
}

const store = (space) => spaceLibrary.records(space || null, 'contacts');

// This person's name in a shared Space, for "added by".
async function memberName(space) {
  if (!space) return '';
  const share = await spaceLibrary.info(space).catch(() => null);
  if (!share?.shared) return '';
  const list = await spaceLibrary.members(space).catch(() => []);
  return list.find((m) => m.memberId === share.memberId)?.name || '';
}

// A Space's contacts: { space, spaceName, shared, canWrite, contacts }.
export async function contactsOf(space) {
  const s = await store(space);
  return {
    space: space || null,
    spaceName: vaultApps.spaceNameOf(space),
    shared: !!s.shared,
    canWrite: !!s.writable,
    contacts: hc.sortContacts(await s.list().catch(() => [])),
  };
}

export async function listContacts(ctx) {
  return contactsOf(await spaceOrNull(ctx));
}

// Add (no id) or change a contact in the caller's Space.
export async function saveContact(ctx, fields: any = {}) {
  const space = await spaceOrNull(ctx);
  const s = await store(space);
  if (!s.writable) throw new Error('You can view this Space’s contacts, but not change them');
  const id = fields.id ? String(fields.id) : hc.newContactId();
  const prev = fields.id ? await s.get(hc.contactFile(id)).catch(() => null) : null;
  if (fields.id && !hc.isContact(prev)) throw new Error('That contact was deleted');
  if (!prev && (await s.list().catch(() => [])).length >= hc.MAX_CONTACTS)
    throw new Error(`A Space can keep at most ${hc.MAX_CONTACTS} contacts`);
  const rec = hc.makeContact({ ...fields, id, by: await memberName(space) }, prev);
  await s.put(hc.contactFile(id), rec);
  return rec;
}

export async function deleteContact(ctx, id) {
  const space = await spaceOrNull(ctx);
  const s = await store(space);
  if (!hc.isContactId(String(id || ''))) return false;
  if (!s.writable) throw new Error('You can view this Space’s contacts, but not change them');
  if (!(await s.get(hc.contactFile(String(id))).catch(() => null))) return false;
  await s.del(hc.contactFile(String(id)));
  return true;
}

// The AI's listContacts: lines it reads, filtered by `query` when it gives one.
export async function contactsText(space, query = '') {
  const { contacts, spaceName, shared } = await contactsOf(space);
  const found = query ? hc.findContacts(contacts, query) : contacts;
  if (query && !found.length) return `No contacts match “${query}”.`;
  return hc.contactsText(found, { space: spaceName || '', shared });
}
