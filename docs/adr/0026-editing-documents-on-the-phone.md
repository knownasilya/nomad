# Editing Documents on the phone: live events, live rooms, and per-drive writer grants

**Status: Proposed.** 2026-10-30. Builds on ADR-0025 (Live Docs) and the Document drive template.
Three spikes (below) must pass before *Accepted*.

ADR-0025 gives desktop a **Document** drive: a Live Doc at `/doc/` that several Writers edit at
once, with keystrokes and cursors carried live over a peersockets room. The drive's app is
self-contained (`/index.html` plus one `/app.js` holding Yjs, y-protocols, CodeMirror 6 and
`live-doc.js`) and uses only `nomad.page`, `nomad.fs.drive()` and, when it exists,
`nomad.peersockets`. So the same app already loads on the phone through the loopback gateway and the
`NOMAD_SHIM` (`mobile/lib/types.ts`). It just can't do much there. The user wants to edit a Document
on the phone the way they do on desktop.

## What the phone is missing today

1. **No change events.** The shim's `watch` is a no-op stream, and `dispatchNomad` returns `null` for
   `watch`, `watchRequests` and `watchDraft`. An open Document never sees new update files.
2. **No live room.** There is no `nomad.peersockets` on the phone, so no live typing, no cursors, and
   the page runs files-only.
3. **No writes to a drive made elsewhere.** Writes go through `DriveManager._openOwned`, which needs
   the namespace the phone created the drive in (`drives-ns.json`). Any drive created on another
   Device, or by another person, is read-only, which is the multi-device-protocol §3 limit.
4. **No template picker.** Library's *New drive* form makes a blank drive only.

Reading the code turned up three more gaps that break a Document on the phone even read-only:

5. **`readFile` ignores `encoding`.** `manager.bridgeRead` always returns UTF-8 text. The Document
   app reads update files with `{ encoding: 'base64' }`, so on the phone every Yjs update arrives
   mangled. ADR-0025's "the phone reads Live Docs" is not true until this is fixed.
6. **No `getInfo().writerKey`,** which the page needs to know its own update folder.
7. **No inline writes.** Mobile's `_put` always writes a blob; update files must be inline
   (`{ inline: true }`, ADR-0025 Q4).

## Decision

### 1. Each Device has one writer key per Drive, and the phone already has it

On the phone, a drive it created opens in the namespace it was created in (`drivesNs[key]`); every
other drive opens in the namespace `autobase:<keyHex>` (`DriveManager.cacheKey`). Each namespace
has its own Autobase `local` core, so **the phone already holds a distinct, stable writer keypair
per drive**, separate from the Vault's exclusive root `local` core. That is exactly the
"per-drive device writer key" §3 asks for, without the deadlock: nothing else holds that core.

We make it the rule. A drive opens in exactly one namespace on a Device: `drivesNs[key]` when this
Device created it, otherwise `autobase:<keyHex>`. Every open (tab, gateway, `nomad.*` bridge,
Library file browser) resolves the namespace the same way, so a read can't open the drive first in
a namespace that can never become writable. The namespace for drives the phone didn't create keeps
its current name, so existing local cores keep their keys.

### 2. The user's own Devices grant that key through the Vault

A **Writer grant** is a Vault record, `/.vault/drive-writers/<driveKey>/<writerKey>.json`:

```
{ type: 'nomad/drive-writer', drive, writerKey, device, name, requestedAt,
  grantedBy?, grantedAt? }
```

- **Asking.** The phone writes the record (without `grantedBy`) when the user taps
  **Edit on this phone**. It never asks on its own: each grant adds a Writer to the drive (and, with
  today's reducer, an indexer; see Spike S2), so we add them only for drives the user wants to edit.
  The action shows in the drive's site sheet for any Autobase drive that is not writable here, and
  as a host-drawn bar above a Document that is read-only on this phone.
- **Granting.** Every desktop watches `/.vault/drive-writers/` on Vault `update`. For each request
  whose `device` is still a listed Vault Device, and whose drive this desktop can write (it loads
  the drive only if it already has it locally, `isKnownAutobase`), it appends `{ addWriter: writerKey }` to that
  drive and sets `grantedBy` and `grantedAt` on the record. **No prompt:** only the user's own
  Devices can write the Vault, so the request is already the user's. A phone that can write the
  drive grants the same way, so two phones can grant each other.
- **Becoming writable.** The phone's base turns `writable` on its own once the `addWriter`
  linearises (`base.writable` is live). The shim's `getInfo()` then reports `writable: true`, and
  the Document page starts saving.
- **Nobody can grant.** If no Device of the user's writes the drive (it's another person's drive),
  the request stays pending. After 30 s with no grant and a Device online, the bar says so and
  offers **Ask the owner**, which is the existing writer-request flow
  (`nomad/autobase-control`, `requestAccess`) ported to the phone. That part is Phase 4.
- **Revoking.** Removing a Device (on either app) walks that Device's grant records and appends
  `{ removeWriter }` on each drive the removing Device can write, then deletes the records it
  handled. A record for a drive it can't write stays for a Device that can. Readers ignore any
  grant whose `device` is no longer listed. Unlinking the phone itself does the same, best effort,
  before it forgets the Vault.

This generalises §3: grants are per drive and on demand, not fanned out to every drive at pairing.
Desktop can use the same records for drives it was paired into once it also opens other people's
drives in a per-drive namespace (today it opens them on the root store, which is the §3 deadlock).
That desktop change is out of scope here.

*Amendment (ADR-0029 step 2):* desktop now does both. It opens a drive it has never opened in
`autobase:<key>` (`_storeFor` in `autobases.js`), asks with these records from the site-info
panel (**Edit on this device**), and grants them (`app/bg/hyper/drive-writers.js`). It asks for
each Space Root Drive on its own, since every Device of the user should write those. Its Vault sync
also handles revoking: a record whose `device` is no longer listed is taken off any drive the
syncing desktop writes, so it doesn't matter which app removed the Device. A drive this desktop
first opened on the root store keeps that key and can't be granted (spike S1 in ADR-0029).

### 3. Writes use whatever base is writable

`DriveManager` drops the `ns`-required `_openOwned` for a `_openWritable(key)` that opens the drive in
its one namespace (§1) and throws the same clear read-only error unless `base.writable`.
`dispatchNomad` routes `put`, `writeFile`, `del` and `mkdir` through it, so writes no longer depend
on `drivesNs`. Publish of a Draft (`drafts.publish`) uses the same check instead of `drivesNs`.
Blobs already go in a core namespaced by `base.local.key` (`_blobsForBase`), which works for any
writable base.

`writeFile` and `put` honour `{ inline: true }` (refused above 4 KB, as on desktop) by building the
inline record `shared/fs-core.mjs` already defines. `readFile` and `get` honour `encoding`
(`'utf8'` default, `'base64'`, `'json'` for `get`) instead of always decoding UTF-8. `getInfo()`
adds `writerKey`: hex of `base.local.key` when writable, else `null`, matching desktop.

`mobile/backend/lib/drafts.mjs` skips paths under a folder whose `doc.json` is a
`walled.garden/live-doc`, as ADR-0025 §10 does for desktop. The Document app passes
`{ draft: false }` anyway; the skip covers other callers.

### 4. `nomad.fs.watch` on the phone

- **Backend.** `watch(url, pattern)` does what desktop's `autobase.ts` `watch` does: on the base's
  `update`, diff the view from the last version over the pattern's key range and emit `changed`
  once if anything moved (or once, if the view was rebuilt). The range math and diff move to
  `shared/fs-watch.mjs`, used by both runtimes, so they can't drift.
- **Transport.** The first `nomad.*` stream on the phone. The shim's `watch` sends a `watch` RPC and
  gets back a stream id. The backend sends `RPC_NOMAD_EVENT { streamId, event, data }`; RN calls
  `window.__nomadStreamEvent(id, event, data)` in that WebView; the shim's stream is an
  EventTarget with `addEventListener('changed', …)` and `close()`, as desktop's
  `fromEventStream` returns. `close()` sends `RPC_NOMAD_CLOSE { streamId }`.
- **Lifetime.** Each `RPC_NOMAD` carries the tab id. The backend keeps each tab's streams and closes
  them when the tab navigates to another drive, reloads, or closes, so a page that never calls
  `close()` doesn't leak listeners. Events are coalesced to at most one per stream per 100 ms.
- `watchDraft` and `watchRequests` use the same plumbing later; v1 wires only `watch`.

### 5. `nomad.peersockets` on the phone, with the Writer proof

- **Same protocol.** `mobile/backend/lib/peersockets.mjs` opens the desktop's Protomux channel
  (`nomad/peersocket`, id `sha256(driveKey ‖ '/' ‖ topic)`, message 0 a buffer, message 1 the JSON
  Writer proof) on every connection of `DriveManager`'s swarm. A phone and a desktop in the same
  Document are in the same room.
- **One proof implementation.** Desktop's `app/bg/hyper/writer-proof.js` (sign
  `roomId ‖ handshakeHash` with `base.local.keyPair`; verify against the writer core's manifest
  signer; membership is the bootstrap key or a non-removed `base.system` entry) moves to
  `shared/writer-proof.mjs` and both runtimes call it, like `fs-core.mjs`. The phone proves with its
  per-drive key (§1) once it is a Writer, and verifies desktop proofs the same way.
- **Scoped to the page's own drive.** The room's drive is the tab's drive, which RN attaches to
  every `RPC_NOMAD` from that WebView (the key it injects as `window.__nomadPage`). The backend
  never takes a drive key for a room from the page, matching desktop's `getSenderDrive`.
- **Shim surface.** `nomad.peersockets.join(topic)` returns a stream with
  `send(peerId, bytes)` and `join`, `leave`, `writer` and `message` events (`writerKey` or
  `null` on each message), and `watch()`; bytes cross the two bridges as base64. Same event shapes
  as desktop, so the Document app's `typeof nomad.peersockets === 'object'` check turns the live
  room on with no change to the app.
- **Background.** When the app goes to the background the backend leaves the phone's rooms (peers
  drop its cursor when awareness times out). On return it rejoins, and the page resyncs with
  y-protocols step 1. Rooms never keep the backend awake.

### 6. A writable phone announces the drive

The phone joins drive topics lookup-only today (`server: false`), so only announcing peers can
reach it. That's fine for reading and wrong for a Writer: two phones would never meet, and the
phone's new blocks would wait until some desktop happened to connect. While a writable drive is
open in a tab, the phone joins its topic as server and client. After the tab closes, it keeps the
topic and an awake hold (`useBackend`'s `awakeHolds`) until a peer has downloaded its writer core
to its length, for at most 60 s. Past that, the drive's row in Devices → Sync details shows
"Edits on this phone not synced yet", and the phone announces again the next time it opens.

### 7. Saving before the app sleeps

ADR-0025's durable path saves on blur, hide and close. In a React Native WebView those don't fire
reliably when the app is backgrounded. When AppState leaves `active`, RN takes an awake hold, calls
`window.__nomadLifecycle('hidden')` in each drive WebView (the shim dispatches a
`visibilitychange` to `hidden`), and releases the hold when the page's pending writes resolve, or
after 5 s. The Document app needs no change: its existing hide handler writes the batch.

### 8. The template picker on the phone

Built-in templates move to one list both apps read: `shared/drive-templates.mjs`
(`{ id, title, description, icon, collaborative }` per template; today Blank and Document). The
build output desktop already makes (`scripts/build-drive-templates.mjs`) is also written to a
generated, committed `mobile/backend/lib/drive-templates.gen.mjs` (files as base64), rebuilt by
`npm run build:drive-templates`, the way `noteEditorHtml.ts` is. Library's **New drive** becomes a
picker built from `ListRow`s with the template's icon and description, then the title field. Create
makes an Autobase drive, writes the template's files (inline where desktop writes them inline, such
as `/doc/doc.json`), adds the drive to the current Space's registry (`RPC_SPACE_ADD_DRIVE`) and opens
it in a new tab. The phone writes it as the drive's creator, so no grant is needed.

## Considered options

- **Fan out a writer key to every drive at pairing** (the §3 note's first idea). The user never has
  to ask. But every pairing would add a Writer, an indexer and a writer core to every drive in every
  Space, most of which the phone never edits, and a drive created later needs another fan-out.
  Rejected for v1 in favour of on-demand grants; the grant records would also carry a fan-out if we
  want one later.
- **Write through the Vault's device key.** The Vault holds the exclusive root `local` core, so a
  second base on it deadlocks on `ready()` (`app/scripts/spike-shared-local-core.mjs`). Rejected,
  as in §3.
- **Edit in a Draft and let a desktop Publish.** Drafts are Vault-hosted and already work on the
  phone for any drive. But ADR-0025 §10 keeps Live Docs out of Drafts, edits would reach other people
  only when a desktop is on and publishes, and two Devices' Drafts of one Document would conflict as
  whole files. Rejected.
- **Relay the phone's edits through a desktop** (over the AI Bridge or a room): the desktop writes the
  phone's Yjs updates under its own key. No new Writer, but nothing saves while the desktop is
  off, which breaks offline editing, the point of the durable path. Rejected.
- **A native React Native editor** instead of the drive's own app. Better keyboard handling, but two
  editors to keep in step and a break with the drive's app being its frontend (ADR-0015). Rejected.
  Android IME composition in CodeMirror 6 is a known rough edge; the Notes editor already ships
  CM6 in a WebView, so we accept it and fix issues as they show.
- **Ask a person to approve each of the user's own Devices** with a prompt on desktop. The Vault
  record already proves the request is the user's, so a prompt adds a step without adding safety.
  Rejected; prompts stay for other people's requests.

## Consequences

- **The Document app is unchanged.** Every piece is platform API: `watch`, `peersockets`,
  `writerKey`, `encoding`, `inline`. The app's files-only fallback stays for older phones.
- **Platform API changes on mobile only**, all matching desktop's existing surface, so the nomad.dev
  pages, `API_REFERENCE` and `nomad-dts.js` don't change. The nomad.dev pages for `nomad.fs` and
  `nomad.peersockets` should drop any "not on mobile" notes once each lands.
- **Two shared modules** (`shared/fs-watch.mjs`, `shared/writer-proof.mjs`) and one shared list
  (`shared/drive-templates.mjs`), each with a unit test, like `fs-core.mjs` and `vault-apps.mjs`.
- **A new Vault record type** (`/.vault/drive-writers/`), documented in multi-device-protocol.md
  §1.1, and §3 updated to point here.
- **Wire format unchanged.** Grants are ordinary `addWriter` / `removeWriter` ops; no
  `FS_FORMAT_VERSION` bump unless Spike S2 forces non-indexer writers.
- **A drive gains one Writer per Device that edits it.** Each has its own writer core and blobs core,
  and keeps them after removal (logs only grow).
- **Battery and data.** Announcing a drive and holding the backend awake cost power. Both are bounded
  (open tabs, then 60 s), and rooms close in the background.
- **Space Root Drives can use the same grant** for the phone's bookmarks and drive registry, which
  are read-only on paired phones today. Not part of this ADR's rollout.

## Spikes before *Accepted*

- **S1: a granted key turns writable, on Bare.** On the phone's pinned autobase / corestore, with
  the Vault open: open a desktop-created drive in `autobase:<keyHex>`, have the desktop append
  `addWriter` for its `local` key, and check that `base.writable` flips without reopening, a write
  replicates back, and nothing deadlocks.
- **S2: the cost of a phone as an indexer.** `fs-core.mjs` adds every Writer with
  `{ indexer: true }`. With a desktop and a phone as the only indexers and the phone offline for a
  day, measure whether the desktop's writes stay visible to a third reader, how long the unsigned
  tail grows, and what the reorg costs when the phone returns. If it hurts, grants need a
  non-indexer `addWriter`, which is a reducer change: bump `FS_FORMAT_VERSION`, regenerate the
  golden vectors, and ship both runtimes together.
- **S3: room latency through two bridges.** A keystroke from the phone's WebView goes WebView → RN →
  Bare → swarm. Measure the added time over desktop's one-trip figure; the target is under 20 ms at
  p50 on a mid-range Android phone.

## Rollout

- **Phase 1: read a Document live.** `encoding` on reads, `writerKey` in `getInfo`, the one-namespace
  rule, `shared/fs-watch.mjs` and `nomad.fs.watch` streams. A phone viewer sees edits as their update
  files land (about 0.4 s at 75 ms one-way, ADR-0025 Q1).
- **Phase 2: the live room.** `shared/writer-proof.mjs`, `nomad.peersockets` on the phone. A phone
  viewer sees typing and cursors as they happen and shows up as a viewer.
- **Phase 3: edit.** Grant records on both apps, **Edit on this phone**, `_openWritable`, inline writes,
  announcing, and saving before sleep.
- **Phase 4: create and ask.** The template picker, and **Ask the owner** for other people's drives.
- **Later:** desktop opens drives it was paired into in a per-drive namespace and uses the same grants.
  Done in ADR-0029 step 2.
