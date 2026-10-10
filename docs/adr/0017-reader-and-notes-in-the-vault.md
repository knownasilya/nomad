# Reader subscriptions and Notes live in the Vault

**Status: Accepted.** 2026-10-09.

The built-in Reader keeps its subscriptions and read marks, and the built-in Notes app keeps its
notes, in the **Vault**. Each Device the user links, the phone too, reads and writes the same data.
The record layout and the rules both apps share (titles, links, conflicts) are in
`shared/vault-apps.mjs`, and the layout is in `docs/multi-device-protocol.md` §1.2.

## Why

The user wants their feeds and notes on every Device, the phone included. The private Root Drive
copies to linked Devices, but a Device can't write to a Root Drive it was linked into
(multi-device-protocol §3: one exclusive writer core per Device, which the Vault holds). Every Device
can write to the Vault. Drafts already live there for the same reason (ADR-0012). Moving the data to
the private drive was considered and rejected: the phone would only be able to read it until §3 is
fixed.

## Decision

1. **In the Vault.** Subscriptions are records under `/.vault/reader/<space>/follows/`, read marks
   are one record at `/.vault/reader/<space>/read.json`, and notes are records under
   `/.vault/notes/`. One record per Feed and per Note, so two Devices that change different ones
   never overwrite each other. Writers merge the read marks; they never replace them.
2. **Subscriptions belong to a Space; notes belong to the user.** `<space>` is the Space's Root
   Drive key, so each Space keeps its own feeds, as before this ADR. When a Space's Root Drive moves,
   its subscriptions move with it (`vault.moveSpaceRoot`).
3. **The first write makes a Vault.** A Device with no Vault gets one when Reader or Notes first
   saves something. Such a Vault, made here and joined by no other Device, is **solo**. A solo Device
   can still join another Device's Vault: `adoptVault` leaves the solo Vault and copies its Reader
   data, Notes, and Drafts across once the new Vault is writable (`vault_carry_from`). A Device that
   joined a Vault is never solo, since its writer core belongs to that Vault.
4. **Old Reader data is copied in once per Space.** The Reader used to keep its data in the Space's
   private drive. The first read of a Space's subscriptions copies that file in and writes
   `/.vault/reader/<space>/imported.json`, so a feed the user then drops doesn't come back.
5. **Notes are Markdown, linked the Obsidian way.** A Note's first line is its title. Notes link
   with `[[Title]]`, `[[Title#Heading|text]]`, or a relative Markdown link `[text](Title.md)`. A link
   to a missing note creates it. Retitling a note updates the links to it. The editor is Live
   Preview on CodeMirror 6 (`app/userland/notes/js/editor/`), and the phone runs the same editor in
   a WebView.
6. **No edit is lost to a concurrent edit.** Each save names the version it started from. If another
   Device saved the Note since, the edit is stored as a conflict copy: a new Note with `conflictOf`
   and "(conflict copy)" on its title line (`planNoteSave`).

## Consequences

- ADR-0013 still holds. A Follow is still written only on the follower's side, in data only the
  user's own Devices can read. The Vault is never Listed or published as a site.
- Each save appends the whole Note to the Vault's log, and the log is never compacted. Notes save
  after a pause in typing, and are capped at 100,000 characters (`MAX_NOTE_LENGTH`).
- The internal `nomad.vault` API (nomad:// pages only) gains the Reader and Notes methods. Drive
  pages can't reach them, and neither can the phone's WebViews (the phone uses `RPC_APPS`).
- The phone can't make a Vault. Reader and Notes on the phone need it to be linked.
- Notes depends on CodeMirror 6 (root devDependencies, bundled into `notes/js/main.build.js` and
  into the phone's page, `mobile/lib/noteEditorHtml.ts`, by `npm run build:note-editor`).
