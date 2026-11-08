// Household contacts (shared/household-contacts.mjs, ADR-0046): the records, where they live, and
// what sharing a Space moves.

import { describe, it, expect } from 'vitest'
import * as hc from '../../shared/household-contacts.mjs'
import { planShare, shareSummary } from '../../shared/space-library.mjs'

const SPACE = 'a'.repeat(64)
const NOW = '2026-11-08T10:00:00.000Z'

describe('household contacts', () => {
  it('keeps a Space’s in the Vault under its prefix, and in the Library once shared', () => {
    expect(hc.contactsPrefix(SPACE)).toBe(`/.vault/space-lib/${SPACE}/contacts/`)
    expect(hc.contactsPrefix(null)).toBe('/.vault/contacts/')
    expect(hc.LIB_CONTACTS).toBe('/contacts/')
    expect(() => hc.contactsPrefix('nope')).toThrow()
  })

  it('makes ids that are file names', () => {
    const id = hc.newContactId(Date.parse(NOW), () => 'abcd1234')
    expect(hc.isContactId(id)).toBe(true)
    expect(hc.contactFile(id)).toBe(id + '.json')
    expect(hc.isContactId('../x')).toBe(false)
    expect(() => hc.contactFile('../x')).toThrow()
  })

  it('cleans what the form sends and keeps who added it', () => {
    const id = hc.newContactId()
    const rec = hc.makeContact({ id, name: '  Dr.  Patel ', role: 'Doctor', phone: '+1 (555) 010-2000', email: 'front@clinic.example', address: '1 Main St\nTown', notes: 'Tuesdays only', by: 'Sam' }, null, NOW)
    expect(rec).toEqual({
      type: hc.CONTACT_TYPE,
      id,
      name: 'Dr. Patel',
      role: 'Doctor',
      phone: '+1 (555) 010-2000',
      email: 'front@clinic.example',
      address: '1 Main St\nTown',
      notes: 'Tuesdays only',
      by: 'Sam',
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(hc.isContact(rec)).toBe(true)
    const later = hc.makeContact({ id, name: 'Dr. Patel', by: 'Alex' }, rec, '2026-11-09T00:00:00.000Z')
    expect(later.by).toBe('Sam')
    expect(later.createdAt).toBe(NOW)
    expect(later.phone).toBeUndefined()
  })

  it('refuses a contact with no name, or a phone or email that isn’t one', () => {
    const id = hc.newContactId()
    expect(() => hc.makeContact({ id, name: ' ' })).toThrow(/name/)
    expect(() => hc.makeContact({ id, name: 'A', phone: 'call me' })).toThrow(/phone/)
    expect(() => hc.makeContact({ id, name: 'A', email: 'not an email' })).toThrow(/email/)
    expect(() => hc.makeContact({ id, name: 'A', profile: 'https://x' })).toThrow(/hyper/)
    expect(hc.makeContact({ id, name: 'A', profile: 'B'.repeat(64) }).profile).toBe(`hyper://${'b'.repeat(64)}/`)
  })

  it('sorts by name and finds every word, ignoring case and accents', () => {
    const mk = (name, role) => hc.makeContact({ id: hc.newContactId(), name, role })
    const list = [mk('Zoë', 'Babysitter'), mk('anna', 'School'), mk('Bob', 'Plumber')]
    expect(hc.sortContacts(list).map((c) => c.name)).toEqual(['anna', 'Bob', 'Zoë'])
    expect(hc.findContacts(list, 'zoe sitter').map((c) => c.name)).toEqual(['Zoë'])
    expect(hc.findContacts(list, 'plumb')).toHaveLength(1)
    expect(hc.findContacts(list, '')).toHaveLength(3)
  })

  it('builds call and email links that keep only what dials', () => {
    expect(hc.telLink('+1 (555) 010-2000')).toBe('tel:+15550102000')
    expect(hc.telLink('')).toBe(null)
    expect(hc.mailLink('a@b.example')).toBe('mailto:a@b.example')
  })

  it('moves with the Space when it’s shared, and counts in the summary', () => {
    const c = hc.makeContact({ id: hc.newContactId(), name: 'School office', role: 'School' })
    const plan = planShare({ space: { name: 'Home' }, owner: { memberId: 'f'.repeat(32), name: 'Sam' }, items: { contacts: [c, { junk: 1 }] } })
    expect(plan.filter((p) => p.path.startsWith('/contacts/'))).toEqual([{ path: `/contacts/${c.id}.json`, value: c }])
    expect(shareSummary({ contacts: [c] })).toBe('1 contact')
  })

  it('reads as lines for the AI, with who added each in a shared Space', () => {
    const c = hc.makeContact({ id: hc.newContactId(), name: 'Bob', role: 'Plumber', phone: '555 0100', by: 'Sam' })
    expect(hc.contactsText([c], { shared: true })).toBe('- Bob, (Plumber), phone 555 0100, added by Sam')
    expect(hc.contactsText([], { space: 'Home', shared: true })).toBe('No contacts in Home yet.')
  })
})
