# Profile Drives go multi-writer by Writer-Key aggregation, not Autobase

Unlike Space Root Drives — which are converted to Autobase-backed Collaborative Drives for multi-device writing (ADR-0006) — a **Profile Drive keeps its original single-writer `hyper://` URL and becomes multi-writer by aggregation**. Each Device publishes social content under its own key; the canonical Profile Drive publishes a `writer-keys.json` listing all the user's Device keys; consuming peers treat posts from any listed key (carried in `Post.author.writerKey`) as the same identity and merge them.

## Why

A Profile Drive's URL is its public social-graph anchor — it is what every follower points at. Converting it to an Autobase mints a new key and therefore a new URL, silently breaking every existing follower. Aggregation preserves the URL. The `walled.garden` schemas were already designed for this: `writer-keys` (a list of Device keys) and `Post.author.writerKey` exist precisely to resolve multiple Device writers back to one person without a shared log.

## Considered options

- Convert the Profile Drive to an Autobase like Root Drives: rejected because the public URL changes and breaks the social graph for existing users.
- Leave the Profile Drive single-device (only the original Device can post as the identity): rejected because it violates the "any Device can edit anything" goal for the user's public presence.

## Consequences

- Two multi-writer strategies coexist: Autobase for private Root Drives, aggregation for public Profile Drives. A reader of the code must not assume the Profile Drive is an Autobase.
- Readers must implement the merge: gather posts across all keys in `writer-keys.json` and order them. Trust flows from the canonical Profile Drive's writer-keys list, so that file's integrity is the identity boundary.
