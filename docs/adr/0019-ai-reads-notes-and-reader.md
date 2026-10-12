# The user's own AI can use their Notes and Reader, with four permissions

**Status: Accepted.** 2026-10-11.

The user's Notes and Reader live in the Vault (ADR-0017). The AI can now find and read them, and
change them, on the desktop and from the phone. The capabilities are in
`app/bg/ai/search-execute.mjs` (`CAPABILITIES`, gate `personal`). The pure logic is in
`app/bg/ai/vault-tools.mjs`, and the Vault and Drive reads and writes are in
`app/bg/web-apis/bg/ai-vault.ts`.

| Capability | Permission |
|---|---|
| `listNotes`, `readNote` | `notesRead` |
| `writeNote`, `highlightText` | `notesWrite` |
| `listReaderPosts`, `readReaderPost` | `readerRead` |
| `followFeed`, `unfollowFeed`, `markPostsRead` | `readerWrite` |

## Decision

1. **Only a personal turn.** A personal turn is the user's own AI: the AI Sidebar (`ai-shell.ts`),
   the phone's AI panel over the AI Bridge, or a program on this machine using the loopback MCP. The
   flag is `personal`. `ai.ts` `chat()` (a page's `nomad.ai.chat()`) and the phone's WebView handler
   force it off. A page's turn doesn't see these capabilities, and `executeTool` refuses them, so a
   page can't read the user's Notes through the AI, whatever options it passes. The same flag gates
   Names and the `drive` argument (ADR-0018).
2. **Four permissions: Notes and Reader, read and write apart.** Each capability asks its permission
   before it runs. The grants are separate, so the user can let the AI read Notes and not change
   them.
3. **Asked even on a `nomad://` page.** A trusted page normally gets every permission without a
   prompt. These four have `promptTrusted`, because the AI is asking, not Nomad's own code. The
   AI on `nomad://reader` still asks before it reads your Notes.
4. **Kept per site, like every other permission.** On desktop the prompt is for the active tab's
   site, and an "allow" is kept for that site (site-info lists it, and can take it back). A "deny"
   isn't kept. A site that shows hostile text can try to steer the AI into reading Notes and sending
   them somewhere (with `fetchUrl`). A grant per site means the user sees a prompt on that site
   first.
5. **One answer per turn.** In one turn, the first answer to each permission holds
   (`askOncePerTurn`). A turn from the phone relays every prompt to the phone, which keeps no
   grant. Without this, a turn that reads five Notes would ask five times. A "no" also holds, so the
   model can't ask again in a loop.
6. **The phone uses the desktop's copy.** A phone turn runs on the AI Provider. The Provider reads
   and writes its own copy of the Vault, which is the same Vault. The phone sends its active Space
   (`space`, a Root Drive key) for Reader, because Reader follows belong to a Space and the
   Provider has no tab to ask. A local turn uses the tab's Space.
7. **The AI can't delete a Note, or overwrite one it hasn't read.** `writeNote` creates a Note, or
   replaces one only with the `updatedAt` that `readNote` gave. If the Note changed since then, the
   text is kept as a conflict copy (`planNoteSave`), as when two Devices edit at once.
8. **Reader reads only followed feeds.** `readReaderPost` refuses a post from a feed the user
   doesn't follow. Feeds are read as the Reader reads them (`loadFeedPosts` mirrors
   `nomad://reader`), from the published Drive. A feed that doesn't answer in 8 seconds is listed
   with an error.

## Consequences

- The AI's Notes and Reader writes make no undo Checkpoint; Checkpoints cover Drive files.
- `highlightText` (added 2026-10-12, ADR-0020) marks text on the page in the user's tab, and with
  `note` makes a Note about it. A Highlight sits beside the Notes and can make one, so it asks
  `notesWrite`, not a fifth permission. It needs the page open on this computer, so a phone turn
  doesn't get it.
- The phone asks once per turn. It doesn't remember a grant, because it has no place to take one
  back yet.
- `PERSONAL_PROMPT` (in `api-reference.mjs`) tells a personal turn about Names, Notes and Reader.
  Every turn still gets `STANDING_PROMPT`.
