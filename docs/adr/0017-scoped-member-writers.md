# Scoped member writers: let strangers write to a Drive without trusting them

**Status: Proposed.** Drafted 2026-10-09. Nothing here is built. This ADR changes the Autobase
reducer, so it is a **wire-format change** (`FS_FORMAT_VERSION 1 → 2`). It addresses gap 1 in
knownasilya/nomad#43: a site where anonymous visitors write into one shared place (comments,
guestbooks, forums, polls, wikis where each contributor owns their part).

## The problem: every writer is fully trusted

A Drive's writer set is its security boundary (CONTEXT.md → *Writer*). Today that boundary has only
one level of trust:

- `apply()` in `shared/fs-core.mjs` adds every writer with `{ indexer: true }`. Every writer takes
  part in agreeing the order of writes and signing it.
- `apply()` accepts a `put` / `del` on **any** path from **any** writer, including `index.json`,
  other writers' files, and `addWriter` / `removeWriter`.

So making someone a writer means giving them full control of the site. That is fine for one person's
devices or a small trusted team. It rules out letting the public in.

Making many strangers **indexers** also breaks liveness. A Drive's view only moves forward when
enough indexers are online to agree (see the quorum note in `mobile/backend/lib/vault.mjs`). With
hundreds of mostly offline indexers, nothing would ever be confirmed.

The workaround today is subscriber-side aggregation (ADR-0008, ADR-0013): each visitor writes to
their own Drive and each reader pulls together the Drives they follow. That works for blogs, but it
can't give a site one authoritative list of comments, because nobody's view includes people they
haven't found.

## Decision

Add a second, limited role of writer, a **member**, that the reducer itself confines.

1. **Two roles: `owner` and `member`.** The `addWriter` op gains an optional `role` field:
   `{ addWriter, role?: 'owner' | 'member', profileUrl? }`. When `role` is missing it means
   `owner`, so every existing op replays exactly as before.
   - An **owner** is today's writer. It is added with `indexer: true`, and its ops are not
     restricted.
   - A **member** is added with `indexer: false`. It can append ops, but it takes no part in
     ordering or signing. Its writes become final once the owners' indexers confirm them.

2. **The reducer limits each member to its own area.** For each node, `apply()` looks up the
   role of the writer that wrote it (from the node's writer key and the writer-record under
   `WRITERS_PREFIX`, which already lives in the view). For a member:
   - A `put` / `del` is applied **only** when `path` starts with `/members/<writerKeyHex>/`.
   - A `put` is applied only when `blob.core` is that member's own blobs core, or there is no blob.
   - `addWriter` / `removeWriter` from a member are ignored.
   - Anything else is skipped silently: no view change and no error.

   Each skip depends only on the op and the view, so every peer skips the same ops and the views
   stay identical. This is what makes the limit hold: a member who edits their own Nomad to ignore
   the rule only changes their own view, and no other peer accepts it.

3. **One fixed area per member in v1.** There are no shared paths a member can write and no rules
   declared in `index.json`. One fixed prefix keeps the reducer small and easy to check. A later ADR
   can add rules from the manifest (for example "members may create files under `/comments/`, but
   only new ones") if real sites need them.

4. **Getting in is still an owner's decision.** Autobase only accepts `addWriter` from an existing
   writer, so some owner device has to append the member's `addWriter`. This ADR doesn't choose a
   policy. It adds the mechanism that lets an owner device approve automatically:
   - `nomad.fs.approveRequest(url, writerKey, { role: 'member' })`, plus an `index.json` setting
     (for example `"members": { "join": "auto" }`) that tells an online owner device to approve
     member requests with no prompt, rate-limited for each requester.
   - `join: "manual"` (the default) keeps today's prompt.
   - So an open site needs at least one owner device online to let people in and to confirm their
     writes. That is the "always-on writer" from the #43 discussion, and it also keeps the site
     seeded.

5. **Moderation stays with owners.** Owners are unrestricted, so an owner can `del` anything under
   `/members/<key>/` or `removeWriter` a member. Removing a member stops their future writes; the
   cleanup of past ones is a separate, explicit delete. A hide-list convention
   (`/.data/walled.garden/moderation.json`) that readers honour is cheaper and can be undone, and
   templates can use it without any protocol change.

6. **Pages read members through `nomad.fs`.** Nothing new is needed for reading: a comments
   widget lists `/members/*/comments/…` and merges it. A small helper would be convenient, for
   example `nomad.fs.listMembers(url)` that returns writer-records with `role`. If it is added, it
   goes in `shared/fs-manifest.mjs` with the usual sync triad (docs, `API_REFERENCE`,
   `nomad-dts.js`).

## Wire-format consequences

- **`FS_FORMAT_VERSION` → 2.** A version 1 peer would apply member ops without the limit and its
  view would differ from a version 2 peer's (`DECODING_ERROR` or a signature mismatch). Both
  runtimes have to ship the new reducer together, with identical dependency pins, and the golden
  vector in `tests/unit/fs-core-golden.test.js` has to be regenerated.
- **Existing Drives replay the same way.** A log with no `role` fields only contains owners, and
  the owner path through `apply()` is unchanged. So a version 1 log gives the same view under
  version 2. The golden test should check this explicitly: run the old vector through the new
  reducer and expect the same bytes.
- **Writer-records grow a `role` field**, written in a fixed key order
  (`{ writerKey, role, profileUrl }`) like the existing record.
- The reducer stays pure and safe to replay: the role lookup reads the view, which Autobase rebuilds
  the same way on every reorder.

## To check before accepting

- **How the reducer finds the author.** Confirm that the pinned `autobase@^7.28` gives `apply()`
  each node's writer key (`node.from.key`), and that non-indexer writers behave as expected:
  their writes become final once an indexer confirms them.
- **The order of joining and first writes.** A member's first writes can be ordered before the
  member's own `addWriter`. The reducer then sees an unknown writer and must skip those writes the
  same way on every peer. The joining flow has to wait until its `addWriter` is in the view before
  it writes.
- **Growth.** Every member adds a core to replicate and a writer-record to the view. We need
  numbers for 1,000+ members on desktop and mobile before calling this fit for a busy forum.
- **Mobile.** Mobile rejects writer-management calls today (`NOMAD_UNSUPPORTED_METHODS`). A mobile
  visitor needs at least `requestAccess` to join as a member, and their writes have to reach the
  owner's view.

## What this deliberately does not solve

- **Spam and fake identities.** Keys cost nothing to make. Rate limits on auto-approval and
  removal by owners help, but a determined attacker can keep making identities. Proof of work or
  invite-only joining can come later.
- **Exclusive claims** (gap 4 in #43). A reducer rule such as "the first claim in the agreed order
  wins" is possible on top of this, but it only becomes final when indexers confirm it, so it is
  not instant.
- **Secrets and server-side logic** (gap 2). Members are limited in what they write, not trusted
  more.

## Consequences

- Open-participation sites (comments, guestbooks, forums, polls, wikis where each contributor owns
  a part) become possible in one Drive with one authoritative view, without a central server.
- Trust has two levels. Owners keep the full power they have today. Members get an area that the
  reducer confines and every peer enforces.
- The cost is a wire-format bump and an owner device that stays online to let people in and confirm
  their writes.
