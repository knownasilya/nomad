# Followers are subscriber-side — no aggregate follower list

**Status: Accepted.** Designed 2026-07-04. Records a privacy invariant that is already true by
construction but was never written down: **who follows a user is not exposed, because no follower
list exists.** A Follow is the follower writing the target's URL into *their own* private Root Drive
(`walled.garden/follows`); the target Drive learns nothing. This ADR makes that a deliberate,
defended decision rather than an accident of the current code, and scopes what "not exposed" does
and does not cover. See CONTEXT.md → *Follow* for the term.

## The property, and why it's easy to lose

Following in Nomad is the RSS/subscriber model: the **Reader** stores a `walled.garden/follows`
record (`{ type, urls: [...] }`) in the user's private Root Drive at
`/.data/walled.garden/follows.json`, and aggregates each listed Feed. That record is **outbound** —
the Drives *I* follow — and it lives in `hyper://private/`, which is never published to the swarm
(see the Private Drive: *"Not published to the public network"*). A Profile Drive or Blog is a
public, readable Drive that **anyone with the URL can read but nobody can enumerate the readers of**:
the follow relationship is distributed across every follower's private Root Drive and aggregated
nowhere. There is nothing to leak because no list is ever assembled.

The property is fragile in exactly one way: the obvious "show my follower count / followers"
product feature is the act of building the aggregate list you were getting privacy from *not*
having. The symmetric-looking `walled.garden/follows` schema reads like an invitation to add a
`followers` record on the target side. That is the mistake this ADR exists to forbid.

## Decision

1. **Following is subscriber-side, and stays that way.** A Follow is a URL appended to the
   follower's own `walled.garden/follows` in their private Root Drive. The target Drive is not
   written to, notified, or otherwise made aware. The Reader is the only thing that reads a
   `follows` record, and only ever its owner's own.

2. **There is deliberately no aggregate follower/subscriber list.** No `walled.garden/followers`
   record, no published subscriber count, no follow-registry on the target Drive. `walled.garden/
   follows` is **outbound-only** by design; a target-side symmetric record is rejected (below), not
   merely unbuilt.

3. **The invariant is a property of Drives, not of the Profile/Feed templates.** Any public
   readable Drive has the same un-enumerability at the data layer. A custom Drive with a custom
   schema gets the same privacy for free; only *rendering/aggregation* is template-specific (the
   built-in Reader only understands `walled.garden/feed` + `/posts/`, so a custom convention needs
   its own reader app). The privacy is not something the Profile template provides — it is the P2P
   default the template inherits.

4. **Scope of "not exposed" — three layers, only the first two are in scope.**
   - **Data layer (in scope, guaranteed):** no follower list exists on any Drive; follows live in
     the follower's private Root Drive. Un-enumerable by construction.
   - **Network layer (in scope, mitigated not eliminated):** replicating a Drive announces the peer
     on that Drive's DHT discovery topic, which is derived from the *public* Drive key — so a third
     party who holds the Drive URL can enumerate *connections* on that topic (by IP), independent of
     Drive type. Mitigation: the Reader joins a followed Feed's topic **client-only**
     (`{ server: false, client: true }`) so a follower looks up peers without announcing as a
     server. This narrows third-party enumerability; it does not remove it.
   - **Host layer (out of scope):** a follower must replicate from *some* peer holding the data; if
     the target is the only seeder, the target always sees the follower's connection. Hiding
     followers from the *host* (anonymous readership) requires a neutral relay/seeder and is a
     separate, larger design — explicitly deferred.

5. **`nomad.capabilities` is not the mechanism.** Capability URLs are local, in-memory, and
   non-networked (they *"cannot be shared with other users"*); they hide a pubkey between apps on
   one machine, not a follow relationship across the network. Named here so future work doesn't
   reach for them.

## Considered options (rejected)

- **A published `followers` list / subscriber count on the target Drive.** The straightforward
  social feature, and the direct negation of the invariant: it *is* the aggregate list. Rejected.
  If a follower count is ever a hard product requirement, it does not come from a public list — see
  the follow-inbox below.
- **Encrypted follow-inbox (private-to-target registry).** Followers send a follow-record encrypted
  to the target's public key over a mailbox topic derived from the target key (the `autopass`/
  mailbox pattern), giving the target — and only the target — a decryptable follower list/count.
  This is the *only* way to get "I know my followers" without a public list, but it is **new
  machinery** (a new bg module + a `walled.garden/follow-request` schema + a `nomad.fs` surface),
  and it weakens the guarantee (the target now holds follower identities; a compromised Device
  leaks them). Deferred; not built. Revisit only when a concrete feature (count, push) forces it,
  and treat it as its own ADR.
- **Follows stored anywhere public** (e.g. in the Profile Drive so they sync without the Vault).
  Rejected — publishing the outbound list is a different leak (it exposes who *I* follow) and
  defeats the point. Follows stay in the private Root Drive, which already syncs across the user's
  Devices via the Vault.

## Consequences

- **An implicit invariant becomes explicit and defended.** The `walled.garden/follows` schema doc
  and Profile Drive doc now state the outbound-only/no-followers-list rule so a future contributor
  can't "helpfully" add a followers list without contradicting a recorded decision.
- **The swarm-layer caveat is real and documented.** "Followers aren't exposed" is a data-layer and
  (mitigated) network-layer claim, never a host-layer one. Anyone reasoning about follower privacy
  must carry the DHT-topic-enumeration limit; the client-only join is a mitigation, not a proof.
- **No new schema, API, or wire-format change.** This ADR ratifies current behaviour. The only code
  touchpoint it *invites* (not requires) is making the Reader's swarm-join for followed Feeds
  client-only, if not already.
- **Consistent with ADR-0009's framing.** A `draft: true` Post is *"obscure, not private"* because
  its bytes still replicate; here the mirror truth holds — a follow is *private by absence*, because
  the relationship is never written to a replicated Drive at all. The privacy comes from the list
  not existing, not from hiding an existing list.
