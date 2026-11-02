# An always-on Peer: a machine the user runs that keeps their drives, Vault and Inbox reachable

**Status: Proposed.** 2026-11-02. Builds on ADR-0006 (the Vault), ADR-0010 (one `nomad.fs` over
Autobase drives), ADR-0013 (followers are subscriber-side), ADR-0029 (Shared Spaces) and ADR-0036
(Persona Inbox, which left "a relay for offline delivery" to its own ADR). Three spikes (below) must
pass before *Accepted*.

Everything a Nomad user publishes or syncs is served only by their own Devices. When the laptop
sleeps and the phone is in a pocket, their blog, their Profile Drive and (once ADR-0036 lands) their
Inbox are gone from the network, and two of their own Devices that are never online together never
sync. This ADR adds a **Peer**: a headless Nomad the user runs on a machine that stays on (a home
server, a NAS, a Raspberry Pi, a small VPS). It holds a full copy of what the user chooses, serves it
to anyone who may read it, and passes data between the user's Devices. It never writes, never runs
the AI, and holds no secrets.

## Where things are today

- **Hosting is a full mirror only for Hyperdrives.** `ensureHosting` (`app/bg/hyper/drives.js`)
  announces and downloads a drive in full, and re-downloads on every append. `bg/filesystem/index.js`
  calls it only for `/drives.json` entries whose `type !== 'autobase'`. Autobase drives (every drive
  made since ADR-0010, the Vault, Space Libraries, Profile Drives) join the swarm when they are loaded
  (`_joinSwarm` in `autobases.js`) and replicate sparsely. Nothing downloads their writer and blobs
  cores in full, so a peer that syncs from a Device can find blobs missing.
- **Desktop can already stay up.** The tray's "Run in background" (`run_background`,
  `bg/ui/tray-icon.js`) keeps the hyper stack running after the last window closes. A laptop still
  sleeps, so this is a partial answer.
- **The phone can't.** ADR-0036 spike S2 exists because a phone's backend is suspended soon after
  the app leaves the screen.
- **No part of the Vault is encrypted.** `AUTOBASE_OPTS` (`shared/fs-core.mjs`) passes no
  `encryptionKey`, so whoever holds the Vault key and connects can read every record. Anything that
  replicates the Vault can read it.
- **The phone's backend runs without Electron.** `mobile/backend/` is plain Bare JavaScript:
  `lib/drive-manager.mjs` opens both drive backends, `lib/vault.mjs` pairs and reads the Vault, and
  both share `shared/fs-core.mjs` with desktop byte for byte (`tests/unit/fs-core-golden.test.js`).
- **Pairing already exists.** `blind-pairing` (`docs/multi-device-protocol.md` §2) adds a Device to
  the Vault. The member appends `addWriter`, writes `/.vault/devices/<key>.json`, and runs writer
  fan-out (§3).

## Decision

### 1. Words

- A **Peer** is a running Nomad with no windows and no user. The user owns it. It is not a Device:
  it doesn't write the Vault, it is no drive's Writer, it has no tabs, it runs no Jobs, and it never
  appears where the UI lists Devices for those purposes.
- An **Own Peer** is a Peer the user paired with their Vault. It reads what it holds (§3).
- A **Blind Peer** is a Peer someone else runs, such as a friend or a hosting service. It holds only
  what is public anyway, or what it can't read (§4).
- A Peer's **Holdings** are the drives and records the Vault says it should keep (§5).

### 2. One program, built on the phone's backend

The Peer is a new package in this repo, `peer/`, run with `npx nomad-peer` or a container image. It
starts from `mobile/backend/lib/` (`drive-manager.mjs`, `vault.mjs`, `space-library.mjs`) and
`shared/`. It does not start from desktop's `app/bg/`, because that code expects Electron (`app`,
`safeStorage`, `BrowserWindow`) and its settings databases. Building on the phone's backend keeps
one copy of the Autobase wire format and identical dependency pins (the `fs-core` golden guards it),
and the Peer runs where Bare or Node runs.

```
peer/
  index.mjs        CLI: join <invite-code> | run | status | leave
  holdings.mjs     reads the Vault, decides what to hold (rules in shared/peers.mjs)
  mirror.mjs       full download of a drive of either backend, kept up to date
  channel.mjs      the nomad/peer Protomux channel (§6)
shared/peers.mjs   records, defaults, what each kind of Peer may hold (tests: tests/unit/peers.test.js)
```

A desktop Nomad with "Run in background" on can also act as an Own Peer for the user's other Devices
(the "Keep everything" switch, §5). It runs the same holdings rules through `bg/hyper/drives.js`.
This is the zero-install form. It helps a desktop that stays on, and does nothing for a laptop.

### 3. An Own Peer joins like a Device and never becomes a Writer

Settings → Devices → **Add an always-on Peer** shows a `blind-pairing` invite code (§2 of the
protocol doc), the same kind a phone scans. On the Peer the user runs `nomad-peer join <code>`.

- The candidate's `userData` is `{ key, name, platform: 'peer' }`. On approval the member **skips**
  `addWriter` and writer fan-out. It writes `/.vault/peers/<peerKey>.json` (§5) instead of a
  `/.vault/devices/` record, then confirms the pairing so the Peer gets the Vault key.
- The Peer opens the Vault as a reader. It replicates every writer core, follows `/.vault/spaces/*`,
  `/.vault/personas/*` and the Space Library records, and opens each drive it must hold the same way.
- **It can read everything it holds.** It has the Vault key, and the Vault is not encrypted, so an
  Own Peer is as trusted with data as a Device. It is less trusted with power: it can't change a
  record, publish, approve a writer, or act as the user anywhere. The pairing screen says so in those
  words, and recommends disk encryption on the Peer's machine.
- **It never holds** Secrets (ADR-0033: they never leave the computer that made them), AI Runtime
  settings, or anything in a Device's local databases. None of those are in the Vault, so this needs
  no filter. The rule is written down so that nothing later moves them in.
- **Removing it** deletes `/.vault/peers/<peerKey>.json`. The Peer sees the delete, stops serving and
  wipes its store. A Peer that is stolen or keeps running can't be made to forget what it already
  copied. The Devices screen says so. Rotating the Vault key is a separate, larger decision (Still
  open).

### 4. A Blind Peer holds only what it may hold

A Blind Peer is paired per drive, not with the Vault. In the first version it holds **public drives
only**: published drives, Profile Drives and feeds the user marked to keep online. Their content is
public anyway, so the Blind Peer learns only which drives the user asked it to keep, plus its own
logs.

- The candidate is Holepunch's `blind-peer` (a server that keeps Hypercores it is given online) and
  its client `blind-peering`, if spike S2 shows they fit. Otherwise the Peer program runs in a
  `--blind` mode that accepts a list of drive keys from a Device, signed by a Vault Writer.
- **The Vault, Root Drives and Space Libraries never go to a Blind Peer** until those cores are
  encrypted. That needs a migration of the Vault and a new `FS_FORMAT_VERSION` (Still open). The rule
  in `shared/peers.mjs` refuses them by key type, so a later bug in the UI can't send them.
- **Inbox frames can go to a Blind Peer** (§7), because they are sealed to the Persona's `box` key and
  a Blind Peer never gets that key.

### 5. The Vault says what each Peer holds

```
/.vault/peers/<peerKey>.json
  { type: 'nomad/peer', key, name, kind: 'own' | 'blind', addedAt, addedBy,
    hold: { vault: true, spaces: 'all' | [rootDriveKey…], drives: 'all' | 'public' | [driveKey…],
            profiles: true, inboxes: [personaId…] } }
```

Defaults (`shared/peers.mjs` `defaultHold(kind)`):

| Holds | Own Peer | Blind Peer |
|---|---|---|
| The Vault | yes | never (until encrypted) |
| Every Space's Root Drive and Space Library | yes | never (until encrypted) |
| Every drive in each Space's Drive Registry | yes (`'all'`) | only ones marked public |
| Profile Drives of every Persona | yes | yes |
| Inbox store-and-forward | every Persona with an Inbox | only the Personas the user ticks |

"Hold" means a **full mirror**: every core of the drive (the Hyperdrive core and its blobs core, or an
Autobase's system core, every writer core, every writer's blobs core and the view), downloaded in
full and kept current. The Peer re-reads Holdings on every Vault update, so adding a drive on any
Device puts it on the Peer within one sync. That also closes the gap above: `mirror.mjs` is the first
full mirror of an Autobase drive, and desktop's `ensureHosting` gets the same pass for Autobase
entries.

Any Device can change a Peer's `hold`. The UI is a Peer row in Settings → Devices (desktop) and in
Devices (phone). It shows a "Keep online" switch per Space and per drive, Online or Offline, when it
was last seen, and how much it holds (from §6).

### 6. The `nomad/peer` channel: status, never commands that write

A Protomux channel on the shared swarm connection, opened only between a Peer and a Vault Writer.
Each side proves itself on open, the way the AI Bridge does (ADR-0013): the Device signs with its
Vault Writer key, and the Peer signs with the key its `/.vault/peers/` record names. It carries:

- `STATUS` from the Peer: version, uptime, free disk, bytes held, and per drive the length it has
  against the length it has heard of. Devices show this. It is not stored in the Vault, because a
  Peer can't write the Vault.
- `SYNC_NOW` from a Device: re-read Holdings and re-check every mirror. It takes no arguments, so a
  Device that has been compromised can't use it for anything but making the Peer do work.

No message on this channel can change data, run code or read anything a Device couldn't already read.

### 7. The Persona Inbox: store and forward

This settles ADR-0036's first open item. A Peer that holds an Inbox announces that Persona's
`mailbox` key on the DHT, next to the user's Devices (ADR-0036 spike S1 decides whether several
servers on one key work, or each gets its own derived key in the published list).

- The Peer accepts a sealed frame, checks only what ADR-0036 §4 lets a non-recipient check (size,
  rate per sender address, the proof of work if that mode is on), stores it, and acks.
- A Device of the user collects frames from the Peer over `nomad/peer` (`FRAMES` / `FRAMES_ACK`),
  opens them with the `box` key, and writes Messages to the Vault as ADR-0036 describes. The Peer
  deletes a frame once a Device has acked it, or after 30 days.
- **A Peer gets only the derived `mailbox` key pair, never the inbox seed or the `box` key.** A
  Device that writes `inboxes` into a `nomad/peer` record sends the Peer that one key pair over
  `nomad/peer` (`MAILBOX_KEY`). For a Blind Peer that is the whole point. For an Own Peer it is
  defence in depth only, because an Own Peer can read the seed in the Vault anyway (§3), and the UI
  says so.
- This fixes both-sides-offline. With the Peer on a VPS, it also stops a sender learning the user's
  home address: the sender's connection lands on the Peer.

### 8. What the network learns

- A Peer announces the discovery key of every drive it holds. Someone with a drive's URL sees the
  Peer's address on that topic, not the user's Devices', when the Devices are offline. ADR-0013's
  host layer (a follower always connects to *some* holder) still applies. The holder can now be a
  machine on a VPS instead of the user's home connection.
- A Blind Peer's operator learns which public drives and which mailbox keys it holds, how big they
  are, and when the user's Devices connect to collect. It learns no content of the Vault or of
  messages.
- An Own Peer on a VPS puts the user's whole Vault on a disk the user doesn't physically control. The
  pairing screen says that in one sentence, and suggests a machine at home when the user can.

### 9. Updates

The Peer is a package, so the user updates it with `npm` or a new image. It reports its version in
`STATUS`. Devices show "Update the Peer" when its `FS_FORMAT_VERSION` or `shared/peers.mjs` version
is older than theirs, and a Peer that sees a newer format than it knows stops holding that drive
rather than serving a view it can't decode. ADR-0031's update-from-the-phone flow is not extended to
Peers in this version.

## Considered options

- **A Nomad-run hosting service as the default.** It is the easiest thing for the user and it would
  put one company in the middle of every user's data and messages. Rejected as the default. A Blind
  Peer lets anyone, Nomad included, run one, and holds only public or sealed data.
- **Desktop in the background only.** Cheapest, and kept as §2's zero-install form. Laptops sleep, so
  it can't be the answer for most people.
- **The Peer as a full Vault Writer (a Device that is always on).** It would let the Peer apply its
  own records, such as status. A stolen Peer could then rewrite or delete the user's records and
  approve writers. Rejected: a Peer must be able to lose your data's privacy at worst, never its
  integrity.
- **Start from desktop's `app/bg/`.** It is the most complete backend, and it is tied to Electron.
  Rejected for §2's reasons. The phone's backend already runs without a UI.
- **Pinning to IPFS or another network.** It means a second wire format and a gateway. Rejected.
- **Wait for an encrypted Vault first, then build only Blind Peers.** That is cleaner, and it would
  hold everything behind a format migration. Rejected for now. Own Peers ship first, and Blind Peers
  for the Vault follow the encryption ADR.

## Consequences

- A user with a Peer has a blog, a profile and an Inbox that stay up, and Devices that sync through
  it even when they are never online together.
- The Vault gains one record kind (`nomad/peer`). Devices code must ignore `platform: 'peer'` in
  pairing (`multi-device-protocol.md` §2 gains a 2.2) and must never count a Peer in writer fan-out,
  Jobs' device picker, open tabs (ADR-0024), remote update (ADR-0031) or AI Bridge Providers.
- Autobase drives get a real full mirror for the first time, on the Peer and on desktop. That uses
  more disk on desktop for drives it hosts, which is the point of hosting.
- `mobile/backend/lib` becomes shared by two programs. Changes there now need the Peer's tests to
  pass too.
- An Own Peer is a new place the user's private data lives. The UI has to say that plainly, at
  pairing and on the Peer row.

## Still open

- **An encrypted Vault.** `encryptionKey` on the Vault, Root Drives and Space Libraries, with a
  migration and an `FS_FORMAT_VERSION` bump. It unlocks Blind Peers for private data. Its own ADR.
- **Rotating the Vault key** after a Peer or a Device is lost.
- **A web view through a Peer.** A Peer is the natural place to serve a read-only HTTPS view of
  public drives to people without Nomad (`mobile/backend/lib/http-gateway.mjs` already renders
  drives). Left to the inviting-friends exploration.
- **Jobs on a Peer.** It has no AI Runtime and no Secrets by design. A Job that only reads and
  notifies could run there one day. Not in this version.

## Spikes before *Accepted*

- **S1, a reader mirrors an Autobase drive in full.** From the base key only, a non-writer opens the
  base, finds every writer core and blobs core, downloads them in full, and keeps up as writers are
  added and removed. Measure the time and disk for a Vault with a year of Notes and Reader records.
- **S2, `blind-peer` fit.** Does `blind-peer`/`blind-peering` keep a set of Hypercores for a client,
  serve them to other peers, and take a list that grows as an Autobase gains writers? If not, the
  `--blind` mode of §4.
- **S3, a home Peer behind NAT.** How often HyperDHT holepunching reaches a Peer behind a home router
  or CGNAT from a phone on mobile data, and whether the `nat-port-forwarder` desktop uses helps. This
  sets whether the UI recommends home or VPS first.

## Rollout

1. **Rules and records.** `shared/peers.mjs` with tests, `/.vault/peers/` in
   `multi-device-protocol.md`, CONTEXT.md entries (Peer, Own Peer, Blind Peer, Holdings).
2. **Full mirror of Autobase drives.** In `mobile/backend/lib/drive-manager.mjs` and desktop's
   `ensureHosting`, so Devices that host get it too. Spike S1 decides the shape.
3. **The Own Peer.** `peer/` with `join`, `run`, `status`, `leave`, pairing with `platform: 'peer'`,
   the `nomad/peer` channel, and the Peer row in desktop's Settings → Devices and the phone's Devices.
4. **Inbox store and forward,** once ADR-0036's Inbox is built.
5. **Blind Peers for public drives,** after spike S2.
6. **Docs.** nomad.dev: "Keep your drives online", covering what an Own Peer can read, how to run one
   at home or on a VPS, and what a Blind Peer operator learns.
