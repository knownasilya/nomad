---
name: run-nomad
description: Build, run, and drive the Nomad desktop app (Electron). Use when asked to start or launch Nomad, take a screenshot of a nomad:// page (Reader, Notes, Search, Settings, Library) or of the browser chrome (Tab Sidebar, navbar), check light and dark mode, click through a page, or call nomad.* APIs in the running app.
---

Nomad is an Electron browser. An agent drives it with `.claude/skills/run-nomad/driver.mjs`: it
launches an **isolated** Nomad (its own scratch profile, never the user's) and reads one command per
line on stdin, sent over the Chrome DevTools Protocol to the first tab or to the browser chrome. All
paths are relative to the repo root. Verified on macOS (the developer's machine), with a real display.

## Prerequisites

Root dependencies installed (`npm install` at the repo root; its postinstall also installs `app/`).
This was already done in the session that wrote this skill, so the install itself wasn't re-run.

## Build

The driver runs `app/` as built, so build after changing it:

```bash
npm run build
```

After changing the Notes editor (`app/userland/notes/js/editor/`) or `shared/vault-apps.mjs`, also
regenerate the phone's editor page (it's committed):

```bash
npm run build:note-editor
```

## Run (agent path)

Pipe commands in. Nomad starts, runs them in order, and quits at the end of input:

```bash
node .claude/skills/run-nomad/driver.mjs <<'EOF'
launch
go nomad://notes/
eval nomad.vault.saveNote({ body: '# Seed order\n- kale' }).then(() => nomad.vault.saveNote({ body: '# Garden plan\n- [ ] Order from [[Seed order]]' })).then((n) => { location.href = 'nomad://notes/' + n.id; return n.id; })
wait 2500
text .cm-content
click .cm-note-link | Seed order
wait 1500
text .backlinks
ss notes
EOF
```

Each command echoes as `> cmd`, then its result. Screenshots, the scratch profile, and Nomad's log go
to `$TMPDIR/nomad-run/` (set `NOMAD_RUN_DIR` to change it; `NOMAD_RUN_PORT` changes the DevTools
port from 9333). Open the PNG and look at it.

| command | what it does |
|---|---|
| `launch` / `launch keep` | start Nomad on a fresh scratch profile (`keep` reuses the last one), get past first-run setup, attach to the first tab |
| `go <url>` | navigate the current page and wait 2.5 s |
| `ss [name]` | screenshot the current page → `$TMPDIR/nomad-run/shots/<name>.png` |
| `dark` / `light` | emulate `prefers-color-scheme` for the current page |
| `focus` | emulate focus (a driven window never has OS focus; see Gotchas) |
| `size <w> <h> [mobile]` | set the page's viewport; `mobile` also sets 2x and mobile mode |
| `eval <js>` | run JS in the page, await it, print the result as JSON (`window.nomad` is there on nomad:// pages) |
| `text [selector]` | text of the page or an element, including Lit shadow roots |
| `click <selector> [\| text]` | mousedown + mouseup + click on the first match (or the one with exactly that text) |
| `mouse <x> <y>` | a real left click at page coordinates, for UI that reads where you clicked (CodeMirror cursor placement); get coordinates with `eval` and `getBoundingClientRect()` |
| `type <text>` / `key <Key>` | type into the focused element / press Enter, Backspace, Tab, Escape, arrows |
| `targets` | list every page (tabs, `nomad://shell-window/`, menus) |
| `attach <url text>` / `attach tab` | drive another page, e.g. `attach shell-window` for the tab strip and Tab Sidebar |
| `html <file>` | show an HTML file, or a generated TS module exporting one, in the page |
| `log [n]` | last n lines of Nomad's log |
| `wait <ms>` · `help` · `quit` | |

### Recipes (each run as shown)

The browser chrome in the Tab Sidebar layout, dark, with enough tabs to scroll:

```bash
node .claude/skills/run-nomad/driver.mjs <<'EOF'
launch
go nomad://settings/
eval nomad.browser.setSetting('tab_layout', 'sidebar').then(() => 'ok')
eval Promise.all(Array.from({ length: 40 }, (_, i) => nomad.browser.openUrl('nomad://notes/?n=' + i, { setActive: false }))).then(() => 'opened')
wait 3000
attach shell-window
size 900 520
dark
ss sidebar-dark
EOF
```

The phone's Notes editor page (`mobile/lib/noteEditorHtml.ts`) at phone size. It talks to React
Native through `window.__noteEditor(msg)` (see `app/userland/notes/js/mobile.js`):

```bash
node .claude/skills/run-nomad/driver.mjs <<'EOF'
launch
html mobile/lib/noteEditorHtml.ts
size 390 760 mobile
eval window.__noteEditor({ type: 'load', theme: { scheme: 'dark', surface: '#2a2a2e', text: '#ededf2', textMuted: '#85858f', accent: '#5b8cff', trustBg: '#232c45', border: '#34343b' }, id: 'a', body: '# Phone note\n- [x] done\n- [ ] [[Other]]', notes: [], readOnly: false, focus: false })
ss phone-editor
EOF
```

Type in the URL bar and read its suggestions. The input lives in the shell window's shadow roots,
the suggestions in their own page (`nomad://location-bar/`), and the input needs `focus` to fire its
focus handler:

```bash
node .claude/skills/run-nomad/driver.mjs <<'EOF'
launch
go nomad://library/names
eval nomad.vault.setName({ name: 'notes', url: 'nomad://notes/', title: 'Notes' }).then((n) => n.name)
attach shell-window
focus
eval (() => { const find = (root, sel) => root.querySelector(sel) || [...root.querySelectorAll('*')].map((n) => n.shadowRoot && find(n.shadowRoot, sel)).find(Boolean); const input = find(document, '.input-container input'); input.focus(); input.value = 'notes'; input.dispatchEvent(new Event('input')); return 'typed'; })()
wait 1500
attach location-bar
text
ss urlbar
EOF
```

Typing in the Notes editor (CodeMirror) needs focus emulated and the view focused first:

```bash
node .claude/skills/run-nomad/driver.mjs <<'EOF'
launch
focus
go nomad://notes/
eval nomad.vault.saveNote({ body: '# Garden plan' }).then(() => nomad.vault.saveNote({ body: '# Seed order' })).then((n) => { location.href = 'nomad://notes/' + n.id; return n.id; })
wait 2500
eval (() => { const v = document.querySelector('.cm-content').cmView.view; v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }); return 'cursor at end'; })()
key Enter
type See [[
wait 600
text .cm-tooltip-autocomplete
ss notes-picker
EOF
```

Two isolated Nomads at once (a second device): give each its own `NOMAD_RUN_DIR` and
`NOMAD_RUN_PORT`. Here B runs in the background while A runs in the foreground:

```bash
(NOMAD_RUN_DIR="$TMPDIR/nomad-run-b" NOMAD_RUN_PORT=9340 node .claude/skills/run-nomad/driver.mjs > "$TMPDIR/driver-b.out" 2>&1 <<'EOF'
launch
go nomad://notes/
eval nomad.vault.saveNote({ body: '# From B' }).then((n) => n.body)
wait 4000
EOF
) & node .claude/skills/run-nomad/driver.mjs <<'EOF'
launch
go nomad://notes/
eval nomad.vault.saveNote({ body: '# From A' }).then((n) => n.body)
eval nomad.vault.listNotes().then((r) => r.notes.map((n) => n.body))
EOF
wait; cat "$TMPDIR/driver-b.out"
```

## Direct invocation

Most logic that both apps share (`shared/*.mjs`) and the Vault records are covered by vitest,
without the app:

```bash
npm test
node_modules/.bin/vitest run tests/unit/vault-apps.test.js
```

`npm run typecheck` reports 17 errors on a clean tree (October 2026); compare the count, not zero.

## Run (human path)

`npm start` builds and opens Nomad on the user's real profile (`~/Library/Application Support/Nomad`).
The driver never uses it. If the user already has Nomad open, a second `npm start` exits at once (the
single-instance lock).

## Gotchas

- **VS Code's terminal sets `ELECTRON_RUN_AS_NODE=1`.** Electron then starts as plain Node and rejects
  Chromium flags (`bad option: --remote-debugging-port`). The driver drops it from Nomad's environment.
- **Playwright's `_electron.launch()` hangs** with this Electron (it never attaches). Hence the
  DevTools-protocol driver: `--remote-debugging-port` plus a WebSocket per page.
- **A fresh profile opens `nomad://setup` and blocks startup** until setup is done. The driver
  completes it the way the page does (`nomad.browser.updateSetupState`). The splash `nomad://init` is
  a page too; don't mistake it for a tab.
- **The profile is isolated by `NOMAD_USER_DATA_PATH`**, which also gives the run its own
  single-instance lock, so it runs beside the user's Nomad. `NOMAD_MCP=0` keeps it off the MCP port.
  Nothing it does reaches the user's Vault or phone.
- **A driven window never has OS focus.** `document.hasFocus()` is false, so focus-dependent UI acts as
  if blurred: the Notes editor shows everything formatted and hides Markdown marks. Use `focus`.
- **Settings, Library and the shell chrome are Lit components.** `document.body.innerText` misses
  shadow roots; `text` walks them.
- **`nomad.fs.createDrive()` opens a "create drive" dialog** in a driven window and fails
  (`getOwnerBrowserWindow` of null). Pass `{ prompt: false }`.
- **The tab strip and Tab Sidebar live in `nomad://shell-window/`**, not in a tab. Screenshots of it
  show the tab area blank (tab contents are separate views). `size` shrinks it so lists overflow.
- **`go` navigates through DevTools, not the way a user does.** It skips the tab's own navigation
  hooks (`Pane.loadURL`), so `go hyper://<name>/` hangs on a DNS lookup instead of following the
  user's name. Test user navigation through the URL bar recipe, or `nomad.browser.openUrl`.
- **My Library paints late on a fresh profile.** A screenshot one second after `go nomad://library/…`
  can come out blank; `wait 2500` first.
- **Two Nomads on one Mac pair, but don't fully sync.** In October 2026, one could join the other's
  Vault (`nomad.vault.createInvite` / `submitInvite` / `approveDevice`), yet Vault writes from the
  device that joined never reached the other one, on the old join path too. Don't use this setup to
  judge sync.

## Troubleshooting

- **`Nomad exited during launch`** → `log 40` shows why. A missing `app/*.build.js` means
  `npm run build` wasn't run.
- **`no tab after 90s`** → `targets`. If only `nomad://setup` is listed, setup didn't finish; rerun.
- **A page is blank, `text` is empty** → check `eval` output for a script error. A userland bundle
  that declares a global name like `top` must load as `<script type="module">` (nomad://notes does).
- **`click` says `NOT FOUND`** → the element is rendered later or lives in a shadow root; `wait`, or
  `eval` into `shadowRoot` yourself.
