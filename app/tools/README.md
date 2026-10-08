# nomad discovery crawler

A standalone reference **indexer** for public-Drive discovery (ADR-0014 / ADR-0016). It is *not* part
of the Electron app — it is an ownerless aggregation peer you run yourself. Any number can run; none
is privileged.

## Run

Run from the `app/` directory so bare imports resolve `app/node_modules`:

```
node tools/crawler.mjs [--port 8787] [--storage <dir>]
```

Environment: `NOMAD_CRAWLER_PORT` is an alternative to `--port`.

## What it does

1. Joins the well-known `INDEX_TOPIC` (`hash('walled.garden/index/v1')`) as a lookup client.
2. On each connection, opens the `nomad/listing` Protomux channel and receives one `LISTING` record
   per publicly-listed Drive — its key plus manifest-only fields (title / description / topics /
   keywords). See `shared/listing-wire.mjs`.
3. Folds records into an in-memory inverted index, defensively re-enforcing the ADR-0016 caps
   (topics ≤ 5, lowercased; keywords ≤ 12).
4. Serves a plain HTTP/JSON search API (CORS-open):

   | Endpoint | Returns |
   |---|---|
   | `GET /search?q=<terms>&topic=<slug>` | ranked matches (global; `topic` is an optional exact facet) |
   | `GET /topics` | the emergent topic directory with counts |
   | `GET /stats` | `{ drives, topics }` |

The built-in `nomad://search` app points at this API (configurable endpoint). This is the v1
"torrent-search-site" stance: the *index* is central, the *content* stays P2P. ADR-0014 §6 sketches
the endgame — publishing the inverted index itself as a Hyperbee so the index has no privileged host.

## Scope (v1)

Manifest-only. It does **not** walk `/posts/` or index post bodies, and it never crawls follows
(forbidden by ADR-0013). The Drive key rides in every record, so a later version can reopen a Drive to
re-verify against its signed manifest and add full-text.

## Tests

- `tests/unit/crawler-index.test.js` — the index core (`crawler-index.mjs`): frame codec round-trip,
  ingest, search, topic directory, defensive caps.
- `discovery-e2e.mjs` (run `node tools/discovery-e2e.mjs` from `app/`) — drives the real
  announcer↔crawler path over a live Hyperswarm on a local hyperdht testnet, asserting a LISTING
  frame crosses the wire and lands searchable. Wrapped as a child-process test in
  `tests/unit/discovery-e2e.test.js` so it runs in the normal suite (~0.5s, deterministic).
