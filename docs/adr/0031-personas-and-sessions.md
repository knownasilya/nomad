# Personas: the user's identities in the browser, and the Sessions a site gets by asking

**Status: Proposed.** 2026-10-31. Combines the Personas map ([#27]) and its eleven tickets
([#28]–[#38]) into one decision. Two of them were closed with answers ([#28], [#35]); the user
answered parts of three more in comments ([#29], [#31], [#33]). The rest are settled here as
proposals, each marked with the ticket it answers. Two prototypes ([#36], [#37]) must be built and
looked at before *Accepted*. Builds on ADR-0006 (the Vault), ADR-0010 (`nomad.fs`), ADR-0022 (pages
can't open the private drive) and ADR-0029 (Shared Spaces).

The user wants a drive to be able to ask "who are you?" with a button, and the browser to answer
with one of the user's identities: a default one for the whole Vault, and a different one for a
Space when they set it. The site keeps that login across reloads, the user can see and end it, and
a site never learns more about the user than they agreed to. We call such an identity a **Persona**
and the login a site holds a **Session**.

## Where things are today

- **The content half exists.** `walled.garden/person` (`app/lib/schemas/walled.garden/person.ts`:
  `title`, `description?`, `thumb?`, `links?`) is a **Profile Drive**, and CONTEXT.md already names
  it. Nothing in Nomad creates one, and `ident.profile` is only ever set on the legacy Hyperdrive
  branch of `getDriveIdentFull` (`app/bg/filesystem/index.js`), so it is `false` on every current
  install.
- **Beaker's session API is a corpse in this repo.** `app/lib/session-permissions.ts`,
  `app/fg/modals/create-session.js`, `user-select.js`, `user-editor.js` and
  `app/bg/web-apis/manifests/internal/users.ts` survive. The modals are still routed
  (`app/fg/modals/index.js`), so `modals.create(sender, 'create-session', …)` draws a prompt today;
  only the bg caller is gone. The full original (`bg/session.js`, `dbs/site-sessions.js`,
  `site-info/js/com/user-session.js`) is at `a271d0ea4^`.
- **Why Beaker dropped it** ([#35]): not on its merits. It shipped on 7 Sep 2020 and was deleted on
  10 Nov 2020 in `a271d0ea4`, one of a row of commits that cut Beaker's whole social layer three
  weeks before 1.0. It was never documented and had no users. So history neither supports nor warns
  against it; the code has to be judged as code, and it reads poorly: one global profile and no
  picker, all-or-nothing permission checks, a `wcTrust` path that returned the profile with no
  consent, and no expiry.
- **Nothing carries a user gesture** from a page to bg. The RPC gives bg only `this.sender`.
- **Pieces to build on:** the Vault (`app/bg/hyper/vault.js`) already indexes Spaces and Devices
  and has an unused `profileUrl` in its `meta.json`; per-origin permissions with one-sentence
  descriptions (`app/lib/permissions.ts` `renderPermDesc`); one write check for Autobase drives
  (`app/bg/web-apis/bg/fs-write-guard.ts`); one modal per tab and no modal from a background tab
  (`app/bg/ui/subwindows/modals.js`: `ModalActiveError`, `tab.awaitActive()`). `ownerId` is already
  reserved "for Personas" on the AI's catalog (`app/bg/ai/search-execute.mjs`, `bg/web-apis/bg/ai.ts`)
  and read by nothing.
- **ADR-0007's Writer Keys are gone.** CONTEXT.md still says a Profile Drive publishes
  `/.data/walled.garden/writer-keys.json`, but ADR-0010 Phase 4 deleted that code ([#31]).

## Decision

### 1. Two words, two things ([#28], closed)

- A **Profile Drive** is content: a Drive whose `/index.json` is `walled.garden/person`. It is public
  and replicates like any Drive.
- A **Persona** is browser state: it points at one Profile Drive, is bound to Spaces, and owns the
  Sessions sites hold. It is private to the user.

Neither replaces a Space or the Vault. A Persona is bound *to* a Space; it does not become one.

### 2. Two APIs: one a page can call, one only `nomad://` can ([#28], closed)

| Surface | Methods | Who can call it |
|---|---|---|
| `nomad.session` | `requestLogin(opts)`, `getCurrent()`, `revoke()`, a `change` event | any page |
| `nomad.personas` | create, list, update, delete, set the default, bind to a Space, list and end Sessions | `nomad://` pages only (`internalOnly`, like `nomad.vault`) |

Singular `session`, because a page has at most one. `requestLogin`, not Beaker's `request`, because
it can be searched for. `getCurrent` and `revoke` drop the noun the namespace already says.
`nomad.auth` is rejected: nothing here is authenticated in WebAuthn's sense, it is consent plus a
grant, and the name would teach drive authors the wrong model.

Keeping Persona management internal is a security rule, not style: a `personas.list()` a page could
call would hand every site the user's whole set of identities with no prompt ([#38]).

### 3. Personas live in the Vault ([#29], answered by the user)

The user's answer: "There is one persona set for the vault (default persona), but more could be
defined and set for a specific space (like an override)." That makes a Persona per-Vault, and the
Vault its home, which every Device already writes (option A in [#29]). The rules go in
`shared/personas.mjs`, used by desktop and the phone.

```
/.vault/personas/<id>.json      { type: 'nomad/persona', id, profileUrl, label, createdAt, updatedAt }
/.vault/persona-default.json    { type: 'nomad/persona-default', personaId, updatedAt }
/.vault/spaces/<rootKey>.json   gains   persona?: <id>          (the Space's override)
```

- `label` is the user's private name for it ("Work", "Me"), shown only in the browser. The name a
  site may see is the Profile Drive's `title`.
- The default is its own record, not a flag on each Persona, so two Devices that pick a default at
  the same time end with one default (last write wins), not two.
- The override sits on the user's own space record, so a Shared Space (ADR-0029) is bound per
  Member: each person picks their own Persona for it, and nothing about it goes in the Space Library.
- [#28] said a Persona "never replicates". With the Vault as its home that becomes: **a Persona
  never leaves the user's own Devices.** It is never written to a Drive anyone else reads, never to
  a Space Library, and never published. It has the same exposure as Notes.
- A newly paired Device learns every Persona once the Vault syncs. Until then it is in a
  **Vault not ready** state (see 5), which the UI says in words, not as "no Personas".

### 4. Which Persona a tab uses ([#30])

For a page in a tab, the Persona is:

1. the tab's Space's `persona`, if that Persona exists and is usable (5);
2. otherwise the Vault default, if usable;
3. otherwise none.

"None" changes nothing a page can see: `requestLogin()` still shows the prompt (7), which offers to
make a Persona.

- **Per Space, not per tab.** A tab already carries its `spaceId` (`bg/ui/tabs/manager.js`); the
  Persona follows it. No per-tab override in this version, so no new `STATE_VARS` slot for it.
- **This doesn't use `settings.getForSpace`.** That falls back to hard-coded defaults, not to a
  global value, and it's per-device sqlite. The binding has to follow the user across Devices, so it
  lives in the Vault and resolves as above.
- **Personal (Space 1) is not special.** It uses the default unless the user sets an override.
- **Deleting a Space** deletes its override and its Sessions. **Deleting a Persona** deletes its
  Sessions (each open page gets a `change` event); overrides that named it fall back to the default;
  if it was the default, there is none until the user picks one. The Profile Drive itself is never
  deleted with it: it's content, and the user may still want it.

### 5. A Persona's Profile Drive has no writers but the user's Devices ([#31], decided on the ticket)

A Profile Drive's URL is public. If a Persona could point at any `walled.garden/person` drive,
anyone could log into every site as someone else. Writable alone isn't enough either: on a
collaborative Drive every writer passes `base.writable`, and they can be different people. So:

- **The check:** `listWriters(profileDrive)` is a subset of the Vault's Device writer keys
  (`vault.listDevices()`). This turns what a site receives from a claim into an assertion.
- **It's checked when a Persona is made and on every `requestLogin`,** because a Drive that qualifies
  today stops qualifying when someone else is added as a writer.
- **Approving a writer on a Persona's Profile Drive warns first:** "This is the drive for your
  Persona *Work*. Adding another writer means you can't log in with it."
- **When it stops qualifying,** new logins with it are refused and My Library → Personas shows why.
  Sessions already granted stay until the user ends them: they were true when granted, and ending
  them silently would surprise the sites and the user.
- **Three states, not two:** usable, *foreign writers*, and *Vault not ready* (this Device hasn't
  seen all the user's Device keys yet). The last one must never tell the user their own identity is
  invalid.
- This rules out team and organisation identities on purpose (out of scope on [#27]).

### 6. What a Profile Drive holds ([#31])

- **`PersonSchema` is not extended.** Nothing in this design needs a new field, so the schema
  checklist (Zod file, `index.ts`, regenerated editor types) doesn't run.
- **An HTML page is just a drive.** A Profile Drive can serve a themed page through the manifest
  `fallback` (ADR-0015). Making a Persona creates a Drive with only `/index.json`; a profile
  template in nomad.dev is a later, separate change.
- **Writer Keys are not coming back.** Proving to *another peer* that many Device writers are one
  person is out of scope here ([#27]); this effort is a page asking its own browser. CONTEXT.md is
  corrected to say the code is gone.

### 7. The login prompt is the only way in ([#34], [#35], [#36])

No user-gesture bit is added to the RPC (option B in [#34]). Prior art doesn't support it: WebAuthn
requires transient activation only to *register* inside a cross-origin iframe (L3 §5.1.3); its
login path (§5.1.4.1) has none. What WebAuthn really guarantees is stronger: **there is no silent
path at all.** So the modal is the consent (option A), with these rules:

1. **No silent sibling.** Only the prompt makes a Session. `getCurrent()` returns a Session the
   prompt already made and has no path to making one. No trusted-sender shortcut either: a
   `nomad://` page that needs a Persona uses `nomad.personas`.
2. **The prompt looks the same whether or not the user has a Persona** (§14.5.2). With none, the
   same window offers "Make a Persona", then continues. A cancel, a "no", and having no Persona all
   reject with the same `UserDeniedError`, after the user acts, so a page can't probe for an
   identity.
3. **It names both sides** (§14.5.5): who is asking, and as whom you'll appear. For a `hyper://`
   site, bg reads the requesting drive's `index.json` title and thumb itself and shows the drive's
   key next to them, so a long or look-alike title can't pass for another site. An http(s) site shows
   its host.
4. **One Persona is not a form.** With one Persona the prompt is one row with a "Change" link; with
   several it's a short list with the resolved one (4) picked.
5. **Each permission is one sentence** through `renderPermDesc`, each with its own checkbox.
6. **Deny is as easy to hit as Allow**, same size, same row.

What stops a page that asks on load or in a loop: one modal per tab (`ModalActiveError`), a
background tab waits until it's in front (`awaitActive`), and **a denial is not remembered** (the
`persist: 'allow'` idiom), but within one page load a second `requestLogin()` after a "no" rejects
without a prompt, after the same delay a real "no" takes, until the page reloads or navigates.

The prompt is a new modal in the shell's look, light and dark. `create-session.js` is a reference,
not a base: it's light-only and names neither party.

### 8. What a site receives ([#38])

Two tiers, because a drive key can't be rotated without giving up the identity:

- **Tier 1, "you are someone, the same one each time".** Every Session has an `id`: 16 random bytes
  minted by the browser for this (origin, Persona, Space), base32-encoded, holding nothing derived
  from the user. Revoking the Session and logging in again gives a new one, so the user can make a
  site forget them.
- **Tier 2, "you are *you*".** The Profile Drive's URL, `title` and `thumb`, only when the page asks
  for the `profile` permission and the user leaves it checked.

```js
const session = await nomad.session.requestLogin({ perms: ['profile'] })
// { id: 'k3v…', perms: ['profile'], profile: { url: 'hyper://…/', title: 'Ada', thumb: '/thumb' },
//   createdAt: '2026-10-31T…' }
```

Said plainly, as [#35] asked: **tier 1 means nothing once a site has tier 2.** A name and a picture
are what WebAuthn §14.2 calls a "willfully reused username". Tier 1 is still worth its one random
value, because "a stable stranger" is a real use: per-site settings, saved state, a pseudonymous
comment, a game save. The API makes the stranger the default, and the profile a separate
line the user can uncheck.

Two Spaces are already two partitions and two Root Drives, so two Spaces with different Personas
look to a site like two people. Within one Space, a site has one Session at a time (the API is
singular); logging in as another Persona is done by switching the Space's Persona (10), not by a
second Session.

### 9. What a Session can grant, and where it is enforced ([#32])

- **The vocabulary is the existing permission tokens** (option B): `profile` (new, tier 2) and drive
  tokens such as `modifyDrive:<key>` for the Persona's own Profile Drive. Beaker's
  `{ prefix, extension, access }` grammar (option A) is rejected: its matching is exact and brittle,
  it changed eight days after launch, and the renderer that made it readable was deleted.
  `app/lib/session-permissions.ts` is deleted.
- **A Session only narrows.** It can hold only tokens the user could already grant that origin with
  a normal prompt; tokens that re-prompt every time (`persist: false`, such as `createDrive`) can't go
  in a Session. A Session never gets the Persona's own authority.
- **Partial grants are normal** (OAuth, RFC 6749 §3.3). `requestLogin` returns what the user left
  checked in `perms` and never fails because something was unchecked. "Logged in with less" is not
  "logged out".
- **One enforcement point.** The permission engine (`app/bg/ui/permissions.js`) answers yes when
  sitedata or the origin's live Session in this Space grants the token. `fs-write-guard.ts` and
  everything else keep asking the engine; nothing reads a Session directly.
- **Nothing on `hyper://private/`.** A Session can't grant anything there; ADR-0022's rule stands.

### 10. Where Sessions live, how long, and how they end ([#33], answered by the user)

The user's answers on [#33]: Sessions go in the Vault, the key is (origin, Persona, Space), and
revocation is an event.

```
/.vault/sessions/<spaceKey>/<personaId>/<sha256(origin)>.json
  { type: 'nomad/session', id, origin, personaId, space, perms, createdAt, expiresAt? }
```

- **In the Vault,** so logging into a site on the laptop logs you in on the desktop too, and ending
  it on one ends it on both.
- **Keyed by (origin, Persona, Space).** A page sees the one for its Space's current Persona. So
  switching a Space's Persona doesn't destroy anything: the page's `getCurrent()` becomes the other
  Persona's Session, or `null`, and switching back brings the first one back.
- **No expiry by default.** Re-auth can never be silent (7), so expiry would mean prompts on a timer.
  A page may ask for less (`requestLogin({ maxAge })`), never more. My Library shows when each was
  granted so the user can clear old ones.
- **Revocation is an event, the page decides what to do.** `nomad.session` fires `change` with the
  new Session or `null` whenever it changes: the page called `revoke()`, the user ended it in
  site-info or My Library, the Persona was switched or deleted, or another Device ended it (Vault
  sync). Its permissions stop working at once; there's no forced reload (`requiresRefresh: false`).
  The page can reload, show a login button, or anything else.

### 11. Where the user sees and changes it ([#37])

- **My Library → Personas** (`nomad.personas`): make one (a new Profile Drive, or one of the user's
  own that passes 5), rename, delete, pick the default, pick each Space's Persona, and list and end
  Sessions. The Spaces menu gets "Persona for this Space".
- **Always visible at window level:** the Spaces button shows the current Persona's thumb. An
  identity that's always on screen helps against phishing, and the window is where a Persona
  actually varies.
- **Per site only when there's a Session:** an icon in the location bar, like the Draft pen-nib
  (`renderDraftBtn`), that opens site-info's Session section (who you are here, what it can do,
  Log out).

The prototype ([#37]) shows the always-on and only-with-a-Session versions side by side before this
is final.

## Amendment: a site can ask for the Persona's email (2026-11-02)

Ordinary web sites often need a way to reach the user, and a profile drive gives them none. So a
Persona can have an email, and a site can ask for it as a third permission, `email`.

- **On the Vault record, never in the Profile Drive.** Anyone with a Profile Drive's URL can read it
  (6), so an address there would be public. `email` is a field of `/.vault/personas/<id>.json`
  (`normalizeEmail` in `shared/personas.mjs`), set in My Library → Personas or typed in the login
  prompt for a Persona that has none. It syncs to the user's Devices like the rest of the record.
- **Its own permission.** `requestLogin({ perms: ['email'] })` gets its own checkbox in the prompt,
  which the user can uncheck (9). It stands apart from `profile`: a site can have the email and not
  the profile, or the reverse. A page gets `session.email`, read from the Persona each time, so a
  changed address reaches the site and fires `change`. A Persona with no email gives none, and the
  Session doesn't hold `email`.
- **Said plainly, like tier 2 (8).** One address given to two sites ties them together, which undoes
  the per-site `id`. The prompt and My Library say so. A Persona for each context, each with its own
  address, is the answer today; per-site aliases (a relay that forwards mail) would be a new ADR.
- **Not verified.** Nomad can't prove the address is the user's. A site that needs proof sends its own
  code; the docs say so.
- **Nothing else changes.** `email` isn't a browser permission: the permission engine never asks for
  it, and no other API reads it. Pages still can't list Personas.

## Amendment: make and edit a Persona on any Device (2026-11-02)

A user who has only their phone with them should be able to make a Persona there, and a Persona
should be edited the same on every Device, whichever one made it. My Library → Personas on the phone
gets a **New Persona** form (a name, a picture, a few words, a private label and an optional email)
and, for each Persona, Edit and Delete, as on the computer.

- **The phone makes and writes a Profile Drive** like a computer does: an Autobase drive with only
  `/index.json` (`profileManifest` in `shared/personas.mjs`) and the picture as `/thumb.<ext>`
  (`parseThumb`: PNG, JPEG, WebP or GIF, 2 MB at most; the phone crops it square and saves a 512px
  JPEG). The Vault record is the same (`savePersona` in `mobile/backend/lib/vault-apps.mjs`), with the
  drive key as `creator`, and the first Persona made anywhere becomes the default. The email stays
  on the record, never in the drive. The phone seeds the drive so a computer can fetch it.
- **Every Device writes every Profile Drive.** This changes 5: a Profile Drive's writers are still
  only the user's Devices, but now all of them, not just the one that made it. A Device that can't
  write a Persona's drive yet puts its writer key for that drive in the Vault as an **ask**,
  `/.vault/persona-writers/<driveKey>/<writerKey>.json` `{ drive, writerKey, device, requestedAt }`.
  A Device that writes the drive adds it (`addWriter`) and marks the ask granted (`grantedBy`,
  `grantedAt`). Only the user's Devices write the Vault, so an ask from a Device the Vault lists needs
  no prompt, like a Root Drive's fan-out. The writer check counts a granted ask's writer key as the
  user's own (`ownWriterKeys`, `profileState({ ownWriters })`). When a Device leaves the Vault, a
  Device that writes the drive takes its writer off and drops the ask (`writerAsksToRevoke`), and
  until then the drive reads as `foreign-writers`. Only a drive one of the user's Devices made
  (`creator` is the drive key) takes part. Desktop runs this in `bg/ui/personas.js` (`syncWriters`),
  the phone in `backend.mjs` (`syncPersonaWriters`), on every Vault change.
- **Until the add arrives**, the name, picture and words are locked on the new Device (the label and
  email, being Vault fields, can change at once), and the form says to keep the Device that made the
  Persona online for a minute. Deleting a Persona drops its asks.

## Considered options

- **Personas in sqlite** ([#29] B). Cheap and no wire concerns, but a new Device wouldn't know your
  Personas, and the user wants one default across the Vault.
- **Personas in the Drive Registry** ([#29] C). No new storage, but `/drives.json` belongs to one
  Space, so it makes Personas per-Space and rules out the Vault default.
- **One public `nomad.personas` with `requestLogin` on it.** Puts enumeration within reach of pages.
- **A real gesture bit through the RPC** ([#34] B). More work, and the standard it was meant to copy
  doesn't require it for login. The "no silent path" rules do the job.
- **One URL for everyone** ([#38]). Simple, and every pair of sites can correlate you forever.
- **Per-Persona "public or scoped" chosen at creation** ([#38]). Moves a per-site choice to a moment
  when the user can't know which sites will ask.
- **Reviving `session-permissions.ts`** ([#32] A). See 9.
- **A Session key per origin only** ([#33]). Leaks across Spaces, which already isolate cookies and
  storage.
- **Reload pages on revoke.** Simple, but takes the choice away from the page; an event lets it
  reload if it wants.

## Consequences

- A new public API: the sync triad applies (nomad.dev `docs/api/apis/nomad.session.md`,
  `API_REFERENCE` in `app/bg/ai/api-reference.mjs`, `nomad-dts.js`), plus the usual files for an
  external API (manifest, impl, `bg.ts`, `fg/external.ts`, `permissions.ts` for `profile`).
  `nomad.personas` is internal and needs only its manifest and impl.
- The Vault gains three record kinds. Session records are small, but every login and logout is a
  Vault write.
- A Session is only as private as the Vault: anyone who can read the user's Vault can see which
  sites they've logged into. That's the same trust as Notes and Reader.
- Writer requests and Shared Space members already carry an optional `profileUrl` that nothing fills
  in (`autobases.js`, `shared/space-library.mjs`). The current Persona is the natural value, but
  sending it tells the other side who you are, so it's a separate decision.
- Team and organisation identities can't be Personas.
- Beaker's dead code goes: `session-permissions.ts`, `manifests/internal/users.ts`, `user-editor.js`,
  `user-select.js` and `create-session.js` are deleted once the new prompt lands.
- Existing users start with no Persona. The old address book's `profiles[0]` is already deleted on
  upgrade (`migrateAddressBook`), and Nomad never created Profile Drives, so there's nothing to carry
  forward.

## Still open

- **The AI and the Persona.** Whether a turn should know the current Persona (`ownerId` is reserved
  and unread). Not in this version: a page's `nomad.ai.chat()` must not learn it, and the user's own
  AI doesn't need it yet.
- **The phone.** It sees Personas and Sessions as soon as the Vault syncs (`mobile/backend/lib/
  vault-apps.mjs`), can list and end them, and can make, edit and delete Personas (amendment above). `nomad.session` in the phone's WebView, with its own
  prompt, comes after desktop.
- **Concurrent Sessions as two Personas on one origin in one Space.** Ruled out by the singular API.
  If a real need appears, it's a new ADR, not a quiet change.

## Prototypes before *Accepted*

- **P1, the login prompt** ([#36]): one Persona, several, and none; a long and a look-alike drive
  title; a `profile` request unchecked; light and dark.
- **P2, the switcher** ([#37]): the Spaces button with the Persona thumb, the location-bar icon, and
  the always-visible against only-with-a-Session versions side by side.

## Rollout

1. **Records and management.** `shared/personas.mjs` (records, resolution order, the writer check,
   the Session key) with unit tests; the Vault records; `nomad.personas`; My Library → Personas;
   CONTEXT.md entries.
2. **Login.** `nomad.session`, the prompt, the permission-engine hook, the `change` event, site-info's
   Session section, the docs and types. Delete Beaker's session code.
3. **Switching.** The Spaces menu entry, the Persona thumb on the Spaces button, the location-bar icon.
4. **Phone.** List and end Sessions; then `nomad.session` in the WebView.

## Source issues

- [#27] Personas (the map)
- [#28] Name the thing: Persona vs Profile Drive (closed)
- [#29] Where a Persona lives
- [#30] Binding a Persona to a Space, and the resolution order
- [#31] What a Persona's Drive must contain
- [#32] What a Session can be granted
- [#33] Session lifetime, storage, and revocation
- [#34] What makes a login "user initiated"
- [#35] Prior art: browser-mediated identity handoff (closed)
- [#36] Prototype the login prompt
- [#37] Prototype the Persona switcher
- [#38] Does every site see the same Persona?

[#27]: https://github.com/knownasilya/nomad/issues/27
[#28]: https://github.com/knownasilya/nomad/issues/28
[#29]: https://github.com/knownasilya/nomad/issues/29
[#30]: https://github.com/knownasilya/nomad/issues/30
[#31]: https://github.com/knownasilya/nomad/issues/31
[#32]: https://github.com/knownasilya/nomad/issues/32
[#33]: https://github.com/knownasilya/nomad/issues/33
[#34]: https://github.com/knownasilya/nomad/issues/34
[#35]: https://github.com/knownasilya/nomad/issues/35
[#36]: https://github.com/knownasilya/nomad/issues/36
[#37]: https://github.com/knownasilya/nomad/issues/37
[#38]: https://github.com/knownasilya/nomad/issues/38
