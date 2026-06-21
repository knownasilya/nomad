# Blog is an Autobase Collaborative Drive, not Profile-style aggregation

A Blog is created as an Autobase-backed Collaborative Drive, so all of the user's Devices are Writers of one drive under a single stable URL. This deliberately diverges from ADR-0007, which made Profile Drives go multi-writer by aggregation (per-device content drives + `writer-keys.json`) instead of Autobase.

## Why

ADR-0007 chose aggregation *only* because a Profile Drive's URL was already the public social-graph anchor: converting it to an Autobase mints a new key and silently breaks every existing follower. A brand-new Blog has no existing follower graph, so that constraint does not apply. Creating it as an Autobase from the start gives true single-URL multi-writer editing (every Device appends to the same `/posts/`), reuses the existing Collaborative Drive + Vault machinery (the forum template is the precedent), and gives the Reader a single URL to subscribe to rather than a `writer-keys` merge.

## Considered options

- **Profile-Drive aggregation (per ADR-0007):** rejected for a new Blog — it forces every consumer to read `writer-keys.json` and merge posts across N per-device drives, paying that complexity for a URL-stability benefit a new Blog doesn't need.
- **Single-writer Hyperdrive:** rejected — only the origin Device could publish, violating the "any Device can edit anything the user owns" goal.

## Consequences

- A third multi-writer shape now coexists with the two from ADR-0006/0007: Autobase for private Root Drives, aggregation for public Profile Drives, and **Autobase for public Blogs**. A reader of the code must not assume "public drive ⇒ aggregation."
- A Blog is distinct from a Profile Drive: it references a Profile Drive via the feed descriptor's `author.url` for identity, rather than being the identity.
- Autobase has no cross-drive query: `beaker.hyperdrive.query()` cannot span Blogs (it opens cores as Hyperdrives and fails on an Autobase core). Consumers must read Blogs via `beaker.autobase`, or detect-and-dispatch per drive. See ADR-0009.
