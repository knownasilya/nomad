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

For a beta, add `--prerelease beta` (`1.22.0-beta.0`). The workflow marks a tag with a `-` as a
GitHub prerelease, which only apps with **Beta releases** turned on update to (desktop
`auto_update_prerelease`, mobile `hb:updates-beta`). See docs/releasing.md, "Cutting a beta release".

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

The Mac app is signed with a free **self-signed** certificate (`NOMAD_MAC_CERT`, made by
`scripts/make-mac-signing-cert.sh`), not an Apple Developer ID. Don't drop back to ad-hoc signing:
Squirrel.Mac rejects every update to an ad-hoc build ("code failed to satisfy specified code
requirement(s)"), and a build signed with a different certificate can't update either.

## Keeping the built-in AI prompt in sync with docs

`app/bg/ai/api-reference.mjs` is the hand-maintained summary of the public JavaScript APIs. It exports two strings:

- `STANDING_PROMPT` is the system text every `nomad.ai.chat()` turn receives. It teaches the two tools the model is offered, `search` and `execute`. `PERSONAL_PROMPT` is added on a personal turn (the user's own AI): Names, Notes and Reader.
- `API_REFERENCE` is the guide corpus. `search` (`app/bg/ai/search-execute.mjs`) splits it on `##` headings into entities such as `guide:nomad.fs` and `guide:nomad.fs#draft-mode`, and returns a section when the model opens that entity. Stable ids for the current headings live in `GUIDE_IDS` in that file. A new `##` heading still appears; its id is slugged until you add a prefix there.

**Whenever you add or change an API**, update all three:
1. `nomad.dev/src/content/docs/docs/api/apis/<api-name>.md` — the user-facing docs
2. `API_REFERENCE` in `app/bg/ai/api-reference.mjs` — the guide `search` serves. Edit `STANDING_PROMPT` in the same file when the every-turn instructions need to change.
3. `app/userland/editor/js/types/nomad-dts.js` — the `nomad.*` TypeScript declarations that drive
   autocomplete/hover in the code editor (Monaco)

The three should always reflect the same surface area.

`search` and `execute` are model tools on the chat turn (`MODEL_TOOLS` in `app/bg/ai/search-execute.mjs`), wired in `app/bg/web-apis/bg/ai.ts`. `execute` forks `app/bg/ai/execute-worker.mjs` via `app/bg/ai/execute-host.mjs`. The worker stays a real `.mjs` on disk: the utility process loads that path, and the chat bundle does not inline it.

A program on this machine can call the same two tools over MCP at `http://127.0.0.1:47655/mcp` (`app/bg/ai/localhost-mcp.mjs`, started from `ai.ts`). It binds to loopback. A call from another program uses the focused window's active tab. A chat turn on a CLI runtime (Claude) uses the same MCP, but `runChat` opens a turn (`openTurn`) and the CLI sends its token in the `x-nomad-turn` header, so each call runs with that turn's sender, drive, catalog, prompts and tool events. An unknown token fails; it never falls back to the focused tab (ADR-0021). `NOMAD_MCP=0` turns it off. `NOMAD_MCP_PORT` changes the port. Leave `search` and `execute` out of the nomad.dev API pages and out of `nomad-dts.js`. `nomad.ai.listTools()` returns `{ builtin, capabilities, page, pageOrigin, pageGranted }`. `builtin` is search and execute. `capabilities` is the catalog behind search, with the same write and vision gates `execute` enforces. If the nomad.dev `listTools` page describes that return value, keep `capabilities` in it.

## WebMCP page tools (`document.modelContext`)

Nomad polyfills the [WebMCP](https://webmachinelearning.github.io/webmcp/) standard so a page can
register tools the built-in AI assistant can call. The polyfill (`@mcp-b/webmcp-polyfill`) is
injected into every eligible page's **main world** by `app/fg/webview-preload/model-context.js`
(same technique as `prompt.js`); tool descriptors + invocations are bridged to bg by
`app/bg/web-apis/bg/model-context.ts` (pure helpers split into `webmcp-schema.ts` +
`webmcp-invoke.ts`, both unit-tested). `bg/ai.ts` `runChat` lists them in the `page` domain of
`search` on a local turn with page tools enabled. `execute` calls one as `nomad.page.<registeredName>(params)`.
The host invokes it as `page_<name>` through `invokePageTool`, gated once per origin by the
`webmcpTools:<origin>` permission. **Local path only** — page tools are never sent over the AI Bridge.
This is a web-platform API, so the sync triad above does not apply; the touchpoints are the
`## Page-provided tools (WebMCP)` section of `API_REFERENCE` (guide id `webmcp`), a `Document`/`Navigator`
block in `nomad-dts.js`, and `nomad.dev/src/content/docs/docs/api/developers/webmcp.md`.

**Debugging:** `nomad://webmcp` (the WebMCP Inspector app — `app/userland/webmcp/`, backed by
the internal `webmcp-devtools` API over `bg/model-context.ts`'s `listAll()` / `getInvokeLog()` /
`events`) lists every tab's tools, runs them by hand, and streams a live call log. Lower level:
in a page, `window.__nomadWebmcp.status` / `.tools()` / `.call(name, args)` and
`localStorage['nomad-webmcp-debug']='1'` for verbose `[webmcp]` console traces; in bg, every
event goes to the `webmcp` log category and `NOMAD_WEBMCP_DEBUG=1 npm start` mirrors it to the
terminal. Failure table + symptoms in the doc above.

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
4. Document it in `nomad.dev/src/content/docs/docs/api/developers/walled-garden-schemas.md`.

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
mobile shim + dispatcher, plus `nomad-dts.js` / `API_REFERENCE` in `app/bg/ai/api-reference.mjs` / nomad.dev docs.

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

### Reader and Notes data lives in the Vault (ADR-0017)

`nomad://reader` subscriptions (per Space) and read marks, and `nomad://notes` notes (per user), go
through the internal `nomad.vault` API (`readerState`/`readerFollow`/…/`listNotes`/`saveNote`/
`deleteNote`/`renameNoteLinks`/`watchAppData`, backed by `bg/web-apis/bg/vault-apps.ts`). They are
Vault records, so the phone sees them (`mobile/components/Reader.tsx`, `Notes.tsx`, over `RPC_APPS`). Both
reload while open when the phone's backend pushes `RPC_VAULT_CHANGED` (`backend.onVaultChange`), as
desktop's pages do on `watchAppData()`.
The record layout and the shared rules (titles, `[[links]]`, conflict copies, read marks) are
`shared/vault-apps.mjs`, used by desktop and mobile (tests: `tests/unit/vault-apps*.test.js`). The
first write makes a Vault; a solo Vault can still join another one and bring its data (`adoptVault`).

The Notes editor (`app/userland/notes/js/editor/`, CodeMirror 6, Obsidian-style Live Preview) is
bundled into `notes/js/main.build.js` by `scripts/build.js`, and into the phone's WebView page
`mobile/lib/noteEditorHtml.ts` (committed) by **`npm run build:note-editor`** — rerun that after
changing the editor or `shared/vault-apps.mjs`.

### The canvas in Notes and Reader

Notes and Reader each have a List / Canvas switch: dots and lines laid out by a small force
simulation, with an arrowhead at the end a link points to. The canvas is shared:
`app/userland/app-stdlib/js/graph/layout.js` (the layout), `view.js` (SVG drawing, pan, wheel and
two-finger pinch zoom, tap to select on touch) and `app-stdlib/css/graph.css` (the `--graph-*`
colors). Each app only builds its graph: `notes/js/graph.js` (`noteGraph`, notes and their links)
and `reader/js/graph.js` (`readerGraph`: saved articles around their topic hubs, posts around their
feed, a post joined to a topic its tags name). nomad://reader is not bundled, so it imports both
the first time the canvas shows. The phone draws the same canvas in a WebView
(`mobile/components/Canvas.tsx`) from `mobile/lib/canvasHtml.ts` (committed), which
**`npm run build:canvas`** bundles from `app-stdlib/js/graph/phone.js`: rerun it after changing the
canvas or either graph.

### Names (ADR-0018)

The user's short names for Drives, app folders and URLs live in the Vault (`/.vault/names/`, rules in
`shared/names.mjs`, kept in memory by `app/bg/hyper/names.js`). `hyper://<name>/` is resolved **only**
where the user navigates (`ui/tabs/pane.js` `loadURL` and `onWillNavigate`) and in the AI's drive tools
(`drive` argument in `bg/web-apis/bg/ai.ts`). Don't resolve names in the hyper:// protocol handler or
in `nomad.fs` for pages: that gives a Drive a second origin and lets any page probe the user's names.
Only the user's own AI gets names and `drive`: the AI Sidebar (`ai-shell.ts`), the phone's AI panel over
the Bridge, and the loopback MCP. That is a **personal turn**. Each turn has a **stage**
(`app/bg/ai/stages.mjs`, ADR-0021): `page` (a page's `nomad.ai.chat()`, never personal), `sidebar`,
`phone` and `outside` (the loopback MCP). `ai.ts` `chat()` sets `page`; the phone's WebView handler sends
`personal: false`, and the Provider maps a remote turn to `phone` or `page` only (`remoteStage`). Keep it
that way for any new chat entry point.

### The assistant is not tied to a tab (ADR-0021)

The AI Sidebar and the phone's AI panel each keep one conversation, not one per site. The sidebar's
open state and width belong to the window (`toggleAiSidebarOpen` in `bg/ui/windows.js`), so it stays
open across tabs. Their turns have
no Drive of their own: `runChat` passes a `currentTab` lookup, and `executeTool` calls it on every call
(live in the sidebar's window; on the phone, the `tab` snapshot the phone sends). That tab is the call's
sender, so a permission prompt is for the tab's site, and `askOncePerTurn` keeps one answer per
permission and site. The `currentTab` capability tells the model the tab. A read without `drive` uses
the tab's drive; a write must name its drive (`pickToolDrive`). The Drive's own AI Config
(`/ai/system.md`) is skipped for these turns. A `write` tool event names its `drive`, so the sidebar's
Revert and the phone's Draft banner work per drive. The sidebar's sessions live in
`hyper://private/.ai-chat/sessions/`; its model choice is the `ai_sidebar_prefs` setting, with vision
per model.

### Steering a running turn

The AI Sidebar and the phone's AI panel keep their input open while the assistant works. A message
sent then is **steered** into the running turn instead of waiting for it to end (Stop stays). The
queue is `app/bg/ai/steering.mjs`: the local loop in `runChat` adds waiting messages as a user
message before its next model call (after tool results, or when the model would stop); a CLI turn
gets them on its next loopback-MCP result (`withSteer`); a Bridge turn forwards them as `STEER`
frames and the Provider's loop answers `STEERED` (`shared/ai-bridge.mjs`). Every delivery emits a
`steer` event, and the UI moves the message into the transcript there. A message nothing read
(an older Provider, the turn was ending) is sent as the next turn; after Stop or an error it goes
back in the input. The sidebar steers through `aiShell.steer`/`unsteer` by the `turnId` it passes
to `chat`; the phone through `RPC_AI_STEER`/`RPC_AI_UNSTEER` (`mobile/lib/aiSteer.ts`). Page
turns (`nomad.ai.chat()`) and Jobs never steer. **Send now** on a queued message (`steering.now()`,
`aiShell.steerNow`, `RPC_AI_STEER_NOW`, the `STEER_NOW` frame) stops the model call in flight
(`runStep`: the text so far stays in the history, a CLI is stopped and run again) or, while tools
run, lets the running one finish and skips the rest of that round (`SKIPPED_FOR_STEER`); the loop
reads the message before its next call.

### Generated UI in the AI Sidebar (ADR-0027)

The sidebar's assistant can answer with charts, maps, tables, stats, buttons and cards for a purpose
(entity, link, product, event, quote, pros/cons, timeline; `genui/cards.js`). It writes
[OpenUI Lang](https://github.com/thesysdev/openui) in an ```` ```openui-lang ```` fence inside its
Markdown answer; `<nomad-genui>` (`app/fg/shell-window/genui/`) draws it, with our own SVG charts
and a Leaflet map on OpenStreetMap tiles. The component library and the prompt section are
`app/lib/genui/library.mjs` (`genuiPrompt()`, added on a turn with `genUi: true`, which only
`ai-shell.ts` sets). The shell window parses against `app/lib/genui/schema.json`: after changing the
library, run `node scripts/gen-genui-schema.mjs` (`tests/unit/genui.test.js` fails until you do).
Keep it to components that load nothing by themselves (no Image), draw model text only as text,
and run actions (`@ToAssistant`, `@OpenUrl`) only on a click.

### The AI and the user's Notes and Reader (ADR-0019)

A personal turn also gets capabilities for Notes (`listNotes`, `readNote`, `writeNote`), Highlights
(`highlightText`, below) and Reader (`listReaderPosts`, `readReaderPost`, `followFeed`, `unfollowFeed`,
`markPostsRead`). Their entries are
in `CAPABILITIES` with `gates: { personal: true }`; the pure logic is `app/bg/ai/vault-tools.mjs`
(`VAULT_TOOL_PERMS` maps each to its permission); the I/O is `app/bg/web-apis/bg/ai-vault.ts`. Each asks
one of four permissions, `notesRead`, `notesWrite`, `readerRead`, `readerWrite` (`app/lib/permissions.ts`,
`promptTrusted`, so a `nomad://` page asks too), once per turn. A phone turn sends its Reader `space`
on the Bridge, and the phone's prompt text is `VAULT_PROMPTS` in `mobile/app/index.tsx`. A new
capability of this kind needs all of these, plus a line in `PERSONAL_PROMPT`.
Names are managed in My Library → Names and the site-info panel; the URL bar suggests them
(`fg/lib/location.js`). The phone reads and writes the same records through its backend (`names` in
`RPC_APPS`, `mobile/backend/lib/vault-apps.mjs`; UI hook `mobile/lib/useNames.ts`) and resolves a name only in
`navigate` (`mobile/app/index.tsx`), like `loadURL` on desktop (ADR-0018 amendment). The AI also names a site the user visits a third time
(`app/bg/hyper/auto-names.js`, rules in `shared/names.mjs`: `siteOf`, `nameAnchors`, `autoNameError`).
The name must be spelled from the site's host (or a drive's title), it runs on this Device's runtime
only (`completeText` in `ai.ts`), and the `ai_auto_names` setting (the AI page, `nomad://ai/setup`) turns it off.
Such a record has `auto: true` until the user keeps or edits it (ADR-0018 amendment).

### Highlights (ADR-0020)

Right-click selected text on an http(s) or hyper:// page: Copy Link to Highlight, Highlight, or
Highlight and Add Note. A Highlight is a Vault record (`/.vault/highlights/<page>/<id>.json`, rules in
`shared/highlights.mjs`) that names its text with a text directive (`#:~:text=`), made and found with
`text-fragments-polyfill`. `app/bg/ui/highlights.js` stores them, builds the menu items, and opens a
Note in a new tab; `app/fg/webview-preload/highlights.js` draws them with the CSS Custom Highlight
API plus a note button in a closed shadow root. bg reads the selection by calling
`window.__nomadHighlights` in the preload's isolated world (Electron's world 999); keep anything that
reveals Highlights or Notes out of the page's main world.

The AI makes them too: `highlightText({ text, note? })` finds text the AI quoted (`findQuote` in the
preload, candidates from `quoteFragments`) and saves it like the menu items do (`highlightForAi`). It
asks `notesWrite`, and only after `assertCanHighlight` passes. It needs the page's renderer
(`gates: { personal, renderer }`), so the phone's AI panel doesn't get it. View > Hide Highlights
(`window-menu.js`) sets the global `highlights_hidden` setting; while it is on, `nomad-highlights:list`
gives every page an empty list. A Note is an ordinary Note; `?write` on
`nomad://notes/<id>` puts the cursor at its end.

### Mods (ADR-0023)

A Mod is the user's own change to a site, like Arc's: a name, an on/off switch, preset styles
(dark, sepia, …), CSS selectors to hide, custom CSS and custom JavaScript. Records are Vault
records (`/.vault/mods/<id>.json`, rules and presets in `shared/mods.mjs`), kept in memory by
`app/bg/ui/mods.js`. A Mod for `example.com` covers every host under it, on http(s) and
hyper://, never nomad:// or `hyper://private/`. `app/fg/webview-preload/mods.js` applies them:
a **synchronous** `nomad-mods:page` IPC as the page starts (styles before first paint), CSS via
`webFrame.insertCSS` swapped in place on `nomad-mods:changed`, scripts once per load in the main
world, and a reload when a script that ran is turned off or edited. Keep the data in the preload's
isolated world; the page must not be able to read it. The element picker (pick elements to hide) runs in
the preload too, started through `window.__nomadMods` in world 999. The tab UI is the Mods item
in the location bar's site menu (`fg/shell-menus/site.js`, pane state `mods`; the arrow turns blue
while a Mod is on), which swaps in the `mods` shell menu (`shellMenus.switchMenu`);
editing is My Library → Mods (`nomad.vault.listMods`/`saveMod`/`deleteMod`). The AI gets
`listMods`, `saveMod`, `deleteMod` as personal capabilities (so the sidebar, the phone and
the loopback MCP all have them), behind the `modsRead` / `modsWrite` permissions.

### The AI Sidebar uses the page (ADR-0028)

The sidebar's AI can click, type and scroll on the page in the user's tab: `snapshotPage`,
`clickElement`, `typeText`, `pressKey`, `selectOption`, `scrollPage`, and `clickAt` for vision models.
They are `CAPABILITIES` with `gates: { personal, tab, renderer }`, so the phone, a page's own chat and
the loopback MCP's other programs never get them. The rules (blocked password/payment/file fields,
clicks that need a confirm, the 30-day site grant, keys) are `app/bg/ai/page-control.mjs`; one session a
turn (`createSession` in `app/bg/ui/page-control.js`, made in `runChat`) pins the tab and sends real
input with `sendInputEvent`/`insertText`. `app/fg/webview-preload/page-control.js` lists controls by
ref and draws the cursor, border and Stop bar in a closed shadow root, in the top layer (a
manual popover, raised again when the page opens a modal or popover) so nothing on the page covers it, through
`window.__nomadPageControl` in world 999. The grant is the `aiPageControl` permission, stored in
sitedata as the time it ends; `aiPageAction` is the per-click confirm, whose prompt can allow similar
clicks (`similarKey`) for the rest of the sidebar chat (`chatId` from the sidebar); `aiPagePlan` approves a
plan of clicks from `planPageActions` at once (`planBudget`). The model-facing text is
`PAGE_CONTROL_PROMPT` and the `## Page control` guide in `api-reference.mjs`.

### Open tabs on other Devices (ADR-0024)

Each Device writes the tabs it has open, grouped by Space (Root Drive key), to its own Vault record
`/.vault/tabs/<deviceKey>.json` (rules in `shared/open-tabs.mjs`). Other Devices only read them: no
Device ever opens or closes tabs on another. Desktop publishes from `app/bg/ui/open-tabs.js` (5 s
after `custom-pages-updated`, only on a change, only once another Device joined) and lists them in
nomad://history → Tabs From Other Devices (`nomad.vault.listDeviceTabs`). The phone publishes from
`mobile/app/index.tsx` over `RPC_APPS` `tabs` and lists them under the tab grid. `sync_open_tabs`
(Settings → Devices) and the phone's Settings switch turn it off per Device and delete the record.

### Pinned pages (ADR-0032)

A Space's pinned pages are `/nomad/pins.json` in its Root Drive (its Space Library when shared), the
file the phone's home shortcuts and the new tab page already use. Desktop draws them as icon tiles at
the top of the sidebar (`fg/shell-window/sidebar.js`; closed pins also show in the top bar,
`tabs.js`). `app/bg/ui/space-pins.js` keeps them per Space and watches the drive; a pinned tab is
bound to its pin by `pinUrl`, and `reconcileSpacePins` in `bg/ui/tabs/manager.js` unpins, binds and
adopts tabs when the pins change. Rules: `shared/pins.mjs` (tests `tests/unit/pins.test.js`). Pin
through `togglePinned` / `spacePins`, never by setting `tab.isPinned` alone, or the pin won't sync.

### Updating a computer from the phone (ADR-0031)

The phone can ask one of the user's computers to install the newest release and restart. The phone
writes `/.vault/update-requests/<deviceKey>.json`; the computer (`app/bg/remote-update.js`) takes it
once, downloads with `browser.downloadUpdateNow`, writes its progress to
`/.vault/update-status/<deviceKey>.json`, and restarts with `installUpdateAndRestart` (session restore
reopens the tabs). Rules are `shared/device-updates.mjs` (tests `tests/unit/device-updates.test.js`):
only a request from another Device the Vault lists, less than an hour old. The `remote_update_enabled`
setting (Settings → Auto Updater) turns it off. Phone UI: `DesktopUpdateBanner` after the phone
updates, Devices, and Settings → Your computers (`mobile/lib/deviceUpdates.ts`, `RPC_APPS` `updates`).

### Shared Spaces (ADR-0029)

A Space (not Personal) can be shared with other people as **Can view** or **Can edit**. Its library
(Drive Registry, bookmarks, Reader feeds, Space-only Notes and Names) moves into a **Space Library**,
its own Autobase; the Vault's space record gains `library`, `role`, `memberId`. Rules and paths are
`shared/space-library.mjs`; desktop I/O is `app/bg/hyper/space-library.js` (share, invites over the
shared `BlindPairing` instance, members, Space Writer grants, the `nomad/space-control` channel for a
viewer's ask); the phone's is `mobile/backend/lib/space-library.mjs` (open, join, attach). Code that
reads a Space's records must go through `spaceLibrary.records(space, kind)` (desktop) or
`placeOf(base, space, kind)` (phone `vault-apps.mjs`), and the Drive Registry through
`_registryDrive(space)` in `bg/filesystem/index.js`, never straight to the Vault or Root Drive, or a
shared Space reads stale data. UI: My Library → Sharing (`library/js/views/sharing.js`), **Ask to
edit** in site-info, **Join a shared space** in the phone's Space switcher.

### AI Jobs and phone notifications (ADR-0030)

A Job is a saved prompt the user's AI runs by itself, by hand or on a schedule; a run can notify
the phone. Jobs, runs and the phone's "run now" requests are Vault records (`/.vault/jobs/`,
`/.vault/job-runs/<jobId>/`, `/.vault/job-requests/`; rules, schedules and notification logic in
`shared/jobs.mjs`, tests `tests/unit/jobs.test.js`). `app/bg/ai/jobs.js` keeps them in memory, runs
the Jobs whose `device` is this one when due (and once on wake), and saves each run; `main.js`
injects the turn (`runJobTurn` in `ai.ts`). A run is the `job` stage: personal, no tab, reads
(`JOB_CAPS` in `search-execute.mjs`) plus only the writes the Job was given, no permission prompts
(`jobPermitFor`), this Device's runtime only. A Job's `writes` (`shared/jobs.mjs` `normalizeWrites`:
drives, each live or staged in its Draft; Notes; Reader) are chosen when it is made: in My Library,
or by the AI's `saveJob`, which asks the user with the `jobWrites` permission for each grant it adds.
A run records what it changed (`changes`). The AI gets `listJobs`/`saveJob`/`runJob`/`deleteJob` (`jobsRead`/`jobsWrite`) and, inside a
Job, `notify`. Desktop UI is My Library → Jobs (`nomad.vault.listJobs`/…/`watchJobs`). The phone lists
them (`mobile/components/Jobs.tsx`, `RPC_APPS` `jobs`) and posts local notifications with
`expo-notifications` for new runs (`mobile/lib/useJobNotifications.ts`); there is no push server.
A Job can come from a drive (`source`): `job.md` is its prompt and `job.js` an `execute`-format module
run first (`runJobTurn`/`runJobModule` in `ai.ts`, files read by `bg/web-apis/bg/job-source.ts`). The
user's own drives are live; anyone else's is copied into the record, and a newer version waits for the
user in My Library (`checkJobSource`). The AI must not be able to take it for them.

### The AI page, chats and memory (ADR-0032)

`nomad://ai` (`app/userland/ai/`, in the browser menu) is the AI's own page: `/chats`, `/memory`,
`/skills`, `/setup` (the old Settings → AI; Settings' AI item and `?view=ai` now open it), and a link to My
Library → Jobs. Chats are the sidebar's sessions in `hyper://private/.ai-chat/` (`app/bg/ai/chat-store.js`;
search helpers in `chat-search.mjs`); a user's name for a chat lives in `/.ai-chat/names.json` because
the sidebar rewrites `title` on every save. The page uses the internal `nomad.aiChats`
(`bg/web-apis/bg/ai-chats.ts`): list/search, load, rename, remove, and open in the window's sidebar
(`openAiSidebarChat` in `tabs/manager.js` → the shell's `ai-open-chat` event → `ai-sidebar.js`
`openChat`). Memories are Vault records `/.vault/ai-memory/<id>.json` (rules in `shared/ai-memory.mjs`,
cache in `app/bg/ai/memory.js`, page API `nomad.vault.listMemories`/`saveMemory`/`deleteMemory`/
`clearMemories`). Every personal turn gets `memoryPrompt()` in its system prompt; the model changes
them with the `remember`/`forget` capabilities (`gates: { personal, memory }`, not in `JOB_CAPS`),
behind the `memoryWrite` permission. The `ai_memory` setting turns it all off. A page's
`nomad.ai.chat()` never sees memories.

Skills (ADR-0034) live on `nomad://ai/skills`: instructions the user writes for kinds of tasks, Vault
records `/.vault/ai-skills/<id>.json` (rules and the SKILL.md format in `shared/ai-skills.mjs`, tests
`tests/unit/ai-skills.test.js`, cache in `app/bg/ai/skills.js`, page API `nomad.vault.listSkills`/
`saveSkill`/`deleteSkill`/`parseSkillMd`/`exportSkill`). A personal turn that offers tools lists each
enabled skill by name and description (`skillsPrompt()`); the model reads one through `search`'s
`skill` domain (`skill:<name>`), which `buildCatalog` fills only on a personal turn. The AI has no
capability that changes a skill; only the AI page does.

### Secrets (ADR-0033)

API keys and tokens the user's AI and Jobs use by name, without seeing them. They live on this
computer only, encrypted with `safeStorage` (`app/bg/ai/secret-store.js`, `<userData>/ai-secrets.json`),
never in the Vault, a drive or a Space. Rules are `app/bg/ai/secrets.mjs` (tests
`tests/unit/secrets.test.js`). The model calls `httpRequest` with `secrets: ['NAME']`, and
`app/bg/ai/http-request.mjs` adds each value where the user set it (a header, the query, a body field,
or the whole URL), only for the secret's hosts. It never connects to loopback, and reaches private
addresses only with a secret for that host. `executeTool` in `ai.ts` redacts every known value from
every tool result (`[secret NAME]`). The sidebar and phone ask `aiSecretUse:<NAME>` once per turn. A
Job uses only the secrets ticked for it on the secret (the local `jobs` list, not the Job record).
`stageRules().secrets` keeps them from page turns and the loopback MCP's other programs. UI is My
Library → Secrets over the internal `nomad.secrets` API (writes only from `nomad://library`). Never
add an API that returns a value.

## Look and feel: every UI supports dark mode and matches the rest

Every new or changed screen must work in light **and** dark, and look like its neighbours.
- **Desktop `nomad://` apps:** import `nomad://app-stdlib/css/common.css` (and `fontawesome.css`), and
  color only with its tokens (`--bg-color--*`, `--text-color--*`, `--border-color--*`). Put
  app-specific colors in `--<app>-*` variables on `body`, and override them under
  `@media (prefers-color-scheme: dark)`. Copy the shell from `nomad://search` / `nomad://reader` /
  `nomad://notes`: the 50px header with the brand favicon, My Library's sidebar, bordered result
  lists, the `.notice` empty state, and `.btn` / `.btn.primary` / `.icon-btn`. No hard-coded
  light-only hex colors.
- **Mobile:** colors come only from `useTheme()` (`mobile/lib/theme.ts`, whose dark grays are
  desktop's). Build screens from the shared parts instead of hand-drawing them: `ScreenHeader` (the
  56dp top bar with a back arrow), `ListSection`/`ListRow`/`SwitchRow` (`List.tsx`: `t.surface` cards
  with hairline borders, ripple rows of at least 48dp), `Tabs`, `ActionSheet` for menus and
  long-press actions, and `Icon`/`IconButton` (Font Awesome 5, desktop's icon set). Never use a text
  glyph (☰ ✕ ⌂) as an icon. `Library.tsx` is the worked example.
- Check both schemes before calling UI work done.

## Drive templates live in `nomad.dev`

The "Create Drive From This Template" starter drives (forum, blog, microblog, …) live in the sibling
**`nomad.dev`** repo (`static/templates/` + `src/content/docs/docs/templates/`), not here. See `nomad.dev/CLAUDE.md`
for how a template is structured and how to add one.

## Mobile: back goes where you came from

The phone's navigation is a stack (`mobile/lib/navStack.ts`, tests in `tests/unit/mobile-nav-stack.test.js`).
- Full-screen pages (My Library, Settings, Logs, Devices, …) are entries in `screens` in
  `mobile/app/index.tsx`. Open one with `openScreen` (it goes on top of what is open, so don't
  close the screen you open it from) and close it with `closeScreenNamed`. A new screen needs a
  `Screen` name and a Modal whose `onRequestClose` closes it.
- A tab's history holds every page, including links followed inside a WebView (`pageLoaded`), so
  back from a typed address lands on the page you left. A page opened from a screen carries
  `returnTo`, so back from it opens that screen again.
- Inside a screen, back steps back through its own trail first: folders in FileExplorer, linked
  notes in Notes.

## Mobile: links and popups stay in Nomad

A web tab never hands a web page to another browser.
- **New windows:** `mobile/patches/react-native-webview+13.16.0.patch` (applied by `patch-package` on
  `npm install` in `mobile/`) adds `RNCWebViewHooks`, which `mobile/modules/nomad-webview-windows`
  answers. A window a script opens (a sign-in popup) is a real WebView shown over the tab
  (`PopupWindow.kt`), so `window.opener`, `postMessage` and `popup.closed` work and the result gets
  back to the page. A tap on a `target="_blank"` link opens a new tab (`onOpenTab`). Upgrading
  react-native-webview means regenerating the patch (`npx patch-package react-native-webview`).
- **Links:** the web tab's `onShouldStartLoadWithRequest` routes every link through `routeLink`
  (`mobile/lib/webLinks.ts`, tests `tests/unit/mobile-web-links.test.js`): `feed:` links and RSS/Atom
  downloads go to Reader's subscribe prompt (`onFeed`), an `intent://` link to a web page loads in the
  tab, and only mail, phone and app links go out (`openExternal`, browsable activities only).
- **Google sign-in:** web tabs and popups send `browserUserAgent()`, the WebView's user agent without
  `; wv` and `Version/4.0`, and no `X-Requested-With` header; Google refuses sign-in otherwise.

## Mobile: safe areas on Android

The mobile app (Expo 55) is **edge-to-edge** on Android: it draws behind the status bar and the
navigation bar. A `transparent` `Modal` gets **no** inset, so a panel pinned to the bottom of one
lands under the back/home buttons.
- For a bottom sheet, use `mobile/components/BottomSheet.tsx`. It owns the Modal, the backdrop,
  close-on-tap-outside, and the bottom inset. Don't hand-build `<Modal transparent>` + a
  `justifyContent: 'flex-end'` backdrop.
- The keyboard: a Modal is its own Android window, so React Native's `Keyboard` events never fire
  for an input inside one, and edge-to-edge means it isn't resized either. `BottomSheet` keeps the
  sheet above the keyboard with `components/KeyboardInset.tsx`, which reads the keyboard inset of
  its own window (`modules/nomad-keyboard-inset`). Use it for any other Modal with an input low on
  the screen; `Keyboard` listeners only work outside a Modal (`AiPanel`).
- Anything else pinned to an edge outside a `SafeAreaView` (an overlay like `AiPanel`, a centered
  dialog that can grow tall) must apply `useSafeAreaInsets()` itself.
- A full-screen `Modal` is safe when its content sits in a `SafeAreaView` with the right `edges`
  (see `Library`, `FileExplorer`).
