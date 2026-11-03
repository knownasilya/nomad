# A Job can open pages and use them

**Status: Accepted.** 2026-11-02.

An AI Job (ADR-0030) could read the web only with `fetchUrl`: no cookies, no scripts, nothing it
could click. Much of what people want a Job for lives behind a sign-in or a button: "check my
bank's page for new statements", "mark today's tasks done and post the note". The sidebar's AI
can already use the page in a tab (ADR-0028), but only with the user watching. A Job runs with
nobody watching, so it can't ask.

## Decision

1. **A Job gets one page of its own.** `openPage({ url })` loads a web page (http, https) or a
   hyper:// drive, never a nomad:// page or `hyper://private/` (`jobPageUrl` in
   `app/bg/ai/open-tab.mjs`), and returns its text. After that the Job has the sidebar's page
   actions on it: `readCurrentPage`, `snapshotPage`, `clickElement`, `typeText`, `pressKey`,
   `selectOption`, `scrollPage` (`JOB_PAGE_CAPS` in `search-execute.mjs`). They are the same
   actions with the same rules (`app/bg/ui/page-control.js`, `page-control.mjs`): no password,
   payment or file fields, and a click that buys, sends, posts or deletes needs a yes.
   `planPageActions` and `clickAt` stay out. The page lives in `app/bg/ai/job-page.js`.
2. **Where the page is.** A run with nobody watching opens it in a hidden window
   (`show: false`, 1280×900) in the Job's Space's session, so it is signed in as the user; its
   pages can't open windows, its audio is muted, and it closes when the run ends. A run the user
   watches opens it in a tab of their window, in the "Jobs" tab group, with the page-control
   cursor, border and Stop bar. That tab stays open after the run.
3. **What a Job may do is on the Job.** `writes.pages` (`shared/jobs.mjs`) lists sites, by host
   (no `www.`) or `hyper://<key>`, each with `control` (may click and type) and `actions`: risky
   clicks the user let it repeat, by the sidebar's `similarKey` and a label. At most 20 sites, 20
   clicks each. A site's grant covers the whole host, and every page the Job reads or acts on is
   checked against it, so a link to another site needs that site's grant too.
4. **A run with nobody watching never asks.** A site it may not open, control it doesn't have, or
   a risky click it wasn't allowed is refused with a message that tells the model to stop and say
   what it needed. The run records each refusal in `needs` (`normalizeNeeds`) and My Library shows
   it under the run ("It wanted to …") with **Run it with me**.
5. **Run with me is the first run that asks.** `nomad.vault.runJob(id, { watch: true })` (the eye
   button in My Library → Jobs) runs the Job with the user's window. The first use of a site asks
   `jobPage` (open, then again for click and type), naming the Job; a risky click asks
   `aiPageAction` with the Job's name, and its "Also allow …" box means "on this Job's later runs,
   with nobody watching". Each yes is saved on the Job at once (`grantPage`, `jobs.grantPages`), so
   a run that fails later keeps them. The prompts say the Job wants it, not the site, because the
   site may be the one talking the Job into it.
6. **The user's yes is the only way to get a click.** In My Library the user can add a site, tick
   **Click and type**, and remove a site or an allowed click, but can't add an allowed click there.
   The AI's `saveJob` may add sites (asked with `jobWrites`, like any grant it adds), but
   `keepPageActions` drops any allowed click that wasn't on the Job already.
7. **Private data.** `openPage` is a private read (`PRIVATE_READS`, ADR-0037): the page is signed
   in as the user. Opening a page is a request to its site, so it goes through `egress.check`. A
   Job's egress guard trusts the sites in `writes.pages`, and a site allowed mid-run is trusted
   from then on, so a Job can use its sites after reading private data and still reaches nothing
   else.

## Consequences

- **The page is signed in as the user.** That is the point, and the risk: a site the Job may use
  can be read and, with control, changed. Grants are per site, a risky click is never repeated
  without the user's own tick on a run they watched, and the user sees every grant on the Job.
- **Hidden-window input is only verified on Linux.** Electron sends input to a hidden window's
  webContents, and the end-to-end run (a scripted model on a local site) clicked and typed there;
  macOS may throttle a hidden window differently. `backgroundThrottling: false` is set for that.
- **A watched run uses the window's Space for its tab;** the hidden page uses the Job's Space.
  These differ only when the user runs a Job of another Space with them.
- **The phone has no Run with me and doesn't show `needs`.** A Job runs on its computer; the phone
  lists it and its runs as before.
- **ADR-0030** said clicking and typing on pages stays out of Jobs because it needs a tab and the
  user watching. This ADR replaces that: the user watches once, and the Job keeps what they allowed.

## Amendment: watching a run in the AI Sidebar (2026-11-03)

A run is also a chat the user can watch (`app/bg/ai/job-chat.js`, rules in `job-chat-messages.mjs`).

- **Run with me opens the sidebar to the run.** The run's turn events (answer, reasoning, steps)
  are drawn in the AI Sidebar of the user's window, as one of its own turns would be
  (`aiShell.followJob`). The first message is the Job's prompt, marked `fromJob`. The sidebar's
  Stop ends the run (`aiShell.stopJob`), like the Stop bar on its page. A message typed while it
  runs is sent as the next turn once the run ends: a run can't be steered.
- **Any run can be watched while it runs.** My Library → Jobs shows a **Running** badge and a
  **Watch** button (`nomad.vault.viewJob`), which opens the window's sidebar to the run's chat and
  brings its page to the front: a watched run's tab, or the hidden page in a window of its own,
  which stays until the user closes it (closing it mid-run only hides it).
- **A chat is saved only once someone watches the run.** It is a sidebar session with
  `job: { id, title }`, saved with the watching window's webContents, so the sidebar's history and
  nomad://ai/chats mark it as a Job's (and as running while it is). The run's record names it
  (`chat` on the run, `makeRun`), so the Jobs page offers **Open its chat** on that run. Runs
  nobody watched keep their answer in the Job's history only, so an hourly Job doesn't fill the
  chat list.
- Its answer has no Checkpoint: the run records what it changed, and a Job's writes can be staged
  in a Draft, which the sidebar's Revert doesn't know about.
