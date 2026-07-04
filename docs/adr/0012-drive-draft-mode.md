# Drive Draft Mode — device-private staging hosted in the Vault

**Status: Proposed.** Designed 2026-07-04 (grill session). Adds a **Draft** to any writable Drive:
a set of unpublished file writes/deletes that stay private to the user's own Devices until
**Published**. The load-bearing decision is *where the Draft lives* — **inside the Vault** — which
delivers cross-Device sync in v1 with **no wire-format change and no dependence on the unbuilt
per-drive device writer key** (multi-device-protocol §3). See CONTEXT.md → *Drafts* for the canonical
terms (Draft / Draft Mode / Publish).

## The constraint that forces the design

A Drive is an Autobase: anything appended to its oplog linearises into the signed Hyperbee view and
**replicates to every peer holding the key** (`shared/fs-core.mjs`, `app/bg/hyper/autobases.js`). So
the existing per-Post `draft: true` flag (`app/lib/schemas/walled.garden/post.ts`) is — per ADR-0009 —
*"obscure, not private"*: the bytes still reach every follower. A genuinely private Draft therefore
**must not enter the shared Drive's oplog** until Publish; the staged content has to live somewhere
else, and "Publish" is the act of replaying it into the real Drive.

## Decision

1. **Draft is a Drive-wide staging layer**, not an item flag. It stages writes/deletes for *any* path
   (blog Post, `index.html`, app code, `/index.json`). The per-Post `draft` field is a separate,
   weaker axis (replicated-but-feed-hidden) and is left as-is; the two can co-occur.
2. **Device-private, not local-only.** A Draft syncs across the user's own Devices but is invisible to
   followers. ("Other people" excludes your own Devices.)
3. **Drafts live in the Vault.** Records at `/.vault`-sibling path `/.drafts/<baseDriveKey>/<path>`
   using the existing v1 record shape; file bytes go in a **dedicated, purgeable draft-blobs core** in
   the Vault's namespace (not the Vault's main writer blob core, so publish/discard can reclaim it).
   This reuses the one property that makes it cheap: **every Device is already a Writer of the Vault**
   (`app/bg/hyper/vault.js` `ensureVault()` → writable session), and the Vault replicates only among
   the user's Devices. No `FS_FORMAT_VERSION` bump (same format, new paths); no §3 dependency.
4. **Reads merge Draft-over-base with tombstones.** In Draft Mode the editor/explorer show staged
   files merged over the published view; a staged delete reads as absent.
5. **Rendered preview is a per-tab toggle, default published.** A normal browsing tab renders the
   published Drive (what peers see); a "Preview Draft" toggle renders the merged view. This is safe to
   offer because the author's local serve path (`app/bg/protocols/hyper.js`) only feeds the author's
   own tabs — remote peers render from what *they* replicated, and the Draft never replicates to them.
   **The serve/replication path is never made Draft-aware for peers**; that boundary is the privacy
   guarantee.
6. **Publish = whole-Draft by default, subset optional.** Publish replays staged entries onto the base
   Drive as one append-batch + one `update()` (a selected subtree lands atomically), then clears those
   entries from the Draft. Subset selection operates on logical subtrees (e.g. `/posts/<slug>/`) so a
   Post body can't publish without its `post.json`.
7. **Scope: any writable Drive except the Vault** (which hosts Drafts — drafting it is recursive).
8. **Publish detects and warns on conflicts.** Each staged entry records the base record observed at
   stage time; at Publish, if the base's current record differs (a co-Writer or another Device changed
   it), those paths are flagged and the user chooses proceed / skip / cancel. Never fires on solo
   Drives. No 3-way merge (Autobase has no checkout — ADR-0010 Q5).
9. **Entry: explicit per-Drive toggle, default off; auto-on for agentic AI sessions.** Normal edits
   stay live-by-default (today's behaviour). Starting an AI Sidebar agentic session auto-enables Draft
   Mode so the agent's writes stage; the user reviews the whole Draft then Publishes or **Discards**
   (a coarse "throw away all the agent's work" that complements per-Checkpoint revert). Applies in both
   the editor and the explorer (both host the AI Sidebar).
10. **Mobile: shared API from v1.** The draft methods go in `shared/fs-manifest.mjs`; both runtimes
    expose them. Mobile can **stage / preview / discard** (Vault writes already work there). **Publish**
    succeeds for Drives writable on that Device and otherwise rejects with a clear "Publish from the
    owning Device" message (the §3 paired-into-write limit). First-class flow: draft on phone, Publish
    on desktop.

## Considered options (rejected)

- **Per-Post `draft` flag only.** Already exists; cannot be private (bytes replicate). Fails the
  requirement. Kept for the orthogonal "published-but-unlisted" case.
- **Local-only Draft (never replicates anywhere).** Simplest, zero infra, but the Draft is stuck on one
  Device — no "draft on laptop, finish on phone." Rejected against the multi-device expectation.
- **A separate Draft Autobase per Drive** (my Devices as writers). Cleaner separation and independently
  purgeable, but every Device writing it needs **per-drive device writer keys** (multi-device-protocol
  §3) — an unbuilt protocol change blocked by the exclusive-`local`-core deadlock, because only the
  Vault legitimately holds each Device's `local` core. Any separate base reintroduces §3; only the
  Vault avoids it. Rejected for v1; revisit if the Vault's growing role becomes a problem.
- **Draft-by-default (CMS model): all edits stage until Publish.** Coherent and safest, but flips
  Nomad from live-by-default to publish-on-demand — a large behavioural break from today's immediate
  writes. Rejected as too surprising for v1; the explicit toggle keeps the door open.

## Consequences

- **The Vault's role expands** from "index of Spaces + Devices" to "also holds in-flight Drafts"
  (reflected in CONTEXT.md → Vault). Draft content is as private/encrypted as the Vault itself.
- **Draft blob retention.** Hypercores are append-only, so draft bytes aren't reclaimed on peers by
  deletion. Keeping them in a **dedicated draft-blobs core** (not the Vault's main blob core) lets a
  Device stop replicating and locally purge that core after Publish/Discard; bytes already fetched by
  another Device persist there until it purges too. Acceptable; documented.
- **Publish re-homes blobs.** A staged blob points at the Vault's private draft-blobs core, which
  followers can't resolve, so Publish must re-`putBlob` the bytes into the **base Drive's** per-writer
  Hyperblobs core before appending the put op.
- **No wire-format change.** Same v1 `{ metadata, blob|value }` records; only new Vault paths. No
  golden-vector/parity impact.
- **Mobile Publish is Device-gated** by §3 (above) — a real limitation, surfaced as a clear message,
  not a hang.
- **Draft ⟂ Checkpoint.** A Checkpoint (ADR-0011) is local undo of an AI turn's writes; a Draft controls
  replication. Reverting a Checkpoint in Draft Mode rewrites the Draft layer; Discarding a Draft throws
  away everything regardless of Checkpoints.

## Implementation touchpoints (non-binding)

New `app/bg/hyper/drafts.js` (overlay lifecycle: stage/merge-read/publish/discard over the Vault);
draft-aware read/write routing + new methods in `shared/fs-manifest.mjs`, `app/bg/web-apis/bg/fs.ts`,
`fg/fs.js`, and the mobile shim/dispatcher; Draft-aware local serve for the preview toggle in
`app/bg/protocols/hyper.js`; Draft Mode toggle + "N unpublished changes" + Publish/Discard UI in
`app/userland/editor/` and `app/userland/explorer/`; the three-way doc sync (`nomad-dts.js`,
`NOMAD_API_REFERENCE`, nomad.dev docs) per CLAUDE.md. No `FS_FORMAT_VERSION` change.

## Rollout

Dependency spine: **P0 → P1 → {P2, P3, P4} in parallel → P5**. No wire-format change in any phase.

- **Phase 0 — Draft core + spike.** `app/bg/hyper/drafts.js` (stage/merged-read/list/publish/discard
  over the Vault session; publish re-homes blobs via `buildPutBlobOp(baseSess,…)` + one
  `base.update()`; conflict = observed-base-record vs current). Throwaway `app/scripts/spike-draft-overlay.mjs`
  proves overlay/merge/publish/conflict against the real `shared/fs-core.mjs` reducer, in-process. Unit
  tests: merge precedence, tombstone, subset-publish atomicity, conflict detection.
- **Phase 1 — Routing + API.** Add `beginDraft`/`endDraft`/`draftStatus`/`publishDraft`/`discardDraft`
  (+ `watchDraft`) to `shared/fs-manifest.mjs`; reads/writes gain a `{ draft:true }` opt (no manifest
  change). `bg/web-apis/bg/fs.ts` + `fs-router.ts` consult `drafts.getMode()`/the opt and route
  writes→stage, reads→merged. Three-way doc sync.
- **Phase 2 — Preview serve.** `bg/protocols/hyper.js` renders the merged view for the author's own
  tab when "Preview Draft" is on (per-pane flag); never affects replication.
- **Phase 3 — Desktop UI.** Draft Mode toggle, unpublished-count badge, Publish (whole + subtree) with
  the proceed/skip/cancel conflict dialog, Discard, Preview toggle, in `userland/editor` + `userland/explorer`.
  AI Sidebar auto-enables Draft Mode on agentic session start (both hosts).
- **Phase 4 — Mobile parity.** Mobile shim + dispatcher implement the lifecycle against the mobile
  Vault; stage/preview/discard work; Publish gated to Devices that own the Drive (§3).
- **Phase 5 — Docs, tests, retention.** Desktop/mobile parity tests; purge the `draft-blobs` core on
  publish/discard; nomad.dev Draft Mode page.

Live-runtime gates (unverifiable offline): cross-Device draft sync over a real swarm; blob re-home
resolved by a follower; concurrent Publish from two Devices.
