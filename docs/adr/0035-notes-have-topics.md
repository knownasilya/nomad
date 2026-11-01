# Notes have topics, which the AI can pick, and the canvas gathers notes around them

**Status: Accepted.** 2026-11-01.

Reader sorts saved articles and feed posts into topics, and its canvas draws each topic as a hub
with its articles around it (ADR-0033). Notes had only `[[links]]`: a note that links nowhere floated
alone on the Notes canvas, and the list had no way to show "my garden notes". The user asked for
notes to be taggable with a topic, for the AI to tag them, and for the canvases to use the topics.

The rules are `shared/note-topics.mjs` (tests `tests/unit/note-topics.test.js`), on top of Reader's
topic rules in `shared/reader-articles.mjs`. Desktop tags in `app/bg/web-apis/bg/note-topics.ts`;
the canvas graph is `app/userland/notes/js/graph.js` (tests `tests/unit/notes-graph.test.js`).

## Decision

1. **Topics are fields of the Note record**: `topics: [string]` and `topicsBy: 'user' | 'ai'`.
   `makeNote` carries them over on every save, so an edit on any Device keeps them; a conflict copy
   starts without them. Setting topics leaves `updatedAt` as it is: it isn't an edit of the text, so
   another Device's editor never turns its next save into a conflict copy, and the list keeps its
   order. A topic follows Reader's rules: one line, at most 32 characters, each once in any case,
   with an existing topic's spelling. Kept on the Note, they move with it between a Space and every
   Space, and into a Space Library when the Space is shared (ADR-0029), with no new record kind.
2. **The AI picks one to three topics once a Note has settled**: at least 12 words, and no edit for
   two minutes, on any Device. It runs on this Device's runtime only (`completeText`), one Note at a
   time, given the topics the user's Notes have so far. A pass runs a few seconds after the Vault
   changes (so a Note written on the phone is sorted by the computer), once 30 seconds after start,
   and when a waiting Note settles. It covers the user's own Notes and each Space's, skipping a
   shared Space the user can only view. The Note's words go in as data to sort; the reply is only
   read as a short list of topics. Its answer is stored even when empty (`topicsBy: 'ai'`), so a Note
   is asked about once. If the Note was edited while the AI was thinking, nothing is written and the
   next pass looks again. Topics the user set are never changed by the AI.
3. **The AI page's setup** (nomad://ai/setup) → "Sort my notes into topics" (`ai_note_topics`, on
   by default) turns the automatic pass off. "Suggest" in a note's topic bar, and "Sort N notes into
   topics" above the list while the pass is off, still ask.
4. **nomad://notes** shows a note's topics in a bar above its text: click one to list its notes, ×
   to take it off, type to add one (Enter or a comma; the known topics are suggested), or Suggest.
   The chips above the list show one topic's notes, and each row shows its topics. The internal API
   is `nomad.vault.setNoteTopics({ id, topics })` and `nomad.vault.suggestNoteTopics(ids?)`;
   `listNotes()` adds `ai: { autoTopics, tagging, noRuntime }`.
5. **The canvas gathers notes around their topics.** Each topic is a hub (`topic:<topic, lowercased>`,
   drawn like Reader's topics), tied to its notes by a dashed line with no arrowhead, so it reads
   apart from a link between notes. Clicking a hub lists its notes; the list's topic lights up its
   hub. The search matches topics too. The phone draws the same graph (`npm run build:canvas`).
6. **The phone** shows the same chips and row topics, a topic row under the editor's tools that
   opens a sheet to change them (`notes`/`setTopics` over `RPC_APPS`), and topic hubs on its canvas:
   tap one to see how many notes it has, then List. It doesn't ask an AI itself; a computer sorts
   the phone's notes.
7. **The user's AI** sees topics: `listNotes` returns them and takes a `topic`, `readNote` returns
   them, and `writeNote` takes `topics`, which count as the user's.

## Consequences

- A Device on an older version that edits a tagged Note writes it without its topics. The AI then
  sorts it again; topics the user set by hand on it are lost.
- Two Devices that change the same Note at nearly the same time can still lose one write, as with
  any Note record. The AI only writes a Note nobody has edited for two minutes, which keeps that
  rare.
- Reader's topics and Notes' topics are separate lists. They share the rules, not the names.
