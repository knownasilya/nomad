# Blog feed format: walled.garden/feed descriptor + directory-per-post

A Blog declares itself with `type: "walled.garden/feed"` in `/index.json` (channel metadata plus `itemsPath`/`itemType`). Each Post is a directory under `/posts/` — a date-prefixed slug (`YYYY-MM-DD-title`) holding `post.json` (`walled.garden/post` metadata) plus a body file (`index.html`, `index.md`, or `index.txt`) and any co-located assets.

## Why

- **A channel-level descriptor was the missing schema.** Without it a Reader could only *guess* a drive was a blog by globbing `/posts/`. `walled.garden/feed` makes a drive detectable and self-describing (title, author, language, icon) and points at where its items live, so the same Reader can later consume other feed-shaped drives (forums, microblogs) by varying `itemsPath`/`itemType`.
- **Directory-per-post keeps the body out of the JSON** so it can be authored as real Markdown/HTML and rendered by extension — reusing the protocol handler's `index.{html,md,txt}` resolution (`_resolveEntry`), which also makes posts render as bare Markdown when no `/.ui` SPA is present (graceful degradation). The small `post.json` (with `summary`) lets the Reader render a feed list without replicating every full body.
- **Date-prefixed slugs** sort chronologically by name and make cross-device slug collisions on the shared Autobase `/posts/` path effectively impossible.

## Considered options

- **Inline body in `post.json`** (the forum's shape): rejected — painful to author long-form, and forces the Reader to download full bodies just to list a feed.
- **Markdown file with YAML frontmatter:** rejected — abandons `walled.garden/post` JSON validation and makes every consumer parse frontmatter, off-convention for a schema-first ecosystem.
- **A published `/feed.json` index for discovery:** rejected for v1 — a derived, mutable file is lossy under concurrent multi-writer Autobase writes (last-writer-wins on the path can drop entries); directory enumeration is correct by construction. May be added later purely as an external-RSS/Atom export.

## Consequences

- `walled.garden/post.body` becomes **optional**, and optional `summary`, `tags`, and `draft` fields are added. By convention the body is the sibling `index.{html,md,txt}` when `body` is absent.
- `draft: true` posts live in the public Blog drive: hidden from well-behaved feeds/Readers but still publicly replicable — obscure, not private.
- The Reader must bridge the Hyperdrive/Autobase read split itself (try Autobase, fall back to Hyperdrive per feed), since there is no unified read API yet. See ADR-0008.
