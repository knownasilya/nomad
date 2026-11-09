# Assets: a place for a Space's files

**Status: Accepted.** 2026-11-07. Supersedes the album part of ADR-0043.

The family album (ADR-0043) kept a shared Space's photos. People want more than photos in that one
place: the school's PDF form, a voice memo, a video of the recital, a CSV of the budget, a packing
list the AI wrote. And a Space that isn't shared wants the same place for the user's own files.

## Decision

1. **Every Space has Assets.** A shared Space's live in its Space Library under `/assets/`, as the
   album did: a record `/assets/items/<id>.json` (`nomad/asset`: name, type, kind, size, who added
   it, when it was taken or added, caption) and two files, `/assets/files/<id>` (the file as it is)
   and `/assets/thumbs/<id>.jpg` (a picture's or a video's thumbnail, when there is one). Files are
   blobs in the adder's own blob core (fs-core, `FS_FORMAT_VERSION 1`, no change). Any other Space's
   Assets are the user's own, in the Vault under that Space's prefix (`vaultRoot(space)`,
   `/.vault/space-lib/<space>/assets/`), so they sync between the user's Devices and nobody else.
   When the Space is shared, `space-library.js` `share()` copies them into the Space Library with
   the rest of its library (`autobases.copyFiles`) and removes them from the Vault. Rules and paths
   are `shared/assets.mjs` (tests `tests/unit/assets.test.js`).

2. **Any file, up to 25 MB** (500 MB since the amendment below). Its type comes from what it came with, or from its extension
   (`mimeOf`), and its **kind** (`kindOf`: image, video, audio, pdf, markdown, code, data, text,
   document, archive, other) picks the icon, the filter and the preview. A camera or gallery photo
   is scaled to 2560 px and a 480 px thumbnail, as before; any other file is kept as it is. A file
   is never cut: one that is too big is refused.

3. **Previews.** Desktop's `nomad://assets` (`app/userland/assets/`) shows pictures, plays video and
   audio, draws PDFs with pdf.js (bundled by `scripts/build.js`; tabs have no PDF plugin), renders
   Markdown (markdown-it, no HTML), shows CSV as a table, JSON pretty-printed, and code and text
   with line numbers; anything else gets a card with Download. The phone
   (`mobile/components/Assets.tsx`) shows pictures, plays video and audio, renders Markdown and
   text, and opens anything else in another app (`expo-sharing`, from a file in the app's own
   cache). Both list by month with a search (every word, any order, ignoring case and accents) and
   filters (Photos & videos, Documents, Audio, Other).

4. **The album's photos are Assets.** A Device that can write the Space Library moves them the
   first time it lists them: the same blobs at the new paths, a `nomad/asset` record (`legacyMove`),
   then the old paths go. Until then (a viewer's Device) they are read where they are
   (`fromPhoto`, `legacyPaths`). Their ids keep their `p` prefix; new ones start with `a`.
   `nomad://photos` is gone; Assets is `nomad://assets`.

5. **The AI can put things there.** The user's own AI (a personal turn: the sidebar, the phone's AI
   panel, the loopback MCP) has `saveAsset`: `text` it wrote, `base64` bytes its code made, or a
   `url` (http(s), checked by the egress guard and fetched with the loopback/private guard; or a
   hyper:// file) to keep. It asks `assetsWrite` once a turn; the prompt says when the Space is
   shared, since everyone in it will see the file. The record says `source: 'ai'` and the page it
   came from, and the grid marks it. Pure parts are `app/bg/ai/save-asset.mjs`; the write is
   `assets.ts` `saveForAi`, which makes a thumbnail for a PNG or JPEG. The answer links
   `nomad://assets/?id=<id>` (`shared/item-links.mjs` `assetLink`).

6. **Who may remove one** is as before in a shared Space: the person who added it, or the owner.
   In a Space that isn't shared, the user may remove any.

## Consequences

- The phone's screens can't import `shared/`, so `mobile/lib/assetRules.ts` copies the rules they
  need; `tests/unit/assets.test.js` runs the same cases on both.
- No page API reads Assets, and the AI only adds: it can't list, read or remove them yet. A Job
  doesn't get `saveAsset`.
- Text previews show the first 512 KB.
- Office documents and archives have no preview beyond their card.

## Amendment — big files, movies, PDFs and books (2026-11-09)

People keep whole movies there, and e-books.

1. **Up to 500 MB a file** (`MAX_BYTES`). The AI's `saveAsset` stays at 100 MB (`MAX_AI_BYTES`):
   it carries the bytes in memory.
2. **Files move in pieces.** A file never crosses IPC or the phone's RPC whole. Desktop's page reads
   with `nomad.vault.assetChunk` (4 MB, `CHUNK_BYTES`) and adds with `beginAssetUpload`,
   `assetUploadChunk` and `finishAssetUpload`: bg stages the pieces in a temp file and streams it into
   the adder's blob core with fs-core's `putBlobFrom`, which writes the same full 64 KB blocks
   `putBlob` does (no wire-format change; `FS_FORMAT_VERSION` stays 1). `assetData` keeps answering
   for thumbnails and files up to 32 MB. The phone's backend reads and writes files by path in the
   app's own document and cache folders (`assets/readTo`, `add` with `path`), streaming each piece,
   and refuses a path outside them.
3. **Movies, PDFs and books open on the phone too.** Video and audio play from the file in the
   cache. A PDF or an EPUB/MOBI opens in one WebView page, `mobile/lib/docViewerHtml.ts`
   (pdf.js and the reader, bundled by `scripts/build-doc-viewer.mjs`), with a strict CSP and no
   network.
4. **Books are their own kind** (`book`: epub, mobi, prc, azw, azw3), under Documents. One reader
   (`app/userland/assets/js/book/`) serves desktop and the phone: it reads EPUB (the spine, nav or
   NCX) and MOBI (PalmDOC and HUFF/CDIC, with its pictures; KF8 as well as it can) itself, and shows
   one chapter at a time in a frame sandboxed without scripts. Every picture, style and font is a
   blob: URL of the book's own bytes; scripts, frames, forms and anything outside the book are
   removed. It has the contents, text size and the place the reader left off (per book, in that
   browser's storage). A book locked with DRM says so and offers the file instead.
5. **The phone's grid zooms with a pinch**, from a list to one tile across (6, 5, 4, 3, 2, 1
   columns), remembered on the phone; at one across a picture shows from the file, not its
   thumbnail. TalkBack gets the same as Bigger tiles / Smaller tiles actions on each file.

## Amendment: folders, tags, changes to many, and links from Notes (2026-11)

1. **Tags.** An Asset can have `tags`: at most `MAX_TAGS` (20), each lowercased, without a leading
   `#`, at most `MAX_TAG` (40) characters (`cleanTag`, `normalizeTags`). `makeAsset` keeps them on
   every change. A tag is shown as a chip in the grid; picking one shows every file with it in the
   open folder and the folders in it.

2. **Folders.** An Asset can have a `folder`: a path like `Recipes/Desserts` (`cleanFolder`: no
   `.` or `..`, no control characters, at most `MAX_FOLDER_PART` per part and `MAX_FOLDER_DEPTH`
   deep; `''` is the top). A folder exists while a file is in it or while its own record keeps it
   (`<root>folders/<folderKey(path)>.json`, `nomad/asset-folder`, `makeFolder`), so a new, empty
   folder stays. `allFolders` lists both. Renaming or moving a folder rewrites the `folder` of every
   file in it and its folder records (`moveFolderPlan`); removing it removes its files and records
   (`deleteFolderPlan`). In a shared Space, removing a folder that holds a file someone else added
   is refused with nothing removed, as removing that file would be.

3. **Changes to many at once.** Both apps select files (desktop: a tick on a tile, Shift for a run,
   or drag tiles onto a folder; the phone: touch and hold) and then move, tag or remove them. The
   APIs are desktop's internal `nomad.vault.updateAssets({ ids, folder?, addTags?, removeTags? })`,
   `deleteAssets(ids)` (`{ removed, refused }`: files someone else added stay),
   `addAssetFolder`, `moveAssetFolder({ from, to })` and `deleteAssetFolder`, and the phone's
   `assets` actions `updateMany`, `deleteMany`, `addFolder`, `moveFolder` and `deleteFolder`. A
   single file's `update` also takes `name`, `tags` and `folder`.

4. **Links.** `nomad://assets/?folder=<path>` and `?tag=<tag>` open a folder or a tag, beside
   `?id=` (`assetFolderLink`, `assetTagLink`; `parseItemLink` rebuilds them from the cleaned value
   and drops every other query). In a Note, `[[` offers Assets files and folders after the notes,
   and `[[#` offers tags (`app/userland/notes/js/editor/asset-links.js`); picking one writes a
   Markdown link such as `[Recipe.pdf](nomad://assets/?id=…)`. Desktop opens it in nomad://assets;
   the phone opens its Assets screen there. Both apps' **Copy link** gives the same Markdown link.

The AI still only adds Assets; it can't tag, move or remove them.
