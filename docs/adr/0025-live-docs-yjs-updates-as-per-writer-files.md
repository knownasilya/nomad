# Live Docs: a Yjs document stored as per-writer update files in its Drive

**Status: Accepted.** 2026-10-30. The four spikes ran the same day (`app/scripts/spike-live-doc.mjs`,
all checks pass); their results are under *Spike results* and are folded into the decision below.
The first version is built as the **Document** drive template (see *What v1 built*). Still to do: a
run between two real machines over Hyperswarm, and the phone, which reads a Document drive but
can't edit it yet (a separate ADR).

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
   <doc>/updates/<writerKey>/<ms>-<rand>.yupdate    a Yjs update, written only by that Writer (inline)
   <doc>/snapshots/<writerKey>-<ms>.ystate          the state of everything it replaced (a blob)
   <doc>/content.md                                 derived export for readers, search and the AI
   ```

   The document's state is the merge of all snapshots and all update files. Merging is idempotent
   and order-free, so the Autobase order doesn't matter, a duplicate does no harm, and a reorg
   changes nothing a reader sees. A reader merges in a tree of 64-file chunks (`Y.mergeUpdates` on
   each chunk, then on the results) and applies the result once. Files come back in path order, one
   Writer after another, not in causal order, and applying them one by one parks most of them in
   Yjs's pending queue: 16 s for 10,000 files, against about 80 ms for the tree.

2. **Each Writer appends only under its own key.** No two Writers ever write the same update or
   snapshot path, so the last-writer-wins rule never fires on document content. This uses
   `nomad.fs` as it is today: **no new op, no reducer change, no `FS_FORMAT_VERSION` bump**, and the
   files replicate, export and fork like any other files. The only paths that can collide are
   `doc.json` (metadata, last write is fine) and `content.md` (derived, and any Writer can rebuild it).

3. **Two paths: a durable one and a live one.**
   - *Durable:* the page batches its own local Yjs updates and writes one update file after 2 s of
     idle, at most every 10 s while typing goes on, and on blur, hide and close. Peers pick them up
     with `nomad.fs.watch` on `<doc>/`. This path is the source of truth and works offline: edits
     made on a plane append to the local oplog and merge when the Device reconnects. The batch is
     that long because the live room already carries keystrokes, and each file costs about 1.1 KB
     of Drive storage for about 65 bytes of Yjs: a 1 s batch is about 8 MB per hour of two people
     typing nonstop, a 10 s cap about 1 MB with compaction. A crash loses at most the unsaved batch.
   - *Live:* a `nomad.peersockets` room per Live Doc (topic `live-doc:<doc path>`, already scoped to
     the Drive) carries the y-protocols sync messages, so a keystroke arrives in one one-way trip
     instead of the durable path's five or six (75 ms instead of about 400 ms at 75 ms one-way). It
     never writes anything. Each Writer persists only updates whose origin is local, so an update
     that arrived over the wire is saved by its author, not by everyone who saw it.

4. **Presence rides the live room and is never stored.** y-protocols awareness carries cursor,
   selection, name and color (name and avatar from the Writer's Profile Drive). It times out on its
   own when a peer leaves. Readers who are not Writers can see presence; they show as viewers.

5. **Editors are the Drive's Writers.** The durable path needs nothing new: only Writers can append.
   The live path does: today a peersocket peer is a swarm connection key, not a Writer. Peers in a
   live room prove a current Writer key with a signed challenge, the way the AI Bridge proves a Vault
   Writer (ADR-0013). The bg process signs `nonce ‖ handshakeHash` (the Noise handshake hash both
   ends of the connection share, so a proof can't be relayed onto another connection) with the
   Drive's writer keypair, `base.local.keyPair`; pages never hold keys. The verifier takes the
   claimed writer key, opens that writer core and checks the signature against its manifest signer:
   in hypercore 11 a writer key is a manifest hash, not the signing key (as `getWriterSignerKey` in
   `app/bg/hyper/ai-bridge.js` already does). The key is a Writer if it is the Drive's bootstrap key
   or `base.system.get(key)` is present and not removed. A page applies a document update from the
   live room only from a proven Writer; anyone else may only send awareness. There are no
   per-document permissions inside a Drive: the sharing boundary is the Drive, so a page shared
   with different people goes in a different Drive
   (Notion's teamspace). Writers stay fully trusted, as for every other file in a Drive: a Writer can
   delete another Writer's update files, and compaction relies on that.

6. **Compaction keeps opening fast; it does not reclaim disk.** When a Live Doc has more than 256
   update files, the next Writer to open it writes one snapshot (`Y.encodeStateAsUpdate` of a doc
   built from the files it read, as a blob) and deletes those files and the snapshots it merged, in
   **one append batch, snapshot first**. Small batches matter here: compacting 10,000 files in one
   batch took about 5 s and added 5 MB of deletes; 256 take a fraction of a second. A reader that
   sees the snapshot but not yet the deletes has duplicates, which merge away; it can never see the
   deletes without the snapshot. Two Writers compacting at once each write a
   snapshot of what they read; both stay valid. Compaction builds only from files, never from the
   in-memory document, so nothing that arrived over the live room enters storage through it. Because
   Hypercores are append-only, the bytes of deleted files stay in the oplog. Yjs keeps garbage
   collection on (deleted text shrinks to small tombstones), so we keep no per-keystroke history;
   version history is a snapshot the user names (`snapshots/…` with a `label` in `doc.json`), not
   time travel.

7. **The code is a library, not a `nomad.live` API.** It needs only the two small API changes under
   *Consequences*. `nomad://app-stdlib/js/live-doc.js` is a Yjs provider
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
  Deferred. The spike shows each file costs about 1.1 KB of view and system core around 65 bytes of
  Yjs, which raw cores would mostly avoid; with the §3 batching that is a few MB per session, so
  not yet worth the extra machinery. This stays the upgrade path if real use shows docs growing too
  fast. The folder layout above can point at such cores later without changing the merge.
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
- **Two public API changes,** each needing the nomad.dev page, `API_REFERENCE` and `nomad-dts.js`
  together: `nomad.peersockets` peer events carry `writerKey` once proven, and `nomad.fs.writeFile`
  takes `{ inline: true }` for files up to 4 KB (`shared/fs-manifest.mjs` is unchanged; the mobile
  dispatcher passes the option through).
- **Storage grows with editing.** Each file is about 1.1 KB of oplog, view and system core, and a
  delete costs about half that again; nothing shrinks a Hypercore. With the §3 batching, a long
  session by two people is a few MB.
- **The phone reads Live Docs** through `nomad.fs` (durable path only, since the phone has no
  `nomad.peersockets` yet). Phone writes wait for the mobile writable bridge and §3, like every other
  phone write to a Drive.
- **Privacy is the Drive's.** Anyone with the Drive key reads the document and its history of update
  files. A private Live Doc needs an encrypted Drive (ADR-0010 Q4).
- **Removing a Writer** stops their future edits; their past update files stay part of the document,
  as their past files do in any Drive.

## Spike results (2026-10-30)

`app/scripts/spike-live-doc.mjs`: two Writers in one process on the real `shared/fs-core.mjs`
reducer and the app's pinned autobase 7.28.1 / corestore 7.10.1 / hyperbee / hyperblobs, with
yjs 13.6. They replicate over a corestore stream pair that can delay every chunk one way, standing
in for the network. The typing model is about 3.5 characters a second (40 wpm) with one in ten a
backspace and an occasional cursor jump, both people typing at once and each applying the other's
updates live. Numbers are from a Linux container; treat them as orders of magnitude.

**Q1: latency.** Time from B starting a write to A's view holding the file (p50 of 60):

| one-way delay | durable, inline file | durable, blob file | live room message |
| ------------- | -------------------- | ------------------ | ----------------- |
| 0 ms          | 9 ms                 | 11 ms              | <1 ms             |
| 25 ms         | 139 ms               | 191 ms             | 26 ms             |
| 75 ms         | 389 ms               | 542 ms             | 76 ms             |

The durable path costs about 5.5 one-way trips (Autobase and Hypercore round trips), a blob two
more to fetch the bytes from the blobs core. That is fine for edits arriving from someone who isn't
in the room, and too slow to feel live, so the live room stays.

**Q1: size.** 10,000 update files (two people typing nonstop for 83 minutes, 1 s batches; a
27,800-character document) carry 660 KB of Yjs but take 11.1 MB inline: oplogs 4.3 MB, view 4.5 MB,
Autobase system core 2.3 MB. That is about 1.1 KB per file whatever it holds, so the cost is per
file and the fix is fewer files (the 10 s cap in §3), not per-writer cores. RocksDB on disk was
about 5× the logical size before its own compaction.

**Q2: open cost.** Reading and merging 10,000 inline update files takes about 230 ms warm and
1.3 s cold, 0.56 s of which is reopening the Drive. As blobs it is 1.6 s warm, one blob read per
file. After one compaction the same document reads in about 20 ms. At the 256-file threshold the
files add well under 10 ms on top of the snapshot (linear from the 10,000-file number). The first
reader applied files one by one and took 16 to 20 s at 10,000; that is the pending-queue trap in §1.

**Q2: compaction.** Two Writers compacting at once while partitioned, with a new edit landing during
it, converge on the same text with nothing lost and leave exactly two snapshots and the late update.
A snapshot of the 10,000 files is about 230 KB. Deletes cost storage too: compacting all 10,000
took about 5 s and added about 5 MB, which is why compaction runs at 256 files, not once a day.

**Q3: the Writer proof.** Works as written in §5: both ends see the same `handshakeHash`;
`base.local.keyPair` signs; the writer key is not the signing key, and the manifest signer is; a
signature over another connection's hash fails; a reader that was never added and a removed Writer
both fail membership. A Device with several Writer keys for one Drive shows each as its own peer,
which is what presence wants anyway (one cursor per open copy).

**Q4: inline vs blob.** Inline update files are faster to see (two fewer trips) and about 20% smaller
in total (11.1 MB against 13.6 MB). Update files go inline; snapshots, which run to hundreds of KB,
stay blobs so their bytes stay out of the oplog. `nomad.fs.writeFile` can't choose today, so it gains
`{ inline: true }`, refused above 4 KB.

## What v1 built

New Drives can start from a built-in template, picked in the Create Drive dialog or passed as
`nomad.fs.createDrive({ template })`: **Blank** (the default) or **Document**, one Live Doc per
Drive. The list is `app/lib/drive-templates.ts`; `app/bg/hyper/drive-templates.js` sets the manifest
(`type: 'walled.garden/document'`, `fallback: '/index.html'`, collaborative by default) and copies
the template's files from `app/drive-templates/document/`.

- **The library ships inside the Drive, not from app-stdlib** (a change from §7). A Drive's pages
  must work for any peer, and on the phone, which serves pages from its own origin with no nomad://.
  `src/live-doc.js` and `src/main.js` are bundled with Yjs, y-codemirror.next and the Notes editor
  (Markdown with Live Preview) into one `app.js` by `npm run build:drive-templates`. Each Drive keeps
  the version it was made with. The Document is plain Markdown text (`schema: 'text'`); rich text
  and a page tree come later.
- **Compaction isn't one batch** (a change from §6): `nomad.fs` has no batch write, so the snapshot is
  written first and the deletes follow as separate appends by the same Writer. One Writer's appends
  stay in order, so a reader still never sees the deletes without the snapshot. It deletes only the
  files it could read.
- **The Writer proof signs `roomId ‖ handshakeHash`** with no nonce: the handshake hash is fresh per
  connection, and the room id ties the proof to the topic. A Writer that was added but hasn't
  written yet may not have sent its manifest, so the verifier waits up to 3 s for it
  (`app/bg/hyper/writer-proof.js`). Peersocket topics now report their own `join`/`leave`/`writer`
  events, and messages carry `writerKey` (`app/bg/web-apis/bg/peersockets.ts`).
- **The page learns its writer key** from `getInfo().writerKey`.
- **Draft Mode:** the library writes with `{ draft: false }` instead of a path rule in `drafts.js`.
- **Not in v1:** the WebMCP editing tools (§9), named versions, and phone editing.

Tests: `tests/unit/live-doc.test.js`, `writer-proof.test.js` (real Autobases) and
`drive-templates.test.js`.

## Rollout

- **Phase 0 (done):** `app/scripts/spike-live-doc.mjs` answers Q1 to Q4 in process. Still to do:
  the same two Writers on two machines over Hyperswarm, to confirm the trip counts on a real network.
- **Phase 1 (done):** drive templates, the Document template with `live-doc.js` on both paths,
  presence, the Writer proof, `{ inline }` writes, `getInfo().writerKey`, and the docs.
- **Next:** phone editing (its own ADR), the WebMCP editing tools, rich text and a page tree, and the
  `walled.garden/document` and `live-doc` schemas.
- **Later:** Notes as Live Docs (no more conflict copies), named versions in the UI, and per-writer
  cores if Q1 calls for them.
