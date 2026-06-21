# Multi-Device Protocol (Vault + Pairing)

Canonical spec shared by **nomad** (desktop/Electron) and **mobile** (`~/maintained/mobile`, Bare/RN).
Both apps must implement these formats identically or replication fails with
`DECODING_ERROR: Unknown wire type`. See ADR-0006 (the Vault) and ADR-0007 (Profile aggregation).

## 1. The Vault

The **Vault** is an Autobase, using the *exact same* shape as every Collaborative Drive in both
repos (see `nomad/app/bg/hyper/autobases.js` `_openFn`/`_applyFn` and
`mobile/backend/lib/drive-manager.mjs` `openAutobaseDrive`):

- View: a single Hyperbee — `store.get({ name: 'db' })`, `keyEncoding: 'utf-8'`, `valueEncoding: 'binary'`.
- `valueEncoding: 'json'` on the Autobase, `ackInterval: 1000`.
- Op shapes appended to the base (already handled by both `apply` functions):
  - `{ op: 'put', path, data, encoding? }` — `encoding: 'base64'` for binary, else utf-8 string.
  - `{ op: 'del', path }`
  - `{ addWriter, profileUrl? }` — calls `host.addWriter(key, { indexer: true })` and writes
    `/.data/walled.garden/writers/<hexKey>.json`.
  - `{ removeWriter }` — calls `host.removeWriter(key)` and deletes that writers file.

The Vault is **not** a Space and is never browsed as a site. It is the private root of one user's
identity. Every one of the user's Devices is a Writer of the Vault.

### 1.1 Vault records (entries in the Hyperbee view)

Written via ordinary `{ op: 'put' }` ops so both `apply` functions persist them unchanged:

| Path | Value (JSON) |
|------|--------------|
| `/.vault/meta.json` | `{ version: 1, createdAt, profileUrl? }` |
| `/.vault/spaces/<rootDriveKey>.json` | `{ rootDriveKey, name, icon, color, sortOrder, originId?, createdAt }` |
| `/.vault/devices/<hexDeviceKey>.json` | `{ key, name, platform: 'desktop'\|'mobile', addedAt, lastSeen? }` |

Space records are keyed by `rootDriveKey` (the hex key of the now-Autobase-backed Root Drive), which
is globally stable — **not** by the local space id, which is a per-Device autoincrement and would
collide/diverge across Devices (`originId` is a non-authoritative hint only). A newly-paired Device
reads `/.vault/spaces/*` to discover every Space and the drives to replicate. Device records exist
for human-readable names/management; the Vault's own writer set (autobase oplog) remains the
security boundary.

## 2. Pairing (blind-pairing)

Uses Holepunch [`blind-pairing`](https://github.com/holepunchto/blind-pairing-core) over the existing
Hyperswarm instance in each app. Roles: the **member** (an existing trusted Device) invites; the
**candidate** (the new Device) joins.

1. **Invite (member).** `BlindPairing.createInvite(vault.key)` → `{ id, invite, publicKey }`.
   The user-facing **invite code** is `z32.encode(invite)`. Shown as text + QR. Single-use by default.
   The member keeps `publicKey` (keyed by invite `id`) to `candidate.open()` incoming requests.
2. **Request (candidate).** The candidate first mints its local writer key **without** the Vault via
   `Autobase.getLocalCore(store)` → `core.key` (autopass pattern). It then decodes the code and calls
   `addCandidate({ invite, userData })` where `userData` is **JSON** (UTF-8 bytes) of
   `{ key, name, platform }` — `key` is the hex local writer key. (Both repos use JSON, not cenc,
   so the encodings match.)
3. **Approval (member).** The member's `onadd` surfaces the candidate `userData` as a **pending
   request** (never auto-accepted — see ADR/grill decision Q8). On user approval the member:
   a. appends `{ addWriter: deviceKey }` to the Vault,
   b. appends `{ op: 'put', path: '/.vault/devices/<deviceKey>.json', data }`,
   c. runs **writer fan-out** (§3),
   d. confirms pairing so the candidate receives the Vault key.
4. The candidate persists the Vault key, replicates the Vault, then replicates and writes each Space
   drive listed in `/.vault/spaces/*`.

### 2.1 Invite code format
`z32`-encoded `blind-pairing` invite blob. `z32` is already a dep in mobile; added to nomad in Phase 0.

## 3. Writer fan-out

When a Device is added, its `deviceKey` must become a Writer of the Vault **and of every Space Root
Drive** indexed in the Vault. For each `rootDriveKey` in `/.vault/spaces/*`, append
`{ addWriter: deviceKey }` to that drive's Autobase. New Spaces created later append the same for all
known Devices at creation time.

## 4. Profile Drives — aggregation, not Autobase (ADR-0007)

Profile Drives keep their original single-writer `hyper://` URL (it is the social-graph anchor).
Multi-writer is achieved by aggregation over **per-device content drives**:

- Each non-origin Device owns its own profile content drive (a plain Hyperdrive, key persisted as
  the `profile_content_key` setting). It advertises that key during pairing in
  `userData.profileContentKey`; the canonical owner stores it in the Device's Vault record.
- The canonical Profile Drive (single-writer, owned by the origin Device) publishes
  `/.data/walled.garden/writer-keys.json`: `{ type: 'walled.garden/writer-keys', keys: [...] }`,
  listing every Device's content-drive key. Only the canonical owner writes this file (others no-op);
  it is regenerated from the Vault device records on add/remove (`vault.syncWriterKeys`). Schema:
  `nomad/app/lib/schemas/walled.garden/writer-keys.js`.
- **Readers** (drive-template apps in userland) aggregate one identity by reading the canonical
  Profile Drive PLUS every drive key in `writer-keys.json`, merging posts (which carry
  `author.writerKey`). The origin Device's posts live in the canonical drive itself, so it needs no
  entry. Trust flows from the canonical profile's `writer-keys.json`.

## 5. User data in the Space Root Drive (bookmarks, contacts, history)

A Space's Root Drive holds the user data for that Space, so it syncs across Devices via replication.
Because Root Drives are now **Autobase** (Hyperbee view, **no file metadata**), data must live in file
**bodies**, not Hyperdrive metadata.

- **Bookmarks** — `/bookmarks/<slug>.json`, body `{ type: 'beaker/bookmark', href, title, createdAt }`.
  The `slug` only needs to be unique+stable (mobile uses `hash(href)` hex); lookups/dedup are by
  `href`, so Devices don't need an identical slug algorithm. (Legacy nomad used empty `/bookmarks/*.goto`
  files with `{href,title}` in Hyperdrive metadata — that format does NOT round-trip on an Autobase
  Root Drive, so desktop must move to the JSON-body format too. Read both during transition.)
- **Contacts** — entries in the Drive Registry `/drives.json` tagged `["contact"]` (already JSON, so it
  syncs as-is). Read = registry entries whose `tags` include `contact`.
- **History** — device-local SQLite in nomad (`visits` table, `spaceId`-scoped); **not synced**. Mobile
  keeps per-Device local history too. Syncing it would be a deliberate divergence.

## 6. Version parity

`autobase`, `hyperbee`, `corestore`, `hyperswarm`, and now `blind-pairing` must match across both
repos (`hypercore`/`hyperdrive` majors already differ and that is fine). Current pins:
`blind-pairing ^2.3.1`, `z32 ^1.1.0`, `hyperdht ^6.x` (transitive via `hyperswarm ^4.x`).
