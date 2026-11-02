# Vouches: one Persona says "I've had this person over at my home"

**Status: Proposed.** 2026-11-02. Builds on ADR-0031 (Personas and Sessions, implemented in [#128]),
ADR-0036 (the Persona Inbox, proposed in [#129]), ADR-0013 (followers are subscriber-side) and
ADR-0018 (Names). Amends ADR-0031 §8 and §9 (a new `vouches` permission on `nomad.session`) and
ADR-0036 §5 (a Message can carry a Vouch).

The user wants a way to say that an account belongs to a real person, and a decent one, the way
people do it offline: "I've had them over at my house." So one Persona can give another a
**Vouch**, a small record that says exactly that. The person it's about decides whether to keep it
and who sees it, the person who gave it can take it back, and the person looking at it decides how
much it's worth by whether they know who gave it.

This is not proof of personhood. A group of fake accounts can vouch for each other as much as they
like, and nothing here stops one person from running two Personas. What a Vouch proves is narrower
and honest: **"someone you already trust says so."** Nomad shows it that way and never as a badge
that means "verified".

## Where things are today

- **A Persona is a Vault record pointing at a Profile Drive** (`shared/personas.mjs`). The Profile
  Drive is public; its writers are the user's own Devices (ADR-0031 §5), so what it says is the
  user's word. Nothing in it says anything about another person.
- **There's no way to make a claim about someone else.** The closest things are a Follow (private,
  one-sided, ADR-0013) and a Contact in the Inbox (private, ADR-0036). Neither can be shown to anyone.
- **The Inbox is proposed, not built.** ADR-0036 gives a Persona a sealed, signed way to reach
  another. Vouches use it to deliver, so they ship after it (Rollout).
- **Sessions already have a per-permission prompt** (ADR-0031 §7, §9) with partial grants and one
  checkbox per permission, and a site already gets the Profile Drive with `profile`.

## Decision

### 1. Words

- A **Vouch** is one `walled.garden/vouch` record: one Profile Drive (the **host**) says it has had
  another (the **guest**) over at home, with an optional note.
- **Giving** a Vouch is the host's act. **Accepting** it is the guest's. A Vouch the guest hasn't
  accepted shows nowhere.
- **Standing behind** a Vouch is the host's Profile Drive listing its hash (§4). A Vouch the host no
  longer lists is **withdrawn**.

### 2. One kind, no counts, no ratings

There is one kind, `hosted`, and the record says nothing else about the relationship:

```ts
// app/lib/schemas/walled.garden/vouch.ts
export const VouchSchema = z.object({
  type: z.literal('walled.garden/vouch'),
  v: z.literal(1),
  id: z.string().min(16).max(40),     // 16 random bytes, base32
  kind: z.literal('hosted'),
  host: z.url(),                      // the host's Profile Drive, hyper://<key>/
  guest: z.url(),                     // the guest's Profile Drive
  note: z.string().max(280).optional(), // plain text, shown, never rendered or fetched
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),        // issuedAt + 1 year
});
```

- **No visit count and no in-person check.** A count is a number the host types, so it adds nothing
  the Vouch doesn't already say, and invites "how many times" comparisons. A check that two phones
  were in one room (a QR scan) proves co-presence, not character, and a group of fake accounts can
  fake it as easily as anything else. The Vouch's weight is who gave it (§6), and both of these
  would only look like more.
- **No ratings and no negative Vouches.** "Untrustworthy" and "1 star" are how a reputation system
  becomes a harassment tool: they can be organised, they can't be answered, and they get the person
  they're about nothing. Absence of a Vouch is the only negative, and Block (ADR-0036 §3.4) is the
  tool for someone you don't want near you.
- **One kind, so the schema can grow.** Other kinds ("known in person since", "worked with") are a
  later decision with their own wording, added as new `kind` literals. They are left out now so the
  one meaning stays plain.
- **No address, no dates of visits, no place.** A Vouch must never help anyone find the host's home.

### 3. Giving and accepting

1. **The host gives it from the guest's Profile Drive.** site-info on a Profile Drive gets
   **I've had them over**, which opens a short form: the host's Persona (the tab's, ADR-0031 §4, with
   Change), an optional note, and one sentence that says what giving means (§5): *"Sam can show this
   to sites and on their profile, with your name on it."* Only a `usable` Persona (ADR-0031 §5) can
   give one.
2. **Giving writes three things:** the record in the host's Vault (§7), its hash in the host's
   Profile Drive (§4), and a Message to the guest's Inbox that carries the record (ADR-0036 §5
   amended: `vouch?: Vouch`, and `text` may be empty when it's present).
3. **Delivery follows the Inbox's rules.** A host who isn't one of the guest's Contacts lands in
   Requests like any stranger. If the guest's Inbox is Off and the host isn't a Contact, the form
   says so before sending: *"Sam isn't taking messages. Ask them for a message link."* There is no
   other way in, on purpose: a Vouch is a message to a person, and the person decides who reaches
   them.
4. **The guest accepts or declines.** A received Vouch waits in My Library → Personas → Vouches (and
   the phone's Personas screen) as *New*, shown with the host's title, picture **and drive key**, the
   same way the login prompt names a site (ADR-0031 §7.3). Before it's shown, the guest's Device
   checks it (§4) and that `guest` is the Persona it arrived for; one that fails is dropped.
   **Accept** keeps it. **Decline** deletes it. Neither is sent to the host, like Accept and Ignore
   on a Message request (ADR-0036 §6.4).
5. **Why acceptance matters.** Without it, anyone could attach themselves to anyone: a stalker
   "vouching" that they've had someone over is a claim about the guest, and it's the guest's to
   refuse.

### 4. Standing behind it: a list of hashes in the host's Profile Drive

The host's Profile Drive holds the hashes of every Vouch the host still stands behind:

```
/.data/walled.garden/vouches-given.json
  { type: 'walled.garden/vouch-index', v: 1, hashes: ['<hex sha256(canonicalJSON(vouch))>', …] }
```

A Vouch is valid when its hash is in its `host`'s list and `expiresAt` hasn't passed. Checking needs
nothing but the record and the host's drive, so a site, another browser or another app can do it.
`verifyVouch(vouch, index, now) → 'valid' | 'withdrawn' | 'expired' | 'unreachable'` is one pure
function in `shared/vouches.mjs`.

- **Why a list and not a signature.** ADR-0036's `sign` key rotates with **Change inbox address**,
  which would break every Vouch the Persona gave. The Profile Drive is the one stable thing a Persona
  has, and its writer check (ADR-0031 §5) already makes it the host's own word. A list also makes
  withdrawal the same act as giving: remove the hash.
- **Why hashes, not names.** The list says nothing about who the Vouches are for. A hash can't be
  guessed back to a guest because the record has a random `id`. What the list does reveal is how many
  Vouches the host has out; that's stated in the UI and accepted for this version.
- **An allow-list, not a revocation list.** Absence means not valid, so a lost or truncated list
  fails closed. A host drive nobody can reach right now gives `unreachable`, which is shown as
  *"Couldn't check"* and never as valid.
- **What a third party can't learn.** Whether the host's drive has writers other than the host's own
  Devices is only checkable by the host (ADR-0031 §5). So to a site, a Vouch means "the writers of
  this Profile Drive say so". For a Persona that's one person; the docs say it in those words.
- **The host's Devices guard the list.** Every time the Profile Drive syncs, a Device checks each
  hash against the Vouches it gave (§7). A hash it didn't write means someone else can write the
  drive, and it tells the user, like ADR-0036 §7.3: *"Someone added a vouch to your Persona Work."*

### 5. Who sees an accepted Vouch

Private by default. Who has been in whose home is a sensitive piece of the social graph, the same
reason ADR-0013 never builds a follower list. The guest picks, per Vouch:

| Shown | Where | Who can see it |
|---|---|---|
| **Only me** (default) | the guest's Vault | the guest's own Devices |
| **To sites I log into** | `session.vouches`, per login | a site the guest picks it for in the login prompt |
| **On my profile** | the guest's Profile Drive, `/.data/walled.garden/vouches.json` | anyone with the Profile Drive's URL |

- **To a site.** `requestLogin({ perms: ['profile', 'vouches'] })`. The prompt lists the guest's
  accepted Vouches with a checkbox each, **all unticked**, under one sentence: *"Shows who has had you
  over. The site will see their names."* The site gets the records it was given and checks them
  itself (§4). `vouches` needs `profile` (each record names the guest's Profile Drive), so ticking a
  Vouch ticks `profile`, and unticking `profile` unticks them. Partial grants stay normal (ADR-0031
  §9): a site that asked and got none still has a Session.
- **On the profile.** `{ type: 'walled.garden/vouches', v: 1, items: [Vouch, …] }`. Turning one on
  says plainly that it's public and permanent in the way anything once published is.
- **The trade-off, said once.** Showing a Vouch shows who gave it. So giving one has to mean *"I'm
  fine with Sam showing my name"*, and the giving form says it (§3.1). Per-viewer rules ("only show
  my name to people who know me") would need the guest to know the viewer's graph; they're left out.
- **Not a Vault-wide setting.** A Vouch belongs to one Persona. A guest with a "Work" and a "Me"
  Persona keeps their Vouches apart.

### 6. Weight comes from the viewer, never a score

Nomad shows Vouches relative to the person looking, and never computes a number:

- **Vouches from people you know** are shown by name: *"Maya has had Sam over."* "People you know"
  is the viewer's Contacts (ADR-0036), Names that point at a Profile Drive (ADR-0018), and Profile
  Drives the viewer follows (ADR-0013). All three are the viewer's own private data, read on their
  own Device.
- **Vouches from anyone else** are folded into one line, *"2 more from people you don't know"*, which
  opens to titles, pictures and drive keys. They're not hidden, only not counted for anything.
- **No total, no badge, no "verified".** A total counts fake accounts as easily as real ones, and a
  badge tells the viewer to stop thinking. Withdrawn and expired Vouches aren't shown at all.
- **No friends-of-friends in this version.** "Vouched for by someone Maya vouched for" is the obvious
  next step and the first thing a ring of fakes would exploit; it needs its own decision.

Where it's shown: site-info's identity panel on a Profile Drive (`userland/site-info/js/com/identity.js`)
reads the drive's `vouches.json`, checks each, and groups them as above. The phone shows the same
on a Profile Drive's info sheet.

### 7. Records, expiry and withdrawal

```
/.vault/vouches-given/<personaId>/<id>.json
  { type: 'nomad/vouch-given', vouch, createdAt, withdrawnAt? }
/.vault/vouches-held/<personaId>/<id>.json
  { type: 'nomad/vouch-held', vouch, state: 'new' | 'accepted', shown: 'me' | 'sites' | 'profile',
    receivedAt, acceptedAt? }
```

- **A year, then it ends.** Relationships change, and an old Vouch from someone who'd no longer give
  it is worse than none. A month before `expiresAt`, My Library shows the host **Renew** on it.
  Renewing keeps `id`, sets new dates, swaps the hash and sends the new record; the guest's Device
  replaces an accepted Vouch with the same `id` from the same host without asking again.
- **Withdraw is quiet.** The host removes the hash and marks the record `withdrawnAt`. Nothing is
  sent. The guest's own list shows it as no longer valid next time it's checked, since anyone can
  check, but there's no notification, so a falling-out isn't announced.
- **Deleting a Persona** withdraws everything it gave (empties `vouches-given.json`), deletes what it
  held, and removes `vouches.json` from its Profile Drive, after a confirm that says so.
- **A guest can remove a held Vouch** at any time. If it was on the profile, it comes off.

### 8. Abuse

| Abuse | What stops or limits it |
|---|---|
| Someone attaches themselves to you ("I've hosted her") | nothing shows until the guest accepts (§3.5) |
| A ring of fake accounts vouching for each other | weight comes from the viewer's own graph (§6); no total, no badge |
| A look-alike host ("Maya" with Maya's picture) | the drive key is always shown; a Name or Contact only matches the real drive |
| Pressure to give or accept one | declining and withdrawing are silent (§3.4, §7) |
| Bad-mouthing someone | there are no negative Vouches (§2) |
| Finding where someone lives | a Vouch has no place, dates of visits or address (§2) |
| Mapping who knows whom | private by default (§5); the hash list names nobody (§4) |
| A site demanding Vouches to let you in | every Vouch is unticked in the prompt and partial grants are normal; Nomad can't stop a site from refusing, and the docs say so |
| Someone else gaining write on the host's drive | the host's Devices flag a hash they didn't write (§4) |
| Spam Vouches from strangers | they arrive as Message requests, with the Inbox's limits (ADR-0036 §6) |

### 9. The AI and pages

- **No page API besides the permission.** A page can't give, list or accept Vouches; it only gets
  the ones the user ticks at login. `nomad.personas` (internal) gains the management calls.
- **The user's AI gets nothing in this version.** Giving a Vouch speaks for the user about another
  person, which is the kind of authority ADR-0036 §7.1 keeps from Sessions; the same reasoning keeps
  it from a personal turn that a hostile page or Message could steer. A page's `nomad.ai.chat()` never
  sees them.

### 10. Code layout

- `shared/vouches.mjs`: record paths, `makeVouch`, canonical JSON and the hash, `verifyVouch`, the
  renewal and expiry rules, and `groupForViewer(vouches, knownProfiles)`. Pure; crypto comes from the
  caller, as in `shared/personas.mjs`. Tests `tests/unit/vouches.test.js`, including a golden hash so
  desktop, phone and third parties agree on the bytes.
- `app/lib/schemas/walled.garden/vouch.ts`, `vouch-index.ts` and `vouches.ts`, through the usual
  checklist (`index.ts`, regenerated editor types, `walled-garden-schemas.md` on nomad.dev).
- `app/bg/ui/personas.js`: giving, the hash list, the guard check, renewal; `nomad.personas` gains
  `listVouches`, `giveVouch`, `renewVouch`, `withdrawVouch`, `acceptVouch`, `declineVouch`,
  `setVouchShown`.
- `bg/web-apis/bg/session.ts` and `app/fg/modals/persona-login.js`: the `vouches` permission and its
  checkboxes. A public API change, so the sync triad applies: nomad.dev `nomad.session.md`,
  `API_REFERENCE`, `nomad-dts.js`.
- The phone: Vouches on the Personas screen (`mobile/components/Personas.tsx`, `RPC_APPS`
  `personas`), built from `ListSection`/`ListRow` and `ActionSheet` for Accept / Decline / Show.

## Considered options

- **An in-person check (QR scan between phones) and a visit count.** Proposed first and turned down by
  the user. Both look like more proof than they are (§2).
- **Signing with the Inbox `sign` key.** Portable without the host's drive, but rotating the inbox
  address would break every Vouch (§4).
- **Publishing Vouches in the host's drive by name.** Simple to check, and a public map of whose home
  each person has been in. Rejected for the reason ADR-0013 gives.
- **A global trust score (PageRank over Vouches).** Easy to game with a ring, opaque to the person
  scored, and a number people would come to fear. Rejected (§6).
- **Several kinds and free ratings from the start.** More to say, more to abuse. One kind first (§2).
- **No acceptance step.** Fewer steps, and anyone could tie their name to anyone's (§3.5).
- **A revocation list.** Fails open when the list can't be read; the allow-list fails closed (§4).
- **No expiry.** Fewer renewals, and Vouches that outlive the relationship (§7).

## Consequences

- Three schemas (`walled.garden/vouch`, `vouch-index`, `vouches`) and one field on
  `walled.garden/message`; no change to the Autobase wire format.
- A new permission on a public API, so the sync triad and the login prompt change.
- Two Vault record kinds; every give, accept, renew and withdraw is a Vault write, and giving also
  writes the host's Profile Drive.
- A host's Vouch count is public (§4). Padding the list with random hashes would hide it and is left
  for later.
- Vouches can't be given until the Inbox (ADR-0036) ships.

## Still open

- **Friends of friends** in how Vouches are weighed (§6).
- **Other kinds** ("known in person since", "worked with").
- **Showing a Vouch to one person** (sending it over the Inbox) rather than to a site or everyone.
- **Hiding the count** of Vouches a host has out (§4).

## Rollout

1. **Rules and records.** `shared/vouches.mjs` with tests and a golden hash, the schemas, the Vault
   records, CONTEXT.md entries (Vouch).
2. **Give and accept on desktop**, after ADR-0036's desktop send and receive: site-info's
   *I've had them over*, My Library → Personas → Vouches, the hash list and its guard.
3. **Show.** The `vouches` permission and prompt rows, `vouches.json` on the profile, site-info's
   grouped display.
4. **Phone.** Accept, decline and choose where each is shown; the display on a Profile Drive.
5. **Docs.** nomad.dev: a Vouches page under Personas that says what a Vouch does and doesn't prove,
   the schema entries, and `vouches` on the `nomad.session` page.

[#128]: https://github.com/knownasilya/nomad/pull/128
[#129]: https://github.com/knownasilya/nomad/pull/129
