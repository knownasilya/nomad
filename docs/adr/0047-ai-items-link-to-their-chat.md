# Items the AI makes link back to its chat

**Status: Accepted** 2026-11-09, built as below. Builds on ADR-0021 (the assistant is not tied to a
tab), ADR-0030 (AI Jobs), ADR-0032 (the AI page and its chats), ADR-0044 (Assets) and the links to
the user's things in AI answers (`shared/item-links.mjs`), which went the other way: from the chat
to the item.

When the user's AI writes a Note, saves a file to Assets or makes a page in a drive, the chat that
did it is the best explanation of why the item looks the way it does. Nothing on the item led back
to it: the user had to remember which chat it was and search nomad://ai/chats.

## Decision

1. **An origin.** `{ stage, chat?, job?, space?, at, made? }` (`shared/ai-origin.mjs`, tests
   `tests/unit/ai-origin.test.js`). `stage` is the turn's (ADR-0021): `sidebar` names its chat (the
   session id in `chat-store.js`) and the Space key whose `hyper://private/` keeps it; `job` names the
   Job, and the run's chat when someone watched it; `phone` names the phone AI panel's chat, which it
   saves in the same files in its active Space's Root Drive (`shared/ai-chats.mjs`; an older phone
   sends none); `outside` (the loopback MCP) has no saved chat, so it only says the AI did it. `made` marks the chat that made the item, not only
   changed it. Only ids are stored, never a chat's title or words.
2. **Where it is kept.** A Note and an Asset keep a list on their record as `ai`, newest first, one
   entry per chat, at most five (`addOrigin`); `makeNote` and `makeAsset` carry it over, so a later
   edit on any Device keeps it, and a conflict copy starts without it. Setting it never changes a
   Note's `updatedAt` (`vault-apps.ts` `setNoteOrigin`, like topics). A drive's goes in the Vault,
   `/.vault/ai-made/<driveKey>.json` (`app/bg/ai/ai-made.js`), with the paths each chat wrote,
   because a drive can be public and the chat ids are the user's.
3. **Recording.** `runChat` works out the turn's origin (`turnOrigin`): the AI Sidebar passes its
   chat (`ai-shell.ts`), a Job run passes the Job (`runJobTurn`, for job.js too), the phone's panel
   sends its chat's id with the turn (`chat` in the Bridge opts; the Provider makes the origin from it
   and never takes one from the frame), the loopback MCP's other programs say `outside`. `executeTool` hands it to `writeNote` (`ai-vault.ts`), `saveAsset`
   (`assets.ts` `saveForAi`), `createDrive` and `writeDriveFile`. A page's own `nomad.ai.chat()` is not
   the user's AI and records nothing.
4. **Showing it.** `resolveOrigins` turns a list into lines, with the lookups passed in, so both
   platforms say the same: "Made in the AI chat “…”" while the chat exists (its current name),
   "Made by the AI Job “…”" when only the Job does, else "Made with AI" with a tooltip saying why
   there's no link (deleted, someone else's, or a phone panel from before it saved its chats). Someone else in a shared
   Space finds no chat by that id, so they see "Made with AI".
   - Desktop: internal `nomad.aiChats.origins(list)` and `driveOrigins(url, path)`, drawn by
     `app-stdlib/js/ai-origin.js`: folded into one quiet line under Linked mentions at the foot of a
     note in nomad://notes, under the caption in the
     Assets viewer, and in site-info for a drive (the chats that wrote that page first). A chat
     opens in the window's AI Sidebar (`nomad.aiChats.open(id, { space })`, switching the window to
     the chat's Space first when it is another); a Job opens in My Library → Jobs.
   - Phone: `RPC_APPS` `aiChats`/`origins` and `aiChats`/`load` (`mobile/backend/lib/ai-chats.mjs`),
     which read the chat from the Space's Root Drive, only in the user's own Spaces. A tap shows the
     chat in a sheet (`mobile/components/AiOrigins.tsx`); one in the open Space can be carried on in
     the AI panel, which opens over the browser while the screens it came from wait, and they come
     back when it closes. A Job opens on the Jobs screen. Notes (a small "AI" chip at the end of the
     topics bar) and the Assets viewer show the lines. Drives on the phone don't show them yet.

## Consequences

- A sidebar turn answered by another Device's runtime (the Bridge) records only `phone`
  there; the chat isn't linked.
- An origin written while a live Note's leader saves at the same moment can be lost (the leader
  saved from the record it read before). The next AI write adds it again.
