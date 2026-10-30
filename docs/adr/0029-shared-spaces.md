# Shared Spaces: a Space's own library, shared with other people

**Status: Proposed.** 2026-10-30. Builds on ADR-0006 (the Vault), ADR-0017 (Reader and Notes in the
Vault), ADR-0018 (Names) and ADR-0026 (per-drive writer keys and Writer grants). Spike S1 passed
(below); S2 is still open.

The user wants a Space to have its own library: its own Drives, Contacts, Bookmarks, Reader feeds,
Notes and Names, next to the ones that belong to the user in every Space. Then they want to share a
Space with another person, who either **can view** everything in it or **can edit** everything in it.
A viewer can ask for write access to one Drive, and what they get is limited to that Space.

## Where things are today

| Item | Scope | Stored in |
|------|-------|-----------|
| Drives and Contacts | Space | the Space's Root Drive, `/drives.json` (contacts are tagged `contact`) |
| Bookmarks | Space | the Space's Root Drive, `/bookmarks/<slug>.json` |
| Reader feeds | Space | the Vault, `/.vault/reader/<space>/follows/` |
| Reader read marks | Space | the Vault, `/.vault/reader/<space>/read.json` |
| Notes | user | the Vault, `/.vault/notes/` |
| Names | user | the Vault, `/.vault/names/` |
| Highlights, Mods, Drafts, open tabs, settings | user or Device | the Vault |
| History, downloads | Device | local SQLite |

Neither store can be shared with another person:

- **The Vault** holds the user's Devices, Notes, Drafts and settings. Its key reads all of it, and
  every Writer of it is one of the user's Devices (ADR-0006). Giving its key to anyone else gives
  them the account.
- **The Root Drive** is the Space's `hyper://private/`. Pages keep data there with the user's
  permission (ADR-0022), and the AI Sidebar keeps its chats there. A member must never read it.

## Decision

### 1. Every library item belongs to the user or to one Space

The user's items show in every Space, as today. A Space's items show only in that Space. My Library,
Notes and Reader show both, in two sections: the Space's name ("Work") and **All Spaces**.

- **Already per Space:** Drives, Contacts, Bookmarks and Reader feeds. Nothing changes for them.
- **Newly per Space:** Notes and Names. Each can be the user's (today's behaviour) or the Space's.
  In a Space that isn't shared, a new Note or Name is the user's, with **Only in Work** to make it
  the Space's. In a shared Space, a new Note goes to the Space and shows who can see it ("Shared
  with 2 people"), with **Keep private** to make it the user's. Names stay the user's by default
  everywhere, because a Name is a navigation shortcut.
- **Always the user's:** Highlights, Mods, Drafts, settings and Reader read marks. Read marks are
  each person's own, even in a shared Space.
- **Moving an item** between the Space and All Spaces is a menu action on the item.

An unshared Space keeps its new Space-only Notes and Names in the Vault, in one subtree per Space:

```
/.vault/space-lib/<space>/notes/<id>.json     same record as /.vault/notes/<id>.json
/.vault/space-lib/<space>/names/<name>.json   same record as /.vault/names/<name>.json
```

`<space>` is the Space's Root Drive key, as for Reader feeds. The records and rules are the ones in
`shared/vault-apps.mjs` and `shared/names.mjs`; only the prefix changes. Every Device of the user
can write them, which is why they go in the Vault and not the Root Drive (multi-device-protocol §3).

### 2. A shared Space keeps its library in a Space Library

Sharing a Space creates its **Space Library**: a new Autobase with the same reducer and wire format
as every Drive (`shared/fs-core.mjs`, `FS_FORMAT_VERSION 1`), so no format change. It holds
everything a member should see, with the same layout as above, at its root:

| Path | Payload (inline JSON) |
|------|-----------------------|
| `/index.json` | `{ type: 'nomad/space', name, icon, color, createdAt }` |
| `/drives.json` | `{ drives: [...] }`, the Space's Drive Registry (Contacts tagged `contact`) |
| `/bookmarks/<slug>.json` | `{ type: 'nomad/bookmark', href, title, createdAt }` |
| `/reader/follows/<host>.json` | `{ url, addedAt }` |
| `/notes/<id>.json` | a Note record (`shared/vault-apps.mjs`) |
| `/names/<name>.json` | a Name record (`shared/names.mjs`) |
| `/.space/members/<memberId>.json` | `{ memberId, name, role, profileUrl?, addedBy, addedAt }` |
| `/.space/writers/<driveKey>/<writerKey>.json` | a Space Writer grant (§6) |

- **Sharing moves the library.** The owner's Device copies the Space's Drive Registry, Bookmarks,
  Reader feeds, and Space-only Notes and Names into the Space Library, then deletes those copies from
  the Root Drive and the Vault. One copy, so there is never a question of which one wins. The share
  dialog lists what will be shared (for example "12 drives, 3 contacts, 40 notes") before it does it.
- **The Space record points at it.** `/.vault/spaces/<rootDriveKey>.json` gains
  `library: <spaceLibraryKey>`, `role` and `memberId`. All of the user's Devices then read the
  Space's library from the Space Library. Code that reads a Space's library asks one function,
  `spaceLibrary(space)`, which returns the Root Drive and Vault paths for an unshared Space and the
  Space Library for a shared one.
- **The Root Drive is never shared.** `hyper://private/`, the AI chats and page data stay the
  person's own. Each member has their own Root Drive for the Space.
- **The Space Library is never browsed or Listed.** Like the Vault, it is reached only through
  `nomad.vault` (nomad:// pages) and the phone's backend.

### 3. Members and roles

A **Member** is a person in a Shared Space. A member has a random `memberId` made when they join, not
their Vault key, which must stay secret. A member is one of:

- **Owner**: the person who shared the Space, and anyone they make an owner. Invites people, changes
  roles, removes members.
- **Can edit**: reads and writes everything in the Space: its library, and every Drive in it (§6).
- **Can view**: reads everything in the Space. Writes nothing, and can ask for write access to one
  Drive (§7).

**What enforces a role.** Viewing versus editing is enforced by the Autobase writer set: an editor's
Devices are Writers of the Space Library, a viewer's are not. Owner versus editor is a rule the app
follows, like the `collaborative` lock (ADR-0010): an editor's Device could add a Writer, but the UI
only lets owners invite and change roles. Making the reducer check roles was considered (below) and
left for later.

### 4. Inviting someone

Inviting uses `blind-pairing`, the same handshake that adds a Device to the Vault (ADR-0006,
multi-device-protocol §2), on the Space Library's key instead of the Vault's.

1. **Invite.** An owner picks **Can view** or **Can edit** and gets a code and QR, single use. The
   role is kept with the invite's public key on the owner's Device.
2. **Ask to join.** The other person enters the code under **Join a shared Space**. Their Device
   mints a writer key for the Space Library first, in a new namespace it keeps for that Library
   (ADR-0026 §1), and sends `{ memberId, name, writerKey, profileUrl? }` as `userData`.
3. **Approve.** The owner's Device shows "Alex wants to join Work. They can view." Never accepted
   without a click, since codes leak. On approval it writes the member record, appends
   `{ addWriter: writerKey }` if the role can edit, and confirms, which hands back the Space Library
   key.
4. **The Space appears.** The member's Device makes a new Space with that name, icon and color, its
   own new Root Drive, and `library`, `role` and `memberId` on its Vault record, so the member's
   other Devices get it too.

A code reveals nothing until an owner approves: unlike a drive invite URL (`?invite=`), it doesn't
carry the key.

### 5. A member's other Devices

The member's other Devices learn the Space from their own Vault. A viewer's Devices only read, so
they need nothing more. An editor's other Device needs its own writer key on the Space Library; it
asks with a Writer grant in its own Vault (ADR-0026 §2), and the member's Device that already writes
the Space Library grants it without a prompt, because only that person's Devices write their Vault.
A Device that becomes a Writer this way is listed under the member in the share dialog.

### 6. Writing the Drives in a Shared Space

Every Drive keeps its own writer set. A member's Device writes a Drive with its per-drive writer key
(ADR-0026 §1), granted with a **Space Writer grant**, a record in the Space Library:

```
/.space/writers/<driveKey>/<writerKey>.json
{ type: 'nomad/space-writer', drive, writerKey, memberId, device, requestedAt,
  grantedBy?, grantedAt? }
```

- **Editors get it on demand.** When an editor's Device opens a Drive of the Space it can't write,
  it writes the record. Any Device that can write that Drive and sees the member is an editor appends
  `{ addWriter: writerKey }` to the Drive and sets `grantedBy`. No prompt: the role already says yes.
  So "edit everything" covers Drives added later, without adding a Writer to Drives the member never
  touches.
- **Only Devices that can write the Drive grant.** An owner's Drive is granted by the owner's
  Devices; a Drive an editor made, by that editor's Devices.
- **Drives outside the Space are never granted**, even another Drive of the owner's. A grant record
  names one Drive in one Space.

### 7. A viewer asks for access to one Drive

A viewer can't write the Space Library, so they can't write the request record themselves.

- **Ask.** **Ask for edit access** on a Drive of the Space sends `{ drive, writerKey, memberId,
  device, note? }` over a Protomux control channel, `nomad/space-control`, keyed by the Space
  Library (the pattern of `nomad/autobase-control`). The request is re-sent to each peer that
  connects until the viewer sees its record.
- **Kept.** The first Device that can write the Space Library and receives it writes the record
  (§6, no `grantedBy`) after checking that `memberId` is a viewer whose Device the request names.
  Now every owner and editor sees it, even ones offline when it was sent.
- **Approve or deny.** A Device that can write the Drive shows "Alex asks to edit Recipes" in the
  share dialog and on the Drive's site-info panel. Approve appends `addWriter` and sets `grantedBy`.
  Deny deletes the record.
- **Only that Drive, only in that Space.** The viewer stays a viewer: no Writer on the Space Library
  or any other Drive. Removing them from the Space removes the grant.

### 8. Changing a role, removing someone, leaving

- **Viewer to editor:** the member's Devices see the new role and ask for Space Library grants
  (§5) and Drive grants (§6). **Editor to viewer:** an owner's Device appends `{ removeWriter }` for
  the member's keys on the Space Library and on every Drive it can write that has a Space Writer
  grant for them, then deletes those records. A grant on a Drive only another member can write
  stays until one of that member's Devices handles it.
- **Removing a member** does the same and deletes their member record. Their Devices see it, mark the
  Space "You were removed from Work", and stop syncing it.
- **Leaving** deletes the member's own record and their Space. Owners can't leave while they are the
  only owner.
- **Revocation stops writes, not reads.** Anyone who had the Space Library's key can keep reading it,
  including what is added after they are removed, and keeps every Drive's key the Space listed. The
  remove dialog says so. To shut a viewer out, an owner uses **Make a new copy without them**: a
  new Space Library, invites for the others again. Encrypting the Space Library with a key rotated
  per member set would fix this properly; that is a later ADR.

### 9. Names, Notes, Reader and the AI in a Shared Space

- **Names:** the user's own Name wins over a Space Name with the same word, and My Library flags the
  clash. An editor can't take over "bank" for the user. Navigation resolves the Space's names only
  in a tab of that Space. The AI never auto-names into a Space.
- **Notes:** the same editor and rules. Two members editing one Note get a conflict copy, as two
  Devices do today (ADR-0017).
- **Reader:** the Space's feeds are shared; read marks stay each person's.
- **AI:** a personal turn in a Shared Space also searches the Space's Notes, Names and feeds. Writes
  follow the member's role: a viewer's AI can't write the Space's Notes. Content written by other
  members is treated as content, not instructions, like a page.

### 10. The phone

The phone reads and writes the same records through its backend (`RPC_APPS` gains a `space`
argument for Notes and Names), shows the Space and All Spaces sections, and can join a Shared Space
with a code. Sharing from the phone (being an owner Device that approves) comes after desktop.

## Considered options

- **Share the Root Drive.** It already holds the Drive Registry and Bookmarks. Rejected: it is the
  Space's `hyper://private/`, with page data and AI chats.
- **Share through the Vault.** Rejected: the Vault's key reads the whole account.
- **Give every Space a Space Library from the start**, shared or not. One layout for everything,
  and no move when sharing. Rejected for now: the user's paired Devices can't write a Drive they
  didn't create until desktop has per-drive writer keys (ADR-0026, "Later"), and it would migrate
  every user's data. Worth revisiting once S1 lands, since the move at share time would go away.
- **Drive invite URLs** (`hyper://<key>/?invite=…`). Rejected: the URL carries the key, so anyone who
  sees the link can read the Space.
- **Roles checked by the reducer**, so a viewer could write only its own requests and an editor
  couldn't add Writers. Real enforcement, but a second reducer for the Space Library on both apps.
  Deferred; the writer set already separates viewing from editing.
- **One Autobase per item type** (a Notes base, a Names base, …). More keys to share and more
  invites to approve for nothing. Rejected.
- **Fan out editors' writer keys to every Drive at join.** Rejected for the same reasons as ADR-0026:
  a Writer, an indexer and two cores on every Drive, most of which the member never edits.

## Consequences

- **A new kind of base.** The Space Library is an Autobase that isn't a Drive in the Registry. It
  replicates like the Vault (joined at startup for every Shared Space).
- **Drive keys reach members.** Everything in a Shared Space's Registry is readable by its members,
  which the share dialog states. A Drive the user wants private belongs in another Space.
- **New Vault records** (`/.vault/space-lib/`) and Space record fields (`library`, `role`,
  `memberId`), in multi-device-protocol.md §1.1. A Device that predates this ignores both, so an old
  Device in the same Vault shows a Shared Space with an empty library until it updates.
- **`shared/space-library.mjs`** holds the paths, record builders and the role rules both apps use,
  with a unit test, like `vault-apps.mjs`.
- **CONTEXT.md** gains Shared Space, Space Library, Member, Role and Space Writer grant.
- **nomad.dev** gains a help page on sharing a Space once it ships. No `nomad.*` API changes for
  pages: Space libraries are reached only by nomad:// pages, through `nomad.vault`.

## Spikes before *Accepted*

- **S1: desktop writes a Drive it didn't create. Passed** on the pinned autobase 7.28.1, corestore
  7.10.1 and hypercore 11.33.1 (`app/scripts/spike-per-drive-writer.mjs`). With the Vault open on the
  root store, a Drive opened in `autobase:<keyHex>` readies, has its own writer key, turns writable
  when the owner appends `addWriter`, and its writes reach the owner; two such Drives work at once;
  and a key minted before the Space Library's key is known opens the Library writable once granted.
  What it found:
  - **The first open decides.** A Drive's bootstrap core remembers its writer key
    (`autobase/local`), and every later open, in any namespace, uses it. So the rule is: if this
    Device has opened the Drive before, open it as before; if not, open it in `autobase:<keyHex>`
    (or, for a Space Library joined by invite, in the namespace its key was minted in).
  - **Drives already opened on the root store stay read-only.** Their remembered key is the root
    `local` core, which a joined Device's Vault holds, so they still wait on that lock. Moving them
    with `base.setLocal()` opens them but the next apply fails an assertion ('has block'). Those
    Drives need a fix before a member can write them; new ones, the Space Library included, don't.
  - **The Vault itself must keep opening on the root store** on a Device that joined by pairing,
    since its approved key is the root `local` core.
- **S2: two pairing members on one swarm.** One `BlindPairing` instance serves the Vault's invites
  and several Space Libraries' invites at once, each candidate reaching the right one.

## Rollout

1. **Space-only Notes and Names.** The `space-lib` Vault records, the two sections in My Library →
   Names and in Notes, and moving an item. Desktop first; the phone lists and edits only the
   user's own until its follow-up.
2. **Desktop per-drive writer keys.** The first-open rule from S1 in `autobases.js`, then
   ADR-0026's Writer grants on desktop. *Landed:* `_storeFor` in `autobases.js` (the Vault opens
   on the root store, `VAULT_OPEN`), `shared/drive-writers.mjs`, `app/bg/hyper/drive-writers.js`
   (ask, grant, revoke, and Space Root Drives asked for on their own), and **Edit on this device**
   in the site-info panel.
3. **Share a Space.** The Space Library, `spaceLibrary(space)`, the move, invites and approval, and
   the share dialog (members, roles, pending requests) from the Space menu.
4. **Join a Shared Space.** Joining with a code, a member's other Devices, editor Drive grants.
5. **Access requests.** `nomad/space-control`, the request records, approve and deny.
6. **The phone** joins and edits Shared Spaces.
7. **Docs.** The nomad.dev help page.
