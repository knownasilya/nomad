// Household contacts (ADR-0046): a Space's address book of people who aren't on Nomad, such as the
// plumber, the school office, the babysitter and the vet, kept like the calendar's events.
//
// A Space's contacts are Vault records under its prefix (`/.vault/space-lib/<space>/contacts/`)
// until it's shared, then records in its Space Library (`/contacts/`), so the household reads and
// edits one list (`by` says who added each). Sharing moves them (shareContactPaths). The user's
// own, with no Space, are `/.vault/contacts/`. My Library's Contacts lists them above the user's
// Nomad contacts (Profile Drives); the phone has a Contacts screen; the AI reads them with
// listContacts. Desktop is bg/web-apis/bg/household-contacts.ts, the phone
// mobile/backend/lib/household-contacts.mjs. Tests: tests/unit/household-contacts.test.js.
//
// No imports but vault-apps.mjs, and no globals at load: this runs on the phone's Bare worklet.

import { spaceLibPrefix } from './vault-apps.mjs';

export const CONTACT_TYPE = 'nomad/household-contact';
const VAULT_CONTACTS = '/.vault/contacts/';
export const LIB_CONTACTS = '/contacts/';

export const MAX_NAME = 100;
export const MAX_ROLE = 60;
export const MAX_PHONE = 40;
export const MAX_EMAIL = 200;
export const MAX_ADDRESS = 300;
export const MAX_NOTES = 2000;
export const MAX_CONTACTS = 500;

// What the add form offers for "Who are they?". Anything else can be typed.
export const ROLE_SUGGESTIONS = [
  'Family',
  'Emergency',
  'Doctor',
  'Dentist',
  'School',
  'Babysitter',
  'Neighbor',
  'Plumber',
  'Electrician',
  'Vet',
];

export function contactsPrefix(space = null) {
  return space ? spaceLibPrefix(space) + 'contacts/' : VAULT_CONTACTS;
}

const ID_RE = /^c[a-z0-9]{1,16}-[0-9a-f]{8}$/;
export function isContactId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

function randomHex(n = 4) {
  let s = '';
  for (let i = 0; i < n; i++)
    s += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0');
  return s;
}

export function newContactId(now = Date.now(), rand = randomHex) {
  return 'c' + Math.floor(now).toString(36) + '-' + rand(4);
}

export function contactFile(id) {
  if (!isContactId(id)) throw new Error('Not a contact id: ' + id);
  return id + '.json';
}

const oneLine = (v, max) =>
  String(v ?? '')
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const text = (v, max) =>
  String(v ?? '')
    .replace(/\r\n?/g, '\n')
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);

// A phone number as typed, with only what dials: digits, spaces, + ( ) - . and an extension.
export function cleanPhone(v) {
  const s = oneLine(v, MAX_PHONE);
  if (!s) return '';
  if (!/^[+0-9 ().\-/#*x,;ext]+$/i.test(s) || !/[0-9]/.test(s)) throw new Error('That doesn’t look like a phone number');
  return s;
}

export function cleanEmail(v) {
  const s = oneLine(v, MAX_EMAIL);
  if (!s) return '';
  if (!/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/.test(s)) throw new Error('That doesn’t look like an email address');
  return s;
}

// A Nomad Profile Drive for someone who is on Nomad too: `hyper://<64 hex>/`.
export function cleanProfile(v) {
  const s = oneLine(v, 200);
  if (!s) return '';
  const m = /^(?:hyper:\/\/)?([0-9a-f]{64})\/?$/i.exec(s);
  if (!m) throw new Error('A Nomad profile is a hyper:// link');
  return `hyper://${m[1].toLowerCase()}/`;
}

export function isContact(r) {
  return !!r && r.type === CONTACT_TYPE && isContactId(r.id) && typeof r.name === 'string' && !!r.name;
}

// A new contact (no `prev`) or a change to one. Fields left out of `f` are cleared, as the form
// sends them all; `by` and `createdAt` stay as the first save set them.
export function makeContact(f = {}, prev = null, now = new Date().toISOString()) {
  if (!isContactId(f.id)) throw new Error('Not a contact id: ' + f.id);
  const name = oneLine(f.name, MAX_NAME);
  if (!name) throw new Error('A contact needs a name');
  const rec = {
    type: CONTACT_TYPE,
    id: f.id,
    name,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
  const role = oneLine(f.role, MAX_ROLE);
  if (role) rec.role = role;
  const phone = cleanPhone(f.phone);
  if (phone) rec.phone = phone;
  const email = cleanEmail(f.email);
  if (email) rec.email = email;
  const address = text(f.address, MAX_ADDRESS);
  if (address) rec.address = address;
  const notes = text(f.notes, MAX_NOTES);
  if (notes) rec.notes = notes;
  const profile = cleanProfile(f.profile);
  if (profile) rec.profile = profile;
  const by = oneLine(prev?.by || f.by, 60);
  if (by) rec.by = by;
  return rec;
}

// The list as people read it: by name, ignoring case and accents.
const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function sortContacts(list) {
  return [...(list || [])].filter(isContact).sort((a, b) => fold(a.name).localeCompare(fold(b.name)) || a.id.localeCompare(b.id));
}

// The search rule Notes and Reader use: every word typed, in any order, ignoring case and accents.
export function matchesContact(c, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([c.name, c.role, c.phone, c.email, c.address, c.notes, c.by].filter(Boolean).join(' '));
  return words.every((w) => hay.includes(w));
}

export function findContacts(list, query) {
  return sortContacts(list).filter((c) => matchesContact(c, query));
}

// tel: and mailto: links for the Call and Email buttons. A tel: link keeps only what dials.
export function telLink(phone) {
  const digits = String(phone || '').replace(/[^0-9+*#,;]/g, '');
  return digits ? 'tel:' + digits : null;
}

export function mailLink(email) {
  return email ? 'mailto:' + encodeURIComponent(email).replace(/%40/g, '@') : null;
}

// What sharing a Space moves into its Library: its contacts' paths there.
export function shareContactPaths(items = {}) {
  const out = [];
  for (const c of items.contacts || []) if (isContact(c)) out.push({ path: LIB_CONTACTS + c.id + '.json', value: c });
  return out;
}

// The contacts as lines for the AI (listContacts), one per contact.
export function contactsText(list, { space = '', shared = false } = {}) {
  const sorted = sortContacts(list);
  if (!sorted.length) return shared ? `No contacts in ${space || 'this Space'} yet.` : 'No contacts yet.';
  return sorted
    .map((c) => {
      const parts = [c.name];
      if (c.role) parts.push(`(${c.role})`);
      if (c.phone) parts.push(`phone ${c.phone}`);
      if (c.email) parts.push(`email ${c.email}`);
      if (c.address) parts.push(`address ${c.address.replace(/\n/g, ', ')}`);
      if (c.profile) parts.push(`Nomad profile ${c.profile}`);
      if (c.by && shared) parts.push(`added by ${c.by}`);
      let line = '- ' + parts.join(', ');
      if (c.notes) line += `\n  Notes: ${c.notes.replace(/\n/g, ' ').slice(0, 300)}`;
      return line;
    })
    .join('\n');
}
