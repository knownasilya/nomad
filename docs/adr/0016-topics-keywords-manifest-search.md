# Topics, Keywords, and manifest-only search over Listed Drives

**Status: Accepted; implemented 2026-07-11.** Implements the direction recorded in ADR-0014 (opt-in
public drive discovery via the `walled.garden/index` announce topic) as a concrete, phased vertical
slice: a manifest vocabulary for categorization and search, an explicit listing switch, a crawler
super-peer that indexes **manifests only**, and a built-in `nomad://search` client. See CONTEXT.md →
*Listed*, *Topic*, *Keyword*.

**Implementation map:**
- Manifest vocabulary — `app/lib/schemas/index.json` (base) + `FeedSchema`; normalization in
  `app/lib/listing.ts` (tested by `tests/unit/listing.test.js`).
- Listing switch + announce — `bg/web-apis/bg/autobase.ts configure()` → `bg/hyper/discovery.js`
  (joins `INDEX_TOPIC`, runs the `nomad/listing` handshake); reconciled on manifest read in
  `bg/filesystem/index.js getDriveIdentFull`. Wire format: `shared/listing-wire.mjs`.
- UI — the "List this drive publicly for search" editor in `userland/site-info/js/com/identity.js`.
- Crawler — `app/tools/crawler.mjs` (standalone) + `app/tools/crawler-index.mjs` (index core, tested
  by `tests/unit/crawler-index.test.js`).
- Search client — `app/userland/search/` + registration/`SEARCH_CSP` in `bg/protocols/nomad.js`.

## Decision

1. **Three new base `index.json` fields, on any Drive type — not Feed-specific.** `indexable`
   (boolean), `topics` (array of slugs), and `keywords` (array of strings) join `title`/
   `description`/`fallback` in the common manifest schema (`app/lib/schemas/index.json`), mirrored
   into `FeedSchema` for editor autocomplete. Discovery is a Drive-level concept: a Blog, an app, a
   template, or a Profile Drive can all be Listed. The indexer presents result types differently
   (a Feed result gets "Subscribe in Reader"); the vocabulary does not encode that difference.

2. **Listing is an explicit switch, never implied by metadata.** A Drive announces on ADR-0014's
   `INDEX_TOPIC` iff `indexable: true` is in its manifest — set through UI (site-info), managed like
   the existing `collaborative` flag. Declaring Topics alone does nothing observable; a Listed Drive
   with zero Topics still announces and is searchable by title/description/keywords. The manifest is
   the right home because it **replicates** (all of a user's Devices announce consistently) and is
   **crawler-verifiable** (consent is in the Drive's own bytes). This collapses ADR-0014's reserved
   `indexable: false` veto into the same field: absent/false = never announce, true = list me.
   Never applies to `hyper://private/`, the Vault, or a Root Drive.

3. **Topics are exact-match facets; Keywords are search text. They are different fields with
   different rules.**
   - `topics`: max **5** per Drive, lowercase hyphenated slugs (any script, ~40 chars). Topics are
     "what this Drive *is*" — shelves it sits on. Slug canonicalization exists because there is no
     registry: independent indexers must agree that two Drives declaring the same Topic share a
     shelf without fuzzy folding.
   - `keywords`: max **12** per Drive, free-text short phrases (spaces fine, ~40 chars each),
     case-insensitively matched, no slug normalization — they are matched as text, never compared
     as identities.
   - Enforcement is layered: schema validation warns at author time (editor), the UI normalizes on
     entry, and the **indexer defensively enforces at crawl time** (case-fold, drop invalid slugs,
     take only the first 12 keywords). The indexer-side cap is the real limit and the anti-spam
     property — stuffing beyond it buys nothing. An over-limit manifest is not invalid; nothing in
     the read/serve path rejects it.

4. **The crawler indexes manifests only. The unit of search is the Drive, described by its own
   manifest.** Index `title` + `description` + `keywords` under the declared `topics`. No `/posts/`
   walk, no post bodies, no full-text — ADR-0014's content-crawl sketch is explicitly deferred to a
   future index version. Search finds Drives; the Reader reads them. Accepted trade-off:
   author-curated metadata is both the spam defense and the recall ceiling — a Drive with a lazy
   description is nearly invisible regardless of content quality.

   **Refinement made during implementation:** the `nomad/listing` intake frame carries the
   manifest-only fields *inline* (`shared/listing-wire.mjs` → `LISTING { driveKey, type, title,
   description, topics[], keywords[] }`), not just the key. Since the index needs only those few
   fields, the crawler indexes straight from the handshake and never has to open the Drive — which
   makes the crawler a thin, dependency-light peer. The Drive **key** still rides in every frame, so
   a later index version can reopen the Drive and re-verify the fields against the signed, replicated
   manifest (and add full-text). The crawler **re-enforces the caps defensively** on ingest (topics
   ≤5 lowercased, keywords ≤12) so a hostile announcer's frame cannot exceed the limits — trust
   nothing from the wire. This trades the stronger "index only what's in the signed manifest"
   property of the original wording for a far simpler v1; the key-carried reopen path keeps that
   stronger property available without another wire change.

5. **Search is global by default; Topics are an optional filter and an emergent directory.**
   `nomad://search` (a new built-in app, deliberately not bolted onto Reader — Reader is Feeds you
   follow, search is Drives you don't know yet) searches all Listed Drives; the Topic directory is
   whatever Listed Drives declare, aggregated — never a curated list. No one owns the shelf
   namespace, same spirit as ADR-0014's ownerless funnel. Topic-first navigation was rejected
   because it would make zero-Topic Listed Drives unreachable, contradicting §2.

6. **Phased delivery, full slice in scope.** (1) Schema fields + announce wiring + site-info
   toggle; (2) the crawler as a headless module (ADR-0014's deferred follow-up) — we run the first
   instance, serving the plain HTTP/JSON API per ADR-0014 §6; (3) `nomad://search` pointed at a
   **configurable index endpoint**, so a second indexer is a settings change and no indexer is
   privileged. Publish-side-only was rejected: the toggle would promise findability that is false
   until an indexer exists.

## Considered options (rejected)

- **Per-Topic swarm announce topics** (`hash('walled.garden/topic/<slug>')`, search = live peer
  enumeration, no indexer). Shippable with zero infrastructure, but search would only see
  currently-online Drives, latency is swarm-join-and-wait, and popular Topics become large swarms.
  Kept compatible as a possible future intake source, not the mechanism.
- **Topics as the implicit listing opt-in** (≥1 topic ⇒ announce). One knob fewer, but editing a
  JSON file silently changing network visibility was judged the wrong consent model; listing is a
  distinct, explicit act.
- **One combined tags field** doing both category membership and search matching. Every throwaway
  keyword would spawn a browsable shelf — facet spam by construction.
- **Fields on `FeedSchema` only.** Splits the brain: `indexable` is Drive-level while categorization
  would be Feed-level, and listing an app or person would need a fake feed or a later schema change.

## Consequences

- The manifest vocabulary and slug convention are **public protocol surface**: once foreign
  indexers consume them, changing shape or normalization rules is a coordinated migration, not a
  refactor. That is why the limits (5/12) and slug rules are recorded here rather than left to
  implementation.
- `indexable` becomes runtime-coupled state: the manifest watcher must join/leave `INDEX_TOPIC`
  when it flips (same pattern as `collaborative`), and a well-behaved indexer delists on recrawl
  when it flips off. Delisting removes a Drive from an index only — bytes still replicate to anyone
  holding the key (ADR-0014).
- A `walled.garden/listing` handshake schema (ADR-0014 follow-up) is now actually needed by
  phase 2 and should be specified via the ADR-0005 process when the crawler lands.
