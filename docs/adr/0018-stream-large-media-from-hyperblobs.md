# Stream large media (video/audio) straight from Hyperblobs

**Status: Proposed.** Drafted 2026-10-09. Brings Nomad in line with the Pears guide
[*Stream stored video in a peer-to-peer app*](https://docs.pears.com/p2p/how-to/stream-and-share-media/stream-stored-video-in-a-peer-to-peer-app/#publish-each-video-as-a-hyperblob).
That guide publishes each video as a Hyperblob, shares the blob id, and lets a player seek through it
with HTTP Range requests that pull only the blocks it needs from peers. Nomad already stores files
that way. What it lacks is the read and write path above the store: every layer between the
Hyperblobs core and the `<video>` element turns the file into one in-memory `Buffer`.

## Where Nomad is today

The **storage** half is already done, and it is the expensive half. On an Autobase Drive (all new
drives, ADR-0010), a file's bytes live in the owning writer's per-writer **Hyperblobs core**, and
only a pointer travels through the oplog. The pointer is `{ core, blockOffset, blockLength,
byteOffset, byteLength }` (`shared/fs-core.mjs` `createBlobStore`). This is the Pears pattern, one
blob per file. Replication is sparse, so a peer only fetches the blocks it reads.

The **I/O** half buffers at every layer:

| Layer | File | What it does today | Effect on a 2 GB video |
| --- | --- | --- | --- |
| Desktop serve, Hyperdrive drives | `app/bg/protocols/hyper.js` `checkoutFS.drive.get(entry.path)` | Reads the **whole file**, then slices it for the Range | The first byte waits for all 2 GB. Seeking repeats the download. |
| Desktop serve, Autobase drives | same file, `serveAutobase` → `autobases.resolveRecordContent(record, readRange)` → `Hyperblobs.get(id, range)` | Reads the requested range **into one Buffer** before it responds | Chromium's first request is `Range: bytes=0-`, an open-ended range, so this is the whole file again |
| Desktop `HEAD` | both paths | Answers `204` | Some players treat 204 as "no body" and never learn the length |
| Mobile gateway | `mobile/backend/lib/http-gateway.mjs` `res.end(result.buffer)` | **No Range support.** Always `200` with the full body | The WebView can't seek, and nothing plays until the whole file arrives |
| Write, `nomad.fs.writeFile` | `app/bg/hyper/autobases.js` `buildPutBlobOp` → `putBlob(bytes)` | One `Buffer` crosses the RPC and goes into `Hyperblobs.put` | A large upload holds the whole file in memory in both processes |
| Import, `importFromFilesystem` / `importDirectory` | `autobases.js` `nodefs.readFile(fullSrc)` | Reads each file fully into memory | The same problem, for files dropped in from disk |
| Peer fetch | `fs-core.mjs` `resolveBlob` | `blobs.get(id, range)` with no prefetch | Playback stalls at each block boundary while a single block round-trips |

So a video in a Nomad drive replicates correctly, but it plays like a download. You wait for the
whole file, seeking doesn't work on mobile, and memory grows with file size.

## Decision

### 1. No format change: a large media file is an ordinary blob record

The Pears guide's "publish each video as a hyperblob" is already Nomad's v1 record. We do **not**
add a media record type, a separate media core, or a manifest of blob ids. A video at
`/videos/talk.mp4` is a `put` with a `blob` pointer, like any other file. `FS_FORMAT_VERSION` stays
`1`, and `tests/unit/fs-core-golden.test.js` does not change. Links stay plain drive URLs
(`hyper://<key>/videos/talk.mp4`), not blob-server URLs, so permissions, CSP, Draft preview
(ADR-0012) and `fallback` routing (ADR-0015) all apply unchanged.

### 2. Read path: stream ranges, never buffer them

- **`shared/fs-core.mjs` gains `createContentStream(record, { store, start, end, signal })`** next
  to `readContent`. An inline `value` is sliced from the record. A `blob` record returns
  `Hyperblobs.createReadStream(id, { start, end, wait: true, timeout })`. It is a pure helper with no
  wire-format effect, and both runtimes share it.
- **Desktop serve (`bg/protocols/hyper.js`)**: the Autobase path pipes that stream into the response
  in place of `Readable.from(buf)`. The Hyperdrive path uses `drive.createReadStream(path, { start,
  end })` in place of `drive.get`. Range handling then works the same on both paths:
  - Open-ended ranges (`bytes=N-`) stream to the end of the file. Because the body is a stream, an
    open range costs nothing when the player cancels it to seek.
  - `HEAD` returns `200` with `Content-Length`, `Accept-Ranges: bytes` and no body. It stops
    returning `204`.
  - When the client aborts a request (a seek, or the tab closing), the stream is destroyed so we
    stop pulling blocks from peers.
  - Markdown rendering and `.goto` keep their current buffered reads. Both are small text files,
    and they are never ranged.
- **Mobile gateway (`http-gateway.mjs`)** gets the same Range/`206`/`Content-Range`/`HEAD`
  behaviour from the same shared parse-and-stream helper. `drive-manager.mjs` `resolve` returns the
  record, so the gateway can stream it, in place of `{ buffer }` for media types.

### 3. Readahead: prefetch a window ahead of the playhead

Following the guide's advice to download ahead of playback, each ranged blob read starts a
**bounded readahead**: `core.download({ start: block, end: block + READAHEAD_BLOCKS })` over the
blocks just past the requested range. The default is about 8 MB. The `Range` it returns is cancelled
when the response stream closes or the next ranged request arrives for the same file and tab. It
only applies to blob records whose MIME type is `video/*` or `audio/*`, so ordinary page loads are
unchanged. We do not download the whole file eagerly. Watching a talk should not mirror a 2 GB file
onto a viewer's disk.

### 4. Write path: stream ingest; the pointer is appended only once the blob is complete

- **`createBlobStore` gains `putBlobStream(blobs, readable)`**. It wraps `Hyperblobs.createWriteStream()`
  and resolves to the same canonical pointer that `putBlob` returns.
- **`importFromFilesystem` / `importDirectory`** stream each file from disk with
  `fs.createReadStream` and stop calling `readFile`.
- **`nomad.fs.writeFile(url, data)` accepts a `Blob`/`File`** (for example from `<input type=file>`
  or a drop). The fg shim sends it to bg in chunks, and bg streams the chunks into
  `putBlobStream`. Small strings and Buffers keep the current single-shot path.
- **Atomicity is unchanged.** The `put` op with the pointer is appended **once, after** the blob
  stream finishes. A crashed or aborted upload leaves orphaned blocks in the writer's own blobs
  core, which are never referenced and never replicated as a file. No peer ever sees a half-written
  video.
- Optional `onProgress` for uploads is surfaced through the existing `'readable'` RPC type. It is a
  follow-up, not part of v1.

### 5. Draft Mode composes without special cases

Staged media goes into the Vault's draft-blobs core (ADR-0012 §3) through the same
`putBlobStream`. Preview serving already resolves through `drafts.previewNode`, which returns a
record, so it streams the same way. **Publish re-homes blobs by streaming core to core**
(`createReadStream` → `createWriteStream`), not `get` then `put`. Otherwise publishing a drafted
video holds the whole file in memory.

### 6. Seeding is Hypercore's default; there is no new policy

Blocks a viewer watched stay in their corestore and are served back to other peers. This is how
the Pears guide's viewers become seeders. Disk is reclaimed through the existing "clear drive
cache" path. A per-drive "keep a full copy" pin (`core.download()` with no range) is listed under
follow-ups. It is not part of this decision.

## Considered options (rejected)

- **Run `hypercore-blob-server` (the guide's local HTTP server) on desktop.** It would serve
  `http://127.0.0.1:<port>/?key=…&blob=…` links. That is a second origin outside the `hyper://`
  protocol handler, so it bypasses the per-origin CSP, the permission model and Draft preview, and
  leaks raw blob ids into page markup. Nomad already has an in-process protocol handler. What that
  handler lacks is streaming, not a server.
- **Use `hypercore-blob-server` behind the mobile gateway.** The gateway already is a loopback HTTP
  server. Adding Range support to it is about as much code as integrating the package, and keeps
  one serve path on mobile. We should revisit this if the package gains features we want, such as
  its prefetch heuristics.
- **A dedicated media core per video.** One Hyperblobs core per file would make it easy to delete
  or pin a single video, but it changes the record shape (a `FS_FORMAT_VERSION` bump), multiplies
  the cores each peer must open and announce, and breaks the "one writer, one blobs core" rule
  that Draft re-homing relies on.
- **Cap open-ended ranges, for example respond to `bytes=0-` with only the first 4 MB.** This is a
  common workaround for buffered servers. Once the body is a stream it isn't needed. It also
  confuses players that trust `Content-Length`.
- **Transcode, HLS/DASH segmenting, or "faststart" rewriting on import.** These need ffmpeg in
  both runtimes, and they are a product decision, not a transport one. Docs will advise authors to
  publish fast-start MP4 (`moov` atom first) or WebM, which seek over plain Range requests.

## Consequences

- Video and audio in a drive play like they would from a static host: the first frame arrives
  after a few blocks, seeking works on desktop and mobile, and memory stays flat whatever the file
  size.
- Large uploads and imports stop risking out-of-memory in the renderer and in bg.
- The shared `fs-core.mjs` grows two helpers (`createContentStream`, `putBlobStream`). Both are
  read- or write-side only, with no change to the oplog, so both runtimes must pin compatible
  `hyperblobs` versions as they already do. CI should include a byte-for-byte test that a ranged
  stream equals `get(id, range)`.
- **API sync (CLAUDE.md triad):** `writeFile` accepting `Blob`/`File` is a public-surface change.
  Update `shared/fs-manifest.mjs` (only if a new method is added), `nomad-dts.js`, `API_REFERENCE`,
  and `nomad.dev/content/docs/api/apis/fs.md`, and add a nomad.dev how-to "Publish a video in a
  drive".
- New tests: Range/`206`/`HEAD` on both serve paths (desktop protocol, mobile gateway), aborting a
  request mid-stream releases the readahead, and an aborted streaming write appends no op.

## Implementation phases

1. **Read streaming.** `createContentStream`, the desktop Autobase and Hyperdrive serve paths, the
   `HEAD` fix, and abort handling. This fixes the reported problem on desktop.
2. **Mobile gateway Range + streaming.**
3. **Readahead** for `video/*` and `audio/*`.
4. **Streaming ingest.** `putBlobStream`, streaming `importFromFilesystem`, and `writeFile(Blob)`
   with the API sync.
5. **Draft re-home streaming.**

Follow-ups, not in scope: a per-file "keep offline" pin, upload progress, poster/thumbnail
conventions (a `walled.garden/video` schema), and live streaming (an append-only core of segments,
which is the guide's sibling *live* how-to).
