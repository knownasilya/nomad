# AI Jobs run on a computer, and their results notify the phone through the Vault

**Status: Accepted.** 2026-10-30.

The user wants to tell the AI Sidebar "every morning at 8, sum up my unread Reader posts and send it
to my phone" and have that happen. A **Job** is a saved prompt that the user's AI runs by itself, by
hand or on a schedule. Each run's answer is kept, and a run can **notify** the user's phone. The
rules are in `shared/jobs.mjs`; the desktop side is `app/bg/ai/jobs.js` (store, scheduler, runner),
`runJobTurn` in `app/bg/web-apis/bg/ai.ts`, and My Library → Jobs; the phone side is
`mobile/backend/lib/vault-apps.mjs`, `mobile/components/Jobs.tsx` and
`mobile/lib/useJobNotifications.ts`.

## Decision

1. **Jobs and their runs are Vault records.**
   `/.vault/jobs/<id>.json` `{ type: 'nomad/job', id, title, prompt, source?, schedule, notify, enabled, device, space, createdAt, updatedAt, scheduleFrom }`
   and `/.vault/job-runs/<jobId>/<runId>.json`
   `{ type: 'nomad/job-run', id, jobId, title, device, trigger, startedAt, finishedAt, status, output, error?, notification }`.
   Every linked Device sees them, like Notes and Mods. A run's answer is the user's own content,
   the same as a Note, and it is capped (8,000 characters, the newest 10 runs per Job) so the Vault's
   log stays small. ADR-0013 keeps live chat off the Vault; a Job's run is a finished result, not a
   stream, so it belongs there.
2. **One Device runs a Job on its schedule.** `device` names it: the computer it was made on, until
   the user moves it ("Run it on this computer instead"). Two desktops never run the same Job twice.
   Any computer with an AI Runtime can run a Job by hand. The phone has no Runtime, so its "Run now"
   writes `/.vault/job-requests/<jobId>.json`; the Job's computer runs it when it sees the request and
   deletes the record. That works without AI sharing turned on and waits out a sleeping laptop,
   which a call over the AI Bridge would not.
3. **Schedules are local, and say what people say.** By hand; every N minutes (15 at least),
   optionally only between two times and on some weekdays; at one or more times of day on some
   weekdays; on days of the month (the last day too) at one or more times; once, at a date and
   time; or a five-field cron expression. All in the running computer's time zone.
   `normalizeSchedule` also reads phrases ("weekdays 9:00 and 17:00", "every 30 minutes from 9:00 to
   17:00", "last day of the month 18:00", "tomorrow 9:00", "in 2 hours", "0 8 * * 1-5"), so the AI
   can pass what the user said; My Library has a form per kind plus a "type it" box, and shows the
   schedule in words with its next three runs (`previewSchedule`). A schedule counts from when it
   was set (`scheduleFrom`), so a new or edited schedule never fires for a time already past. A
   time missed while the computer slept runs once when it wakes, not once per missed time. A
   one-time Job runs once at its time, however often it was run by hand before.
4. **A run is a turn on a new `job` stage** (ADR-0021): the user's own AI, with no tab and nobody
   watching. It reads and changes nothing: of the personal capabilities it gets only listNotes,
   readNote, listReaderPosts, readReaderPost and notify (`JOB_CAPS`), plus the drive readers and
   fetchUrl; writes are off and it asks no permission. The Notes and Reader reads are granted with
   the Job (`jobPermit`): making it, through the `jobsWrite` permission or in My Library, is the
   user's yes. A page's text a Job reads can't talk it into changing anything, because nothing it
   can call changes anything. It runs on this computer's Runtime only, never another Device's over
   the Bridge, and stops after 10 minutes.
5. **Notifications.** `notify` on the Job is `always` (each run notifies with the start of its
   answer), `auto` (only when the run calls the `notify` capability, for "tell me if…" Jobs) or
   `never`. A failed run notifies too, once per streak of failures. The run record carries the
   notification it sends, so a notification is just data in the Vault.
6. **The phone shows what it hasn't shown.** On every Vault change, and when the app comes back,
   the phone asks for runs that finished after its mark (the newest `finishedAt` it handled, a
   desktop time, never the phone's clock) and posts a system notification for each
   (`expo-notifications`, local only). The first look starts from the newest run, so linking a
   phone doesn't replay old runs. Tapping one opens that run in the phone's AI Jobs screen. The
   phone asks for the notification permission once it sees a Job that notifies.
7. **The AI makes them.** `listJobs`, `saveJob`, `runJob` and `deleteJob` are personal capabilities
   behind two new permissions, `jobsRead` and `jobsWrite` (dangerous: a Job runs by itself and
   reads Notes and Reader). So the AI Sidebar, the phone's AI panel and the loopback MCP can all
   make one. A Job made from the phone runs on the computer that answered it.

8. **A Job can come from a drive.** `source` names a folder with `job.md` (a prompt) and/or
   `job.js` (a module in the `execute` format: `import { nomad } from 'nomad:runtime'` and a
   default-exported `main(params)`), or one of those files and the one next to it
   (`shared/jobs.mjs` `sourceFiles`). The module runs first, in the `execute` sandbox with the
   Job's capabilities (reads, plus `notify`), and gets `{ job, prompt, lastRun }`. With a prompt,
   the AI gets the module's result with `job.md` and the Job's own `prompt`; without one, the
   result is the run's answer and no AI runs, so a module-only Job works without an AI Runtime.
   - A source in a drive this Device can write (the user's own) is **live**: each run reads the
     files as they are then, so editing the drive edits the Job.
   - Anyone else's drive is **copied** into the Job record when it's added (`module`, `prompt`,
     `hash`, `copiedAt`), because a Job runs unattended with the user's Notes and Reader, and the
     drive's owner shouldn't be able to change what runs. Autobase drives have no version-pinned
     reads, so a copy is the pin. Each run also reads the drive and, when its hash differs, notes
     it on the Job (`changed`). My Library shows that version's files; "Use this version" saves
     exactly what the user looked at. The AI can add a source but can't take a newer version of
     a copy.

## Consequences

- **No push server.** The phone learns about a run when its Vault syncs: while the app is open, or
  in the background as long as Android keeps it running. Otherwise the notification shows the next
  time the app opens. A real push (FCM/APNs) needs a relay outside the user's Devices, or a
  periodic background task that wakes the Bare backend to sync; either can feed the same records.
- **The computer must be awake.** A Job is due on a laptop that sleeps through 8:00 runs when it
  wakes. `ai_keep_awake` (ADR-0013 amendment) is the only thing that holds it awake, and only while
  AI sharing is on.
- Reading only rules out "mark them read" and "save a Note" Jobs for now. Per-Job grants, chosen
  when the Job is made, would open those up.
- The run's prompt has no chat history, so the AI writes it as a complete instruction (the
  `saveJob` description and `PERSONAL_PROMPT` say so).
- A copied source makes the Job record as big as its files (32,000 characters of module and 8,000
  of prompt at most). Live sources store only their URL.
