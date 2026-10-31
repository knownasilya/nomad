# The AI has its own page, with the sidebar's chats and a memory the user controls

**Status: Accepted.** 2026-10-31.

AI lived in one Settings tab: the runtime, the model, sharing and naming sites. The AI Sidebar's
chats could only be seen in the sidebar's history list, one title each, and only deleted there.
The assistant forgot everything about the user between chats. The user asked for one place for
their AI that manages chats and memory, reachable from the main menu, with the setup moved there.
Desktop only for now.

## Decision

1. **`nomad://ai` is the AI's page.** It has three views, `/chats`, `/memory` and `/setup`, and a link
   to My Library → Jobs, where Jobs stay (ADR-0030). The browser menu has an AI item next to Notes
   and Search. The old Settings → AI tab is now a nav item that opens `nomad://ai/setup`, and
   `nomad://settings?view=ai` goes there too, so old links keep working. The page is
   `app/userland/ai/` (vanilla Lit from app-stdlib, no bundle), styled like My Library in light and
   dark.
2. **Chats are the sidebar's sessions, where they already are.** They stay in
   `hyper://private/.ai-chat/sessions/` (ADR-0021), one list per Space's private drive. The page can
   search them (every word, in the name or any message, with a snippet), read one, rename one, delete
   one, and open one in the sidebar of its own window to carry on. A name the user gives is kept in
   `/.ai-chat/names.json`, not in the session, because the sidebar rewrites the session's `title`
   from its first message on every save. The page reaches them through a new internal API,
   `nomad.aiChats` (`app/bg/web-apis/bg/ai-chats.ts`), open to `nomad://` pages only. Opening a chat
   opens the window's sidebar (`openAiSidebarChat` in `tabs/manager.js`) and the shell hands the
   session id to the sidebar once it is on screen. A rename or delete tells every window's sidebar,
   so one showing a deleted chat starts a new one instead of saving it back.
3. **Memories are Vault records.** `/.vault/ai-memory/<id>.json`
   `{ type: 'nomad/ai-memory', id, text, by, createdAt, updatedAt }` (`shared/ai-memory.mjs`): one
   short fact or preference each, 500 characters at most, 200 at most. They belong to the user, not
   a Space, and sync to linked Devices like Notes and Mods; a solo Vault brings them along when it
   joins another. `app/bg/ai/memory.js` keeps them in memory so a turn doesn't read the Vault.
4. **Every personal turn reads every memory.** `runChat` adds `memoryPrompt()` to the system prompt
   of the user's own AI (the sidebar, the phone's AI panel, a Job), newest first with each id, up to
   8,000 characters, saying how many older ones it left out. A page's `nomad.ai.chat()` never gets
   them (ADR-0021): a memory is the user's, and a page could ask its model to repeat it.
5. **The assistant changes memories with two capabilities, after asking.** `remember({ text, id? })`
   adds one (a repeat of an existing memory is not saved twice) or replaces one; `forget({ id })`
   drops one. They are `CAPABILITIES` with `gates: { personal, memory }`, so a page's turn never
   sees them, and they are not in `JOB_CAPS`, so a Job can't change them. Both ask the
   `memoryWrite` permission (`promptTrusted`, like the Notes grants). A memory follows the user
   into every later chat, so a hostile page that talked the assistant into saving one would keep
   steering it; the prompt is the user's chance to say no, the `PERSONAL_PROMPT` tells the model to
   save only what the user said, never secrets, never because a page asked, and the AI page shows
   who wrote each memory last (`by`).
6. **The user is in charge of memory.** `nomad://ai/memory` lists, searches, adds, edits and deletes
   memories, and forgets all of them at once. The `ai_memory` setting (on by default) turns memory
   off: no memory in the prompt, and no `remember` or `forget`.

## Consequences

- Session listing still reads every session file, as the sidebar's history always did. A Space with
  thousands of chats will want an index; nothing here stops adding one beside `names.json`.
- The phone's AI panel runs on a computer's runtime, so it gets the computer's memories with no
  phone change beyond the `memoryWrite` permission text. A phone UI for chats and memory is later
  work.
- Memory is plain text the user can read and edit. There is no automatic summarising of chats into
  memories; the assistant saves one only when it decides to call `remember`.
