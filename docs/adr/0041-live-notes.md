# Live Notes: the AI and the user's Devices edit an open Note together

**Status: Accepted.** 2026-11-04.

The user wants to watch the AI edit a Note: when the AI changes a Note that is open in Notes, its
edits should appear as it makes them, at a cursor of its own, the way a colleague's do in a shared
document. The same should work when one person has the same Note open on two Devices: each sees
the other's cursor and their edits merge as they type.

Before this, a Note was one Vault record (`/.vault/notes/<id>.json`, ADR-0017) and every write
replaced its whole body. The open editor learned of a change on `watchAppData()` and swapped its
text (`setText`); an edit made at the same time on another Device became a conflict copy
(`planNoteSave`). The AI's `writeNote` was the same whole-body write: the note jumped to the new
text, or, if the user had typed since the AI read it, the AI's text became a conflict copy.

## Decision

1. **An open Note has a live session: a Yjs document in bg.** `app/bg/notes/live-note.mjs`
   (`LiveNote`) holds one `Y.Doc` per Note open on this Device. Every editor of the Note is a peer of
   it, speaking the y-protocols sync and awareness messages: each nomad://notes tab (over
   `nomad.vault.openLiveNote` / `liveNoteSend`, `app/userland/notes/js/live.js`, bound to CodeMirror
   with `yCollab`), and the same Note's session on each of the user's other Devices. The session lives
   in bg, not in the page, so the AI, which runs in bg, can write into it, and so two tabs on one
   Device share one document. Yjs for the reasons in ADR-0025: pure JavaScript, the CodeMirror
   binding the Document template already uses, and the awareness protocol for cursors.

2. **The record stays the Note.** The list, search, the canvas, the phone, the AI's `readNote` and
   older versions of the app all read `body` as before. A session is seeded from the record and writes
   it back 700 ms after edits settle, with `makeNote` (topics and `createdAt` kept). No new record,
   no change to the Vault's wire format, nothing new to migrate. The Yjs document is not stored: it is
   the merge of the people editing now.

3. **Seeding is deterministic.** A session's initial text is inserted by a Yjs client whose id is a
   hash of the Note id, the record's `updatedAt` and its body (`seedClientId`). Two Devices that
   open the same version make the same Yjs items, so their documents merge without doubling the
   text. A session that started from another version (the Note was saved in between) doesn't merge
   with a different seed: the newer session wins (one with edits first, then the newer seed, then
   the lower Device key, `preferSession`), and the other takes its whole document (`WANT`/`STATE`),
   tells its pages to connect again (`MSG_RESET`), and puts back any edits it had made since its seed
   as text edits.

4. **One Device writes the record: the leader.** In a session that spans Devices, the Device with
   the lowest Vault writer key saves; the others don't. So the record has one writer while people
   type, and the leader is the one Device that folds a change made **outside** the session into it:
   the phone (which doesn't run a session yet), an older desktop, or another member of a shared Space.
   It reads the record after every Vault change; a version it didn't write becomes edits from the
   last version it knew to the new one (`shared/note-diff.mjs` `diffEdits` then `rebaseEdits` onto
   the live text). When that change touches text the session changed meanwhile, it is kept as a
   conflict copy, as Notes always did.

5. **Devices join over their own link.** `shared/note-live.mjs` is a Protomux channel
   (`nomad/note-live`) on each swarm connection, keyed on the Vault key like device presence and the
   AI Bridge. The Vault key alone proves nothing, so before any Note frame each side signs a fresh
   nonce from the other with its Vault writer key, over `proofMessage(nonce, handshakeHash)`: the
   protocol name keeps the signature from passing as an AI Bridge proof, and the connection's Noise
   handshake hash keeps it from being relayed onto another connection. The verifier checks the key
   is a listed Vault Device and the signature against the signer of that writer core. Then each side
   sends `OPEN { ids }` (the Notes it has open), and sessions of the same Note `JOIN` and exchange
   `MSG` frames (base64 y-protocols messages). It is pure and dependency-injected, like
   `device-presence.mjs`, so the phone's backend can run it later.

6. **The AI is a collaborator.** `writeNote` on a Note that is open (here, or on any of the user's
   Devices, from their `OPEN` lists) no longer replaces the record. bg works out the AI's edits from
   the text it read (kept by `readNote`, by `updatedAt`) to the body it wrote, moves them onto the
   live text, and types them in (`aiEdit`): a selection over text it removes, then its insertions a
   few characters at a time, over at most about three seconds, with an awareness state of its own
   (`AI_USER`, a violet cursor labelled "AI"). Its positions are Yjs relative positions, so the user
   typing elsewhere meanwhile doesn't move them. `writeNote` returns once the record holds the text.
   When the AI's change touches text the user changed since the AI read it, it falls back to the old
   path, a conflict copy. The user's undo in the editor takes back only their own edits.

7. **The page shows who's there.** The Notes toolbar shows an avatar for the AI while it edits and
   one for each other Device with the Note open, each with a tooltip and `aria-label`; the save status
   reads "AI is editing…" while it types. Collaborators' cursors show their name above the caret.

## Considered options

- **Notes as Live Docs** (ADR-0025's per-writer Yjs update files, in the Vault). It would merge
  offline edits on two Devices with nothing lost, not only live ones. But it changes how every reader
  of a Note gets its text (a merge of update files instead of one record), needs Yjs on the phone's
  Bare worklet, and adds about 1.1 KB of Vault oplog per batch of keystrokes. Deferred: the session
  here is the live layer such storage would also need, and the record can later become its export.
- **The session in the page.** Simpler wiring, but the AI runs in bg, two tabs would hold two
  documents, and the AI could only reach a Note through a WebMCP tool on a page that happens to be
  open (ADR-0025 §9). Rejected.
- **Animate the AI's whole-body write in the page** (diff the old and new record in the editor and
  replay it). No CRDT, but a user typing during the replay would fight it, and it does nothing for two
  Devices. Rejected.
- **Every Device saves.** Fewer moving parts, but a non-leader could overwrite the phone's edit before
  the leader folded it in, and two Devices would fold the same outside change in twice. Rejected.

## Consequences

- Two Devices with the same Note open no longer make conflict copies of each other's live edits.
  Offline edits on two Devices still do, as before.
- The phone joins the link too: see the amendment below.
- Sessions close five seconds after the last page leaves (`IDLE_CLOSE_MS`), after a last save.
- Tests: `tests/unit/note-diff.test.js`, `note-live-session.test.js`, `note-live-link.test.js`.

## Amendment: the phone joins (2026-11-05)

The phone runs the same sessions. The session (`shared/note-live-session.mjs`) and a Device's set of
sessions with their link frames (`shared/note-live-hub.mjs`) moved to `shared/`, with no bare
imports: each runtime passes in its own Yjs. The phone's backend (`mobile/backend/lib/live-notes.mjs`)
runs them with the link over its swarm, signs with its Vault writer key and checks the computer's
the same way. Its editor page (`app/userland/notes/js/mobile.js`, in the WebView) joins with the same
client as nomad://notes (`live.js`, with a transport through React Native: `RPC_NOTE_LIVE`,
`RPC_NOTE_LIVE_EVENT`), so the AI's edits on a computer and the computer's own show on the phone as
they're typed, with their cursors, and the header shows an avatar for each. The AI's `writeNote` on a
Note open only on the phone types into it the same way, since the phone's `OPEN` lists it.

- A phone that isn't a Vault writer yet can't save the record, so it says `saves: false` on `JOIN`
  and the leader is the lowest key among the Devices that can. An older Device sends nothing and is
  taken to save, as before.
- A page leaving saves at once when this Device leads, so the list shows the last edit.
- Yjs's lib0 imports `node:crypto`, which Bare lacks, so the bundle maps it to a shim over
  sodium (`mobile/tools/bare-imports.cjs`); `tests/unit/mobile-backend-deps.test.js` keeps the
  phone's packages and desktop's Yjs versions in step.
- Tests: `tests/unit/note-live-hub.test.js` (a computer and a phone joining one session, the AI
  typing into a Note open only on the phone, a phone that can't save).

## Amendment 2: the people of a shared Space edit together (2026-11-06)

A Note kept in a shared Space (its Space Library, ADR-0029) is edited live by every member who has it
open, not only by one person's Devices. Before, another member's edit reached the session only
through the record, so two people typing at once got a conflict copy.

- **One hub and one link per shared Space.** `shared/note-live-spaces.mjs` (`createLiveRouter`) puts
  each Note on the hub of its place: the Vault hub for the user's own Notes and Spaces that aren't
  shared, and a hub of its own for each shared Space this Device can edit. Each Space hub has its own
  `nomad/note-live` channel, keyed on the Space Library's key instead of the Vault's.
- **The proof is a Library writer key an editor lists.** On a Space's link each side signs the
  challenge with its writer key in that Library. The other side takes it only when a current member
  who can edit lists the key in their member record's `writers` (`editorKeys`), and the signature
  checks against the signer of that writer core. A removed member, a viewer, and anyone who only knows
  the Library key are refused. The user's own Devices meet on the Space's link too, for its Notes.
- **One leader for everyone.** Every Device in a Space session is keyed by its Library writer key, so
  all of them pick the same leader (the lowest key that can save) whoever's Device it is.
- **The AI goes to the Note's own place.** `aiWrite` asks only the hub of the place that keeps the
  Note, so a member listing another Note's id in `OPEN` can't pull the AI's write into their session.
- **Names.** In a shared Space's Note the cursor carries the person's name in the Space
  (`ownName` from `listNotes` on desktop, the member record on the phone), not the Device's.
- A Device that can't write the Space's Library yet (a phone waiting for its grant) stays on the Vault
  hub for that Space's Notes and sees the others' edits through the record, as before.
- Tests: `tests/unit/note-live-spaces.test.js` (two members in one session, one saver, a member not
  listed is refused, the AI's write routed to the Note's place).
