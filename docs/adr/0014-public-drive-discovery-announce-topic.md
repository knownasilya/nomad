# Public drive discovery via an opt-in well-known announce topic

**Status: Proposed (future).** Designed 2026-07-04. Sketches how a **search/index layer over public
Drives** would solve the one problem the protocol deliberately does not: *finding Drives you were
never handed the key to.* Nothing here is built, and none of it changes the wire format or
`nomad.fs`. It records a direction — an **opt-in `walled.garden/index` announce topic** plus a tiny
key-intake handshake — so that when indexing/search is picked up, it is built as an aggregation layer
*beside* the protocol rather than as a central registry baked *into* it. This ADR is a companion to
ADR-0013 (which makes non-enumerability of followers a defended invariant); the same P2P-default that
makes follows un-crawlable is what makes public Drives un-discoverable, and this is the deliberate,
opt-in escape hatch. See CONTEXT.md → *Feed* and *Discovery key*.

## The problem: there is no way to enumerate Drives, by design

A search engine decomposes into **discovery → crawl → index → serve**. Crawl/index/serve are
conventional and already possible today with the public read API: a peer opens `nomad.fs.drive(url)`,
reads `/index.json`, detects `type: "walled.garden/feed"` (ADR-0009), walks `/posts/` recursively,
and pulls post bodies via sparse replication. The blocker is the *first* step. In Nomad:

- A Drive is addressed by a 32-byte public key; you cannot enumerate the keyspace.
- A Drive announces on the swarm under its **discovery key** = `hash(publicKey)`
  (`configureNetwork(discoveryKey, { announce, lookup })`, `app/bg/hyper/daemon.js`). The discovery
  key is computable *only by someone who already holds the public key* — it is a "prove you know the
  key" gate, not a directory. Great for privacy; it means there is no rendezvous where an *unknown*
  Drive ever surfaces.
- There is deliberately **no global registry**: `hyper://private/` is never announced, follows are
  subscriber-side (ADR-0013), and the Reader requires a `hyper://` URL to be pasted or shared. Blog
  discovery today is entirely manual.

So "build a search engine" reduces almost entirely to "solve key discovery" without reintroducing a
central authority that owns the namespace.

## Decision

1. **A search engine is an aggregation super-peer that lives *outside* the protocol.** It is not a
   protocol feature. It is one (or many) well-resourced peers that discover, replicate, read, and
   index public Drives through the exact same `nomad.fs` read surface a Reader uses
   (`shared/fs-manifest.mjs`). It holds no privileged position — only more data. Any second indexer
   can do everything the first can.

2. **Discovery is opt-in, via a well-known announce topic.** Define a topic derived from a *public
   constant*, not from any Drive key:

   ```
   INDEX_TOPIC = hash('walled.garden/index/v1')   // same 32 bytes for everyone, forever
   ```

   Because it is derived from a constant, *anyone* can compute it without holding any Drive key, so it
   is a shared public rendezvous. A Drive that wants to be findable joins it **in addition to** its
   own discovery key:

   ```
   configureNetwork(INDEX_TOPIC, { announce: true, lookup: false })   // "list me publicly"
   ```

   A crawler joins the mirror image:

   ```
   configureNetwork(INDEX_TOPIC, { announce: false, lookup: true })   // "show me the listed Drives"
   ```

   Discovery goes from *impossible to enumerate* to *one swarm join*. This is the decentralized
   equivalent of submitting a sitemap: opt-in, and no server owns the namespace — it is just a hash
   everyone agrees on.

3. **The topic is an intake funnel, not a content channel — a one-message handshake carries the
   key.** Announcing a Drive's *own* discovery key makes the connection replicate *that* Drive (topic
   and content are the same object). `INDEX_TOPIC` is derived from a constant, so it is tied to no
   Drive; the connection it produces yields a peer, not a key. The announcing side therefore sends its
   key(s) on connect, and the crawler then opens each Drive the normal way and **drops the rendezvous
   connection**:

   ```
   // announcing Drive, per incoming INDEX_TOPIC connection:
   socket.write(encode({ type: 'walled.garden/listing', driveKey, feedType: 'walled.garden/feed' }))
   // crawler:
   socket.on('data', m => { frontier.add(decode(m).driveKey); socket.end() })
   ```

   The well-known topic carries *introductions*; each Drive's own discovery key carries *content*.
   Once the crawler has a key it tracks that Drive via its own topic + `nomad.fs` sparse replication +
   `watch()`, exactly like the Reader.

4. **Opt-in is the whole privacy story, and it keeps ADR-0013 intact.** Joining `INDEX_TOPIC` is an
   explicit "list this Drive publicly." A Drive that does not join it is exactly as unfindable as
   today. Only the *Drive* is ever advertised — never who follows it — so no follower list is created
   or exposed. The engine also honors the protocol's existing content signals: it skips
   `draft: true` Posts (ADR-0009's "obscure, not private" is a contract a well-behaved indexer keeps),
   and respects a lightweight opt-out (a `walled.garden/robots` marker / `indexable: false` in
   `/index.json`) — see follow-ups.

5. **The namespace is versioned.** `/v1` lets the rendezvous migrate (new handshake, spam
   mitigations, richer listing record) by minting `walled.garden/index/v2` without disturbing any
   Drive's own discovery key or the v1 funnel. A `walled.garden/listing` schema (§ADR-0005 process)
   would formalize the handshake payload if/when this is built.

6. **Serving can be conventional first, P2P-native later.** v1: the super-peer builds a plain inverted
   index and exposes an HTTP/JSON search API — the index is central even though the *content* stays
   P2P (a torrent-search-site stance). Endgame: publish the inverted index itself as a **Hyperbee**
   (append-only B-tree over a Hypercore), announced as a public core, so any client queries it by
   *sparsely replicating only the blocks a term lookup touches* — no full download, and the index has
   no privileged host. Ship the central API first; treat the Hyperbee index as the step that removes
   the central point.

## Considered options (rejected)

- **A shared open-write catalog core (one Autobase/Hyperbee registry everyone appends their key to).**
  The crawler would just read one log. Rejected as the *primary* mechanism: an open-write append log
  is a spam magnet and a governance problem (who gates writers?), and it recreates a single shared
  object that must be hosted and defended — i.e. a central registry wearing a P2P costume. The
  announce topic keeps the funnel *connectionless and ownerless*. (A curated catalog core is fine as
  an *optional seed source* layered on top — see follow-ups.)
- **Passive DHT enumeration.** You cannot list "all topics" on a Kademlia DHT, and attempting to scan
  it is neither feasible nor legitimate. Discovery must be advertised by the Drive, not extracted from
  the network.
- **A classic central registry server (submit-your-URL web form → DB).** Works, but hands one operator
  the namespace and makes the engine a gatekeeper rather than a peer. Rejected as the *design*; an
  operator is free to *also* run a submission form that simply joins `INDEX_TOPIC` on the Drive's
  behalf.
- **Crawling the social graph for keys (harvest follows to expand the frontier).** Forbidden by
  ADR-0013: `walled.garden/follows` lives in `hyper://private/`, is never announced, and is
  outbound-only precisely so it cannot be aggregated. The crawlable graph is only what public Drives
  *choose* to link (`index.json.author.url` → Profile Drive, inter-post `hyper://` links, an opt-in
  public blogroll) — never follows.
- **Status quo (per-Drive discovery keys only).** This *is* the privacy default; it is simply
  insufficient for discovery. This ADR adds a second, opt-in topic beside it rather than weakening it.

## Consequences

- **A recorded direction, not a commitment.** No code, schema, or wire-format change lands with this
  ADR. It exists so a future contributor builds search as an opt-in aggregation layer and does not
  reach for a central registry or, worse, try to crawl follows.
- **Two topics per listed Drive.** A publicly-listed Drive announces on both its own discovery key
  (content) and `INDEX_TOPIC` (intake). The publish flow gains exactly one `configureNetwork` call;
  everything downstream (crawl/index/rank/serve) is additive.
- **Reach, not trust.** The open funnel invites junk keys. The topic gets the crawler *reach*; every
  downstream stage (feed detection, `robots`/`draft` honoring, ranking, denylist-by-Drive-key) still
  decides what is worth indexing. Note that "delisting" only removes a Drive from an index — the Drive
  and its bytes still replicate to anyone holding the key; this is a listing layer, never deletion.
- **Ranking in a linkless world.** With follows off-limits, the opt-in link graph (author URLs,
  blogrolls, inter-post links) is the only PageRank substrate; freshness (Autobase update times) is a
  weak secondary. Any indexer starts sparse and grows with the graph Drives volunteer.
- **Consistent with ADR-0013's framing.** There, privacy comes from a list *not existing*; here,
  discoverability comes from a Drive *choosing to appear* on a public bulletin board. Discovery keys
  are private mailboxes (you must know the address); the announce topic is a public noticeboard
  (anyone may read it, posting is voluntary). Nomad has always had the first; search needs the second,
  opt-in, beside it.

## Follow-ups (deferred, each its own ADR/spec if picked up)

- A `walled.garden/listing` schema for the intake handshake payload, and a `walled.garden/robots`
  (or `index.json` `indexable: false`) opt-out convention.
- The crawler super-peer as a concrete headless module (swarm-join `INDEX_TOPIC` → intake keys →
  `nomad.fs` feed walk + `watch()` → inverted index).
- Identity folding: resolve `index.json.author.url` → Profile Drive → `writer-keys.json` so a person's
  multiple Device content-drives index as one author.
- The Hyperbee-as-public-index serving layer (§Decision 6), including term-prefix sharding across
  multiple cores/peers.
- Abuse/moderation: denylist-by-Drive-key, and the limits of delisting vs. deletion.
