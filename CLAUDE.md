# Nomad — Claude guidelines

## Releasing & versioning

**Never hand-edit version numbers.** Releases are driven by `standard-version`:

```
npm run release-version                        # patch bump
npm run release-version -- --release-as minor  # or major / 1.2.30
```

In one step this bumps **both** `package.json` **and** `app/package.json` (per `.versionrc`
`bumpFiles`), regenerates `CHANGELOG.md` from the conventional-commit history, makes a
`chore(release): X.Y.Z` commit, and creates the annotated `vX.Y.Z` tag. Then:

```
git push --follow-tags origin main
```

Pushing the tag triggers [`.github/workflows/release.yml`](.github/workflows/release.yml), which
builds desktop (macOS + Linux via electron-builder) **and** the mobile Android AAB/APK, attaching
all of them to one **draft** GitHub release — sanity-check and **publish it manually**.

Why both package.json files matter: `app/package.json` is the manifest the **Electron app actually
reports** (auto-updater + About box). A bump that touches only the root `package.json` ships a
desktop build that mis-identifies its own version — which is exactly the `standard-version` step
that hand-bumping skips. So don't bump by hand; let `standard-version` write both.

The mobile Android `versionName`/`versionCode` are derived from the **tag** in CI, so
`mobile/app.json`'s `version` is only a local-dev fallback and is not part of the
`standard-version` bump. Keep it roughly in step by hand when it matters, but the tag is the source
of truth for the shipped Android version.

See [docs/releasing.md](docs/releasing.md) for the CI jobs, Android signing/keystore, and secrets.

## Keeping the built-in AI prompt in sync with docs

`app/bg/web-apis/bg/ai.js` contains a `NOMAD_API_REFERENCE` constant that is injected as a system prompt into every `nomad.ai.chat()` call. It is a hand-maintained summary of the public JavaScript APIs.

**Whenever you add or change an API**, update all three:
1. `nomad.dev/content/docs/api/apis/<api-name>.md` — the user-facing docs
2. The `NOMAD_API_REFERENCE` constant in `app/bg/web-apis/bg/ai.js` — the in-app AI context
3. `app/userland/editor/js/types/nomad-dts.js` — the `nomad.*` TypeScript declarations that drive
   autocomplete/hover in the code editor (Monaco)

The three should always reflect the same surface area.

## Editor TypeScript types

The Monaco editor (`app/userland/editor/`) gives autocomplete/hover for `nomad.*` and the
walled.garden schemas. Two type sources feed it via `addExtraLib` (see
`app/userland/editor/js/language-service.js`):
- `types/nomad-dts.js` — hand-maintained `nomad.*` declarations (keep in sync, above).
- `types/schemas-dts.js` and `types/schemas-json.js` — **generated** from the Zod schemas by
  `scripts/gen-schema-dts.mjs` (run automatically in `scripts/build.js`). The first gives JS/TS the
  `WalledGarden.*` types; the second is a combined JSON Schema (discriminated on the `type` field)
  registered with Monaco's JSON service so `.json` files get schema autocomplete/validation. Do not edit
  by hand; rerun the build after changing any `app/lib/schemas/walled.garden/*.ts`.

## Adding a walled.garden schema

walled.garden schemas are **content conventions** (Zod records identified by their `type` string), not
`nomad.*` APIs — the AI-prompt/dts sync above does not apply to them. To add one:
1. Create `app/lib/schemas/walled.garden/<name>.ts` (export a Zod schema **and** its inferred type,
   `export type <Name> = z.infer<typeof <Name>Schema>`; copy an existing one for style).
2. Register it in `app/lib/schemas/walled.garden/index.ts` — the schema export, the `type` re-export, the
   `SCHEMAS` map, and the `WalledGardenRecord` union. Import siblings with explicit `.ts` specifiers (the
   gen script loads this module under Node `--experimental-strip-types`, which won't rewrite `.js`→`.ts`).
3. Rerun `node scripts/build.js` (or `scripts/gen-schema-dts.mjs`) to regenerate the editor types. The gen
   script re-execs itself with the type-stripping flag, so no extra flags are needed.
4. Document it in `nomad.dev/content/docs/api/developers/walled-garden-schemas.md`.

## `nomad.fs` is the ONE drive API (ADR-0010)

`nomad.fs` is the single, backend-agnostic filesystem API for `hyper://` drives — files, drive
lifecycle (`createDrive`/`forkDrive`/`configure`), writer management (`createInvite`/`approveRequest`/
`listWriters`/…), and bulk import/export. **`nomad.hyperdrive` and `nomad.autobase` no longer exist
as public APIs** (removed in Phase 4): all userland and the fg-process RPC layer use `nomad.fs`, and
the dts/AI-reference describe only `nomad.fs`. It gives real `stat` (mtime/ctime/size) and real
`get(path, 'json')`. Use `nomad.fs.drive(url)` for a scoped handle or the url-first helpers.

**Internal only:** `app/bg/web-apis/bg/{hyperdrive,autobase}.js` survive as *implementations* that
`bg/fs.js` dispatches to per URL (single-writer Hyperdrive vs multi-writer Autobase). Do NOT
reintroduce `nomad.hyperdrive`/`nomad.autobase` in userland.

**Shared across desktop + mobile:** the method list lives in **`shared/fs-manifest.mjs`** (the single
source of truth). Desktop's `manifests/external/fs.js` re-exports it; mobile builds the same
`window.nomad.fs` surface from it (`mobile/lib/types.ts` NOMAD_SHIM + `mobile/backend/backend.mjs`
`dispatchNomad` for `api:'fs'`). So a drive app written to `nomad.fs` runs on both platforms — on
mobile, reads work; writes + writer-management currently reject until the mobile writable-bridge lands.
When you add/rename an fs method, edit `shared/fs-manifest.mjs` AND update `bg/fs.js`, `fg/fs.js`, the
mobile shim + dispatcher, plus `nomad-dts.js` / `NOMAD_API_REFERENCE` / nomad.dev docs.

### Draft Mode (ADR-0012)

`nomad.fs` has a **Draft**: device-private staged edits held out of a Drive's replicated log until
**Publish**. It's hosted in the **Vault** (`/.drafts/<baseKey>/…`) — the one base every Device already
writes — so it syncs across your Devices with **no wire-format change and no §3 dependency**. Logic
lives in `app/bg/hyper/drafts.js` (desktop) and `mobile/backend/lib/drafts.mjs` (mobile); the facade
(`bg/fs.js`) routes writes→stage / content-reads→merge when Draft Mode is on (or `{ draft:true }` is
passed), and adds `beginDraft`/`endDraft`/`draftStatus`/`publishDraft`/`discardDraft`/`watchDraft`/
`setDraftPreview`. Reads stay on the published view unless `{ draft:true }`; the serve path
(`bg/protocols/hyper.js`) previews the merge **only** for the author's own tab (never for peers — the
Draft never replicates). The rendered-preview toggle is a **pen-nib icon in the location bar** (`fg/shell-window/navbar/location.js`,
left of the peers/share button → `bg.views.toggleDraftPreview` → `bg/ui/tabs/manager.js`), shown when
the tab's Drive has a Draft (`pane.hasDraft`). It flips a **per-Drive** preview flag
(`drafts.setPreview`/`isPreview`, keyed by hex Drive key — NOT webContentsId, which the stream-protocol
request doesn't reliably carry) and reloads. Two things then merge while a Drive is previewed: the serve
path (`bg/protocols/hyper.js`, `drafts.isPreview(driveKey)`) for directly-served files, AND **`nomad.fs`
reads at runtime** (`bg/fs.js` treats `drafts.isPreview(baseKey)` like `{draft:true}`) so a drive app
rendered in the tab reads its own merged content. Because it's per-Drive, the editor/explorer pass an
explicit `{ draft:false }` when their own Draft Mode is off so a preview flag can't leak into their
published reads. Publish re-homes staged blobs into the base Drive's writer and is gated to
Devices that can write the Drive. Overlay semantics are locked by `tests/unit/drafts-overlay.test.js`.

### The Autobase wire format (`FS_FORMAT_VERSION 1`)

The Autobase view is a Hyperbee (`valueEncoding: 'json'`) of path → `{ metadata:{mtime,ctime,executable?},
blob:{core,...hyperblobsId}|null, value:base64|null }`. File **content** is a `blob` in the owning
writer's per-writer Hyperblobs core (written **outside** `apply`; only the pointer is in the oplog);
small control records + apply-authored writer-records are **inline** `value`. The one reducer + blob
helpers live in `nomad/shared/fs-core.mjs` and are shared byte-for-byte with mobile — guarded by
`tests/unit/fs-core-golden.test.js`. **Never** change the record/op shape without bumping
`FS_FORMAT_VERSION`, regenerating the golden, and keeping both runtimes' dep pins identical, or
replication fails with `DECODING_ERROR`.

### Internal backend dispatch (bg only — userland never sees this)

`bg/fs.js` picks between two **internal** backend impls per URL; these are NOT public APIs:
- `bg/hyperdrive.js` — a single-writer Hyperdrive; its read API **fails on an Autobase core**, so it's
  used only for `hyper://private/`, profile, and external Hyperdrives.
- `bg/autobase.js` — a multi-writer Autobase (linearised Hyperbee view); `list(prefix)` is a flat
  Hyperbee key-range scan (recursive). This is the backend for all new drives.
- Backend detection is only reliable for locally-known/loaded drives (`isCollaborativeDrive` returns
  **false** for a never-loaded remote drive), so `bg/fs.js` reads with a try-detected-then-other
  fallback. Userland just calls `nomad.fs` and never does this dance.
- `bg/filesystem/index.js getDriveIdentFull` deliberately **skips `getOrLoadDrive` for autobase keys** (it
  hangs) and reads `index.json` from the already-loaded collaborative session instead.

## Blog & Reader (walled.garden feeds)

`walled.garden/feed` (a drive's `index.json`) marks a drive as a feed; a **blog** is a feed whose items are
`walled.garden/post` records stored directory-per-post under `/posts/<YYYY-MM-DD-slug>/` (`post.json` +
`post.{md,html,txt}` body; legacy posts used `index.*` and consumers still read those — the rename keeps
`/posts/<slug>/` a navigation MISS so the manifest-`fallback` shell serves the themed post there, ADR-0009
amendment). The built-in **`nomad://reader`** (`app/userland/reader/`) subscribes via
`walled.garden/follows` and aggregates posts across both drive backends. Feed recognition sets `ident.feed`
(see above), surfaced as a "Subscribe in Reader" button in `userland/site-info/js/com/identity.js`. New
internal apps register in `bg/protocols/nomad.js` (pass `{ fallbackToIndexHTML: true }` for SPA routing) and
get a menu entry in `fg/shell-menus/browser.js`. See `docs/adr/0008` and `0009`.

## Drive templates live in `nomad.dev`

The "Create Drive From This Template" starter drives (forum, blog, microblog, …) live in the sibling
**`nomad.dev`** repo (`static/templates/` + `content/docs/templates/`), not here. See `nomad.dev/CLAUDE.md`
for how a template is structured and how to add one.
