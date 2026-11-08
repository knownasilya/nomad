# Household contacts: a Space's address book

**Status: Accepted** 2026-11-08, built as below. Builds on ADR-0029 (Shared Spaces), ADR-0042 (the
family calendar, whose records these copy) and ADR-0019 (the AI and the user's Notes and Reader).

A household keeps a list of people it calls: the doctor, the dentist, the school office, the
babysitter, the plumber, the vet. None of them is on Nomad. My Library → Contacts held only Profile
Drives (people on Nomad), so that list lived on a fridge or in one person's phone.

## Decision

1. **Records.** A household contact is a `nomad/household-contact` record:
   `{ id, name, role?, phone?, email?, address?, notes?, profile?, by?, createdAt, updatedAt }`.
   `name` is required; `role` is free text with suggestions (Family, Emergency, Doctor, School,
   Babysitter, …); `phone` keeps only what dials plus spaces and punctuation; `profile` is an
   optional `hyper://` Profile Drive for someone who is on Nomad too. The rules are
   `shared/household-contacts.mjs` (tests `tests/unit/household-contacts.test.js`).
2. **Where.** They belong to a Space, like its calendar: `/.vault/space-lib/<space>/contacts/` in
   the Vault until the Space is shared, then `/contacts/` in its Space Library, so the household
   reads and edits one list and a viewer only reads it. `by` names the member who added one.
   Sharing moves them (`collect`, `planShare` via `shareContactPaths`, `shareSummary` counts them).
   Code reads them through `spaceLibrary.records(space, 'contacts')` on desktop and
   `recordsOf(base, space, 'contacts')` on the phone, never straight from the Vault.
3. **Desktop.** My Library → Contacts lists the Space's household contacts first, with call and
   email links, copy, edit and remove, then the user's Contacts on Nomad. Internal API:
   `nomad.vault.listHouseholdContacts`/`saveHouseholdContact`/`deleteHouseholdContact`
   (`app/bg/web-apis/bg/household-contacts.ts`).
4. **Phone.** A Contacts screen from the browser menu (`mobile/components/HouseholdContacts.tsx`,
   `RPC_APPS` `contacts`, `mobile/backend/lib/household-contacts.mjs`): tap one to call, text,
   email or copy the number; add and edit in a bottom sheet.
5. **The AI reads them.** `listContacts` (`query` optional) is a personal capability behind the
   `contactsRead` permission, asked once a turn, and a Job may read them (`JOB_GRANTS`). Its result is
   private data (`PRIVATE_READS`), so sending it to a site asks first (ADR-0037). The AI can't change
   them; it links `nomad://library/contacts`.

## Considered options

- **Put them in the existing Contacts list.** That list is Profile Drives in
  `hyper://private/address-book.json`, which is the user's alone and never shared. Making it
  household-wide would mean moving it into the Space Library and mixing two kinds of thing. Two
  lists on one page keep "people we call" and "people on Nomad" apart.
- **A Note.** House info is a Note today, and a phone number in it works. A record gives the phone
  a call button, the AI a search that finds "the plumber", and the calendar something to link later.

## Consequences

- The House info Note can still hold the Wi-Fi password and the bin days; numbers move to Contacts.
- Linking a calendar event to a contact (who's picking up, the dentist's number on the
  appointment) is left for later; the records allow it without a format change.
