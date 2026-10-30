# Live Docs: a Yjs document stored as per-writer update files in its Drive

**Status: Proposed.** 2026-10-30. Nothing is built yet; the spikes under *Open questions* gate
acceptance.

The user wants document-style Drives that several people, and the same person's Devices, edit at
the same time, the way Slack canvases and Notion pages work: you see the other person's cursor, text
appears as they type, and an edit made offline merges in later with nothing lost. We call such a
document a **Live Doc**.

## The constraint that forces the design

A Drive is an Autobase whose view maps a path to one record (`shared/fs-core.mjs`). Two Writers who
both `put` the same path both land in the oplog, Autobase puts them in one order, and the view keeps
the last one. For a file that is the whole document, that is last-writer-wins on the whole document:
one person's paragraph silently disappears. Notes work around it with a conflict copy
(`shared/vault-apps.mjs` `isConflict`), which is fine for one person's Devices and useless for two
people typing in the same page.

So concurrent edits cannot share a path. They need a merge that runs on the reader, from data every
Writer can append to without touching anyone else's. That is a CRDT, and the question is only where
its bytes live.

Two more facts shape it. Autobase re-runs `apply` on every reorg and `apply` must stay a small, pure
reducer shared byte-for-byte with mobile (`FS_FORMAT_VERSION`, golden vectors). And a Device cannot
yet write a second Autobase it was paired into (multi-device-protocol §3), which is why ADR-0012 put
Drafts in the Vault instead of a base of their own.

## Decision

1. **A Live Doc is a folder in a Drive holding a Yjs document.** The app picks the folder; the layout
   inside it is fixed:

   ```
   <doc>/doc.json                                   { type: 'walled.garden/live-doc', id, format: 'yjs/1',
                                                      schema: 'prosemirror' | 'text', title, createdAt }
   <doc>/updates/<writerKey>/<ms>-<rand>.yupdate    a Yjs update, written only by that Writer
   <doc>/snapshots/<writerKey>-<ms>.ystate          Y.mergeUpdates of everything it replaced
   <doc>/content.md                                 derived export for readers, search and the AI
   ```

   The document's state is `Y.mergeUpdates(all snapshots + all update files)`. Merging is
   idempotent and order-free, so the Autobase order doesn't matter, a duplicate does no harm, and a
   reorg changes nothing a reader sees.

2. **Each Writer appends only under its own key.** No two Writers ever write the same update or
   snapshot path, so the last-writer-wins rule never fires on document content. This uses
   `nomad.fs` as it is today: **no new op, no reducer change, no `FS_FORMAT_VERSION` bump**, and the
   files replicate, export and fork like any other files. The only paths that can collide are
   `doc.json` (metadata, last write is fine) and `content.md` (derived, and any Writer can rebuild it).

3. **Two paths: a durable one and a live one.**
   - *Durable:* the page batches its own local Yjs updates and writes one update file after about a
     second of idle, and on blur, hide and close. Peers pick them up with `nomad.fs.watch` on
     `<doc>/`. This path is the source of truth and works offline: edits made on a plane append to
     the local oplog and merge when the Device reconnects.
   - *Live:* a `nomad.peersockets` room per Live Doc (topic `live-doc:<doc path>`, already scoped to
     the Drive) carries the y-protocols sync messages, so keystrokes arrive in tens of milliseconds
     instead of waiting for the next file. It never writes anything. Each Writer persists only
     updates whose origin is local, so an update that arrived over the wire is saved by its author,
     not by everyone who saw it.

4. **Presence rides the live room and is never stored.** y-protocols awareness carries cursor,
   selection, name and color (name and avatar from the Writer's Profile Drive). It times out on its
   own when a peer leaves. Readers who are not Writers can see presence; they show as viewers.

5. **Editors are the Drive's Writers.** The durable path needs nothing new: only Writers can append.
   The live path does: today a peersocket peer is a swarm connection key, not a Writer. Peers in a
   live room prove a current Writer key with a signed challenge, the way the AI Bridge proves a Vault
   Writer (ADR-0013). A page applies a document update from the live room only from a proven Writer;
   anyone else may only send awareness. There are no per-document permissions inside a Drive: the
   sharing boundary is the Drive, so a page shared with different people goes in a different Drive
   (Notion's teamspace). Writers stay fully trusted, as for every other file in a Drive: a Writer can
   delete another Writer's update files, and compaction relies on that.

6. **Compaction keeps opening fast; it does not reclaim disk.** When a Live Doc has more than about
   256 update files or 1 MB of them, the next Writer to open it writes one snapshot (the merge of the
   files it read) and deletes those files and the snapshots it merged, in **one append batch, snapshot
   first**. A reader that sees the snapshot but not yet the deletes has duplicates, which merge away;
   it can never see the deletes without the snapshot. Two Writers compacting at once each write a
   snapshot of what they read; both stay valid. Compaction builds only from files, never from the
   in-memory document, so nothing that arrived over the live room enters storage through it. Because
   Hypercores are append-only, the bytes of deleted files stay in the oplog. Yjs keeps garbage
   collection on (deleted text shrinks to small tombstones), so we keep no per-keystroke history;
   version history is a snapshot the user names (`snapshots/…` with a `label` in `doc.json`), not
   time travel.

7. **The code is a library, not a new API.** `nomad://app-stdlib/js/live-doc.js` is a Yjs provider
   over `nomad.fs` (durable) and `nomad.peersockets` (live and presence): `openLiveDoc(drive, path)`
   returns `{ ydoc, awareness, whenSynced, destroy }`. Yjs is vendored in app-stdlib. Pages bring
   their own editor binding: y-prosemirror (TipTap, BlockNote) for Notion-style pages, y-codemirror.next
   for text. The first user is a **docs** drive template in nomad.dev (a Drive of pages with a page
   tree, `type: 'walled.garden/docs'`), built like the forum template.

8. **Readers without the app still get the text.** A Writer rewrites `content.md` (Markdown, or plain
   text for `schema: 'text'`) a few seconds after edits settle. Reader, `nomad://search`, a plain
   hyper:// fetch, and the AI's `readFile` all read that file and never need Yjs.

9. **The AI edits through the page, not the files.** A `writeFile` on `content.md` would be overwritten
   by the next export, and the AI can't safely write Yjs updates. While a Live Doc is open, its page
   registers WebMCP tools (`insertText`, `replaceRange`, `appendSection`, …) that edit the Y.Doc with
   the AI as its own origin, so `Y.UndoManager` scoped to that origin undoes an AI turn the way a
   Checkpoint does (ADR-0011).

10. **Draft Mode doesn't apply to Live Docs in v1.** A Live Doc's writes are the edit; staging them
    would split the document between the Vault and the Drive. `drafts.js` skips paths under a folder
    with a `walled.garden/live-doc` `doc.json`, and the editor says so.

## Considered options

- **Whole-file writes with conflict copies (today, and Notes).** Simple, but not live, and two people
  typing get two copies of the page. Rejected for Live Docs; Notes may move to Live Docs later.
- **A CRDT op in the reducer** (`{ op: 'yupdate', path, update }`, with `apply` merging into one
  stored state per document). Every reader would get a ready state. But it puts Yjs inside
  `shared/fs-core.mjs` on both runtimes with identical pins, bumps `FS_FORMAT_VERSION`, and makes
  `apply` cost the size of the document on every op and every reorg replay. Rejected: `apply` stays a
  small keyed put/del.
- **Our own operation log on Autobase's order (OT-style).** Autobase gives a total order, but it can
  reorder on a reorg, so the editor would have to rebase its pending edits: OT written by hand, with
  no editor bindings. Rejected.
- **Per-writer document cores outside the oplog** (like file blobs; the design of Ink & Switch's
  hypermerge). The cheapest per keystroke, and a core can be cleared to reclaim disk. But readers must
  enforce the Writer set and removal cut-offs themselves, and it adds a core per Writer per document.
  Deferred: this is the upgrade path if Q1 shows update files are too slow or too big. The folder
  layout above can point at such cores later without changing the merge.
- **A separate Autobase per document** (a Keet room per page). A second Writer set to manage per page,
  and a Device can't write a second base it was paired into until per-drive device writer keys exist
  (§3). Rejected, as in ADR-0012.
- **Live room only, saving a whole snapshot now and then.** Easiest to build, but two Writers who are
  never online at the same time overwrite each other's snapshot. Kept as the live layer, rejected as
  the storage.
- **Automerge instead of Yjs.** The best history (every change kept, diff and time travel), but a
  WASM build several times larger, and its ProseMirror and CodeMirror bindings are younger.
- **Loro instead of Yjs.** WASM, fast, with rich text, a movable tree that fits a page tree, and
  shallow snapshots for compaction. The youngest ecosystem of the three.
- **Yjs (chosen).** Pure JavaScript, so the same code runs in an Electron page and the phone's
  WebView with no WASM; the smallest bundle; mature bindings for ProseMirror/TipTap/BlockNote,
  CodeMirror 6 (Notes) and Monaco (the editor); and a standard awareness protocol for presence. Its
  weak spot, history, is covered well enough by named snapshots. `format: 'yjs/1'` in `doc.json`
  leaves room for another format beside it later.

## Consequences

- **No wire-format change.** Live Docs are files under a convention; the reducer, golden vectors and
  mobile parity are untouched. The new pieces are a library, a schema, a template, and one platform
  change to peersockets.
- **`nomad.peersockets` gains proven Writer identity** (a peer event carries `writerKey` once proven).
  That is a public API change, so it needs the nomad.dev page, `API_REFERENCE` and `nomad-dts.js`
  updated together.
- **Storage grows with editing.** Each batch is an oplog entry plus a file; deletes don't shrink
  Hypercores. Batching keeps it to about one entry per second of active typing. Measured in Q1.
- **The phone reads Live Docs** through `nomad.fs` (durable path only, since the phone has no
  `nomad.peersockets` yet). Phone writes wait for the mobile writable bridge and §3, like every other
  phone write to a Drive.
- **Privacy is the Drive's.** Anyone with the Drive key reads the document and its history of update
  files. A private Live Doc needs an encrypted Drive (ADR-0010 Q4).
- **Removing a Writer** stops their future edits; their past update files stay part of the document,
  as their past files do in any Drive.

## Open questions (spikes that gate acceptance)

- **Q1: durable-path latency and size.** Two Writers on a LAN and across the internet: time from
  write to the peer's `watch` event, and oplog plus view bytes after an hour of typing with one-second
  batches. Decides the batch interval and whether per-writer cores (above) are needed.
- **Q2: open cost.** Time to open a Live Doc with 10,000 update files against one with a snapshot,
  to set the compaction threshold.
- **Q3: the Writer proof.** Which keypair signs the challenge (the base's `local` writer core,
  per-drive namespace key), and how a Device that has several Writer keys for one Drive shows up.
- **Q4: small files.** Whether update files should be stored inline (`buildPutInlineOp`) rather than
  as blobs, which `nomad.fs.writeFile` can't choose today.

## Implementation touchpoints (non-binding)

`app/userland/app-stdlib/js/live-doc.js` and a vendored Yjs, y-protocols and lib0;
`app/bg/web-apis/bg/peersockets.ts` (Writer proof, `writerKey` on peer events) plus its docs triad;
`app/lib/schemas/walled.garden/live-doc.ts` and `docs.ts` registered per *Adding a walled.garden
schema*; the Live Doc skip in `app/bg/hyper/drafts.js`; and in nomad.dev a `docs` template
(`static/templates/docs/`, `src/content/docs/docs/templates/docs.mdx`) with TipTap, the page tree and
the WebMCP tools.

## Rollout

- **Phase 0:** the Q1/Q2 spike (`app/scripts/spike-live-doc.mjs`): two in-process Writers on real
  `nomad.fs`, the merge, compaction under concurrency, and the numbers.
- **Phase 1:** `live-doc.js` on the durable path only, and a plain-text Live Doc page to try it.
- **Phase 2:** the Writer proof in peersockets, then the live room and presence.
- **Phase 3:** the docs template (rich text, page tree, `content.md`, WebMCP tools), the schemas and
  the docs.
- **Later:** Notes as Live Docs (no more conflict copies), named versions in the UI, and per-writer
  cores if Q1 calls for them.
