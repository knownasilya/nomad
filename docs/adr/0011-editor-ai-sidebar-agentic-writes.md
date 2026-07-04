# Editor AI Sidebar edits the drive via a server-side agent, not the Monaco buffer

The editor (`nomad://editor`) gains a collapsible **AI Sidebar** that runs an agentic
`nomad.ai.chat()` loop over the Drive currently open in the editor. Rather than having the model
propose text that the editor applies to the Monaco buffer (client-side, single-file), the agent
reads/lists/**writes** files directly across the Drive through the built-in server-side tool loop.
Because `nomad.ai.chat` resolved its Drive from the sender's URL — which for the editor is
`nomad://editor`, not the edited Drive — the API is extended to take an explicit target:
`chat(messages, { driveUrl })`. The tools and AI Config resolution (`index.json.ai` + `/ai/system.md`
→ Space default → global `ai_default_model`) key off that `driveUrl`.

## Considered Options

- **Client-side, buffer-applied (rejected).** Use `nomad.ai.chat` for text only; inject the open
  file's content into the prompt and write the model's response into the Monaco buffer, reusing the
  editor's undo/unsaved/Save/read-only machinery with zero backend changes. Rejected because we wanted
  full **multi-file** editing, which fights Monaco's single-visible-buffer model.
- **Server-side tool loop (chosen).** The agent writes directly to the Drive across many files. Buys
  multi-file edits and reuses the existing `readDriveFile`/`listDriveFiles`/`writeDriveFile` tools.

## Consequences

- **No permission prompts.** `nomad://` is a trusted interface, so `writeDriveFile`'s `modifyDrive:`
  permission auto-allows from the editor. Consent is instead provided by: a **save-clean gate** (the
  open buffer must have no unsaved changes before a prompt runs), a visible per-turn changed-files
  list, and per-turn undo.
- **Per-turn Checkpoint undo (new plumbing).** Since writes bypass Monaco, Monaco's undo can't cover
  them. Each assistant turn is one revertible **Checkpoint**. The only place that still knows a file's
  pre-write content is `writeDriveFile` right before it overwrites, so it captures
  `{ path, priorContent | null }` and surfaces it to the editor via a **new tool event on the chat
  stream**. Reverting a Checkpoint rewrites prior content and deletes files the turn created.
- **Editor reconciles after writes.** After each write the editor reloads affected files; the open
  file's Monaco model is refreshed to the new Drive content and its saved-version baseline reset.
- **Read-only Drives.** The sidebar opens as Q&A-only; the editor withholds the `writeDriveFile` tool
  so the model won't attempt edits it cannot make.
- **Keep the three AI surfaces in sync** (per CLAUDE.md): the new `driveUrl` option and tool-event
  stream touch `bg/ai.ts`, `fg/ai.ts`, and the external `ai` manifest.

## Shared component; explorer bundled onto modern lit

The same AI Sidebar ships in **both** the editor and the explorer, so the Lit component lives in
`app/userland/app-stdlib/js/com/ai-sidebar.js` and both apps import it. The host contract is three
methods — `prepareForAgentRun()` (gate on unsaved state), `onAgentWroteFile(path)` (reload after a
write), `closeAiSidebar()` — which the editor and explorer implement differently (the explorer has no
unsaved buffer, so its gate is a no-op and its reload is `load()`).

To make that reuse possible the **explorer was migrated off its vendored `lit-element` (2.x) onto the
`lit` package and added to the browserify build** (`scripts/build.js`; `index.html` now loads
`main.build.js`). All 39 explorer source files had their `../vendor/lit-element/...` specifiers
rewritten to `lit` / `lit/directives/*`; the vendored copy is now dead. Considered alternatives:
duplicating the ~600-line component against the old vendored lit (smallest blast radius, ongoing
divergence), or vendoring the latest lit ESM without a bundler (keeps raw-module loading but leaves
the explorer on a different toolchain than every other bundled userland app). We chose the migration
so there is one component and one build path across editor/explorer/settings/site-info.
