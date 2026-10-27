# Names are the user's shortcuts, not addresses

**Status: Accepted.** 2026-10-10.

A user can give a short **Name** ("blog", "notes", "gh") to a Drive, to an app folder inside a
private drive, or to any URL. Typing the name in the URL bar, or opening `hyper://<name>/` in a tab,
goes to what it names, and the AI can look names up and read or write a named Drive. The rules are in
`shared/names.mjs`; desktop keeps them in `app/bg/hyper/names.js`.

## Decision

1. **One set per user, in the Vault** (`/.vault/names/<name>.json`), so every Space and every linked
   Device has the same names. A name is a lowercase DNS label, so `hyper://<name>/` is a valid URL;
   it can't be a Drive key or a reserved word (`private`, `localhost`, `nomad`, `about`, `new`).
   - **No dots.** They are kept for later: DNS names such as `blog.example.com`, or names inside a
     Space. A Device skips a record whose name it can't use, so a later version can allow them
     without breaking older Devices. The UI refuses a typed dot; it doesn't turn it into a hyphen.
   - **Not a number.** `hyper://` is a standard scheme, so Chromium reads a host such as `123`,
     `0777` or `0x1f` as an IPv4 address (`hyper://0.0.0.123/`) before the name is looked up.
2. **`hyper://<name>/` is a navigation shortcut.** A tab that opens it (`Pane.loadURL`, or a link
   followed with `will-navigate`) loads the real address instead, with the rest of the path, query
   and hash appended. Nothing else resolves names: not the hyper:// protocol handler, and not
   `nomad.fs` for pages.
3. **The AI resolves names explicitly.** Its search tool has a `name` domain, and its drive tools
   (`readDriveFile`, `listDriveFiles`, `writeDriveFile`) take an optional `drive`: a name,
   `hyper://<name>/`, or a hyper:// URL. A write asks permission for the Drive it writes.
4. **Only the user's own AI sees names.** That is the AI Sidebar, the phone's AI panel (over the AI
   Bridge, which admits only the user's Devices), and the loopback MCP. A page's `nomad.ai.chat()`
   gets neither the `name` domain nor the `drive` argument, on desktop or on the phone, whatever
   options it passes: it works on its own Drive only. The flag is `personal` (a personal turn),
   set by `ai-shell.ts` and the phone's `AiPanel`, forced off by `ai.ts` `chat()` and the phone's
   WebView handler, and carried on the Bridge request. It also gates Notes and Reader (ADR-0019).
5. **A `hyper://private/…` target follows the current Space**, because `private` resolves when the
   tab loads it. Name the Space's root key instead to pin one Space.

## Why not an alias like `hyper://private/`

- An alias gives one Drive two origins (`hyper://blog/` and `hyper://<key>/`), with separate storage,
  permissions and history. A shortcut lands on the one real origin.
- If the protocol handler resolved names, any page could probe them, for example with
  `<img src="hyper://bank/favicon.ico">`, and learn what the user named. A shortcut resolves only in
  the user's own navigation, so a page that requests `hyper://<name>/` gets "no DNS record".
- For the same reason a page can't ask the AI. Any http(s) or hyper:// page may call
  `nomad.ai.chat()` with no prompt, and it reads the reply. If that turn had the names, the page could
  ask for the list, or for a named Drive's files.

## Consequences

- A link to `hyper://blog/` works only for its author; shared links keep the real key.
- Writes the AI makes to a named Drive get no editor undo Checkpoint; those are for the current Drive.
- A solo Vault brings its names along when it joins another Vault (ADR-0017).
- The phone's URL bar doesn't resolve names yet. Its AI panel uses them, because the Provider runs
  the turn with its own copy of the Vault.

## Amendment: the AI names sites the user visits often (2026-10-27)

When the user comes back to a site a third time (visits in different hours, so a reload or a
click-around counts once), this Device's AI gives it a Name from its title, description and first
heading. The site is an http(s) origin or a hyper:// drive's root (`siteOf` in `shared/names.mjs`);
`nomad://` pages, `hyper://private/`, localhost, intranet hosts and IP addresses are left alone.
`app/bg/hyper/auto-names.js` runs it after each visit is written to history.

- **Spelled from the site's own address.** The name must start with the first letter of an anchor
  word and use the anchors' letters in order (`autoNameError`): the host without `www` and its last
  label for a web site (`gh` or `github` for github.com, `gdocs` for docs.google.com), the title for
  a drive, whose key spells nothing. A page's title and description only steer the choice, so
  `evil.example` can't name itself `gmail`.
- **Never over a name.** A site that already has a name (any name pointing into it) is skipped, and
  an AI name never replaces an existing one.
- **Asked once per site.** The answer is kept in sitedata (`auto_name`), so a name the user removes
  doesn't come back, and a site the AI had nothing for isn't asked again.
- **Marked until the user keeps it.** The record has `auto: true`. My Library → Names and the
  site-info panel show it; Keep, Edit or Rename saves it without the mark.
- **This Device only, and only with a Vault.** It uses the local runtime (`completeText` in `ai.ts`),
  never another Device's AI over the Bridge, and it skips a Device with no Vault rather than make one.
- **Can be turned off.** Settings → AI → "Name sites I visit often" (`ai_auto_names`, on by default,
  per Device).
