# The user writes skills for their AI, and manages them on the AI page

**Status: Accepted.** 2026-10-31.

The AI page (ADR-0032) has the sidebar's chats, the AI's memory and its setup. The user asked for it
to manage skills too. Nomad had no skills: the only standing instructions were memories (short facts,
all in every prompt) and a Drive's own AI Config (`/ai/system.md`, for that Drive's app, skipped by the
user's assistant). A skill is the third kind: instructions for one kind of task ("how I want my weekly
report", "turn a recipe page into a Note"), longer than a memory, and needed only on the turns that do
that task. Desktop page only for now.

## Decision

1. **Skills are Vault records.** `/.vault/ai-skills/<id>.json`
   `{ type: 'nomad/ai-skill', id, name, description, instructions, enabled, createdAt, updatedAt }`
   (`shared/ai-skills.mjs`). `name` is lowercase words joined by hyphens, at most 64 characters, one
   per user. `description` says when to use the skill, one line, at most 1,024 characters.
   `instructions` are Markdown, at most 20,000 characters. 100 skills at most. They belong to the
   user, not a Space, sync to linked Devices like memories, and a solo Vault brings them along when it
   joins another. `app/bg/ai/skills.js` keeps them in memory.
2. **A turn lists them; search opens one.** Every personal turn that offers tools (the sidebar, the
   phone's AI panel, a Job, and a CLI turn over the loopback MCP) gets `skillsPrompt()` in its system
   prompt: each enabled skill's name and description, up to 6,000 characters, and how to open one.
   The instructions sit behind `search`, in a new `skill` domain: `{ entity: 'skill:<name>' }` returns
   them, `{ domain: 'skill' }` lists them, and a query ranks them with the rest. So a skill costs a
   line per turn until it is used, and it follows the same search-then-act path as guides. Another
   program calling the loopback MCP gets the domain too. A page's `nomad.ai.chat()` never does
   (ADR-0021).
3. **Only the user changes skills.** `nomad://ai/skills` lists and searches them, adds and edits
   them, turns each on and off, and deletes them, through the internal `nomad.vault.listSkills` /
   `saveSkill` / `deleteSkill`. The AI has no capability that writes a skill. A skill steers every
   turn whose request matches it, like a memory, so a page that talked the assistant into writing one
   would keep steering it; and unlike a memory, a skill's instructions aren't on screen in the prompt
   for the user to notice. When the user asks the assistant for a skill, it drafts one in its answer
   and points to the AI page (`PERSONAL_PROMPT`).
4. **SKILL.md in and out.** The page imports a SKILL.md (front matter `name` and `description`, then
   the instructions), the format other assistants use, into the new-skill form, and exports a skill
   as one (`nomad.vault.parseSkillMd` / `exportSkill`, so the page has no copy of the rules). Nothing
   else in a SKILL.md folder (scripts, other files) is brought in.

## Consequences

- A skill is text only. It can tell the assistant which capabilities to use, but it can't carry code;
  a Job's `job.js` (ADR-0030) stays the way to run code by itself.
- No global switch: each skill has its own, and a skill that is off is neither listed nor searchable.
- A phone UI for skills is later work. The phone's AI panel already uses the computer's skills, since
  it runs on the computer's runtime.
- Letting the AI propose a skill with a permission prompt (like `remember`) is possible later; it
  would be one capability and one permission beside `memoryWrite`.
