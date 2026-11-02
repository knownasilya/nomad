# An encrypted Vault: the user's records encrypted on disk and in sync, with a key only their Devices hold

**Status: Proposed.** 2026-11-02. Builds on ADR-0006 (the Vault), ADR-0010 (one `nomad.fs` over
Autobase), ADR-0030 (AI Jobs), ADR-0031 (Personas and Sessions), ADR-0033 (Secrets) and ADR-0036
(Persona Inbox). Settles the "encrypted Vault" and "rotating the Vault key" items the always-on Peer
ADR (PR #134) left open. Three spikes (below) must pass before *Accepted*.

The Vault holds most of what is private about a user: Notes, Reader subscriptions and saved
articles, Names, Highlights, Mods, AI memory and skills, Jobs and their runs, Drafts, Personas,
Sessions, and (with ADR-0036) inbox seeds. Today every one of those records is plain bytes in every
Device's corestore, and plain bytes to anything that replicates the Vault. This ADR encrypts the
Vault with a key that only the user's Devices (and Own Peers) hold, keeps that key wrapped by the
operating system's keystore on disk, gives the user a recovery key, and re-keys the Vault when a
Device is removed so a lost Device stops reading new records.

## Where things are today

- **No core is encrypted.** `AUTOBASE_OPTS` (`shared/fs-core.mjs`) passes no `encryptionKey`, so the
  Vault's writer cores, system core and Hyperbee view are plain. Anyone who holds the Vault key and
  connects can replicate and read every record. On disk, the corestore under `<userData>` (desktop)
  and the backend's storage path (phone) can be read by anything that can read the user's files, and
  by every backup of them.
- **Removing a Device stops its writes, not its reads.** `removeDevice` (`app/bg/hyper/vault.js`,
  `mobile/backend/lib/vault.mjs`) appends `removeWriter` and deletes the Device's record. The removed
  Device still knows the Vault key and every writer core's key, so it can keep replicating everything
  written after it was removed. Nothing refuses it. ADR-0006 says removal "cannot retroactively
  un-share already-replicated data"; it also doesn't stop new data.
- **Autobase 7 can encrypt.** `autobase@7.28.1` (pinned on desktop and the phone) takes
  `encryptionKey` (or `encrypt: true` to make one) and encrypts every block of the writer cores, the
  system core and the views with keys derived from it. A peer without the key can still replicate and
  verify the blocks (the Merkle tree covers the ciphertext), which is what a Blind Peer needs.
- **Autobase can keep the key wrapped on disk.** It stores the key in the local core's user data as
  `autobase/encryption`, or, given a `blindEncryption: { encrypt, decrypt }` handler, only wrapped as
  `autobase/blind-encryption` (it rewrites an existing plain one on the next open). That handler is
  the hook for an OS keystore.
- **Pairing already carries a key.** Both `device-pairing.js` and `space-library.js` call
  `candidate.confirm({ key, encryptionKey: sess.base.encryptionKey })`. It is `null` today, and the
  candidate side (`submitInvite` on desktop, `pairDevice` in `mobile/backend/lib/vault.mjs`) ignores it.
- **Desktop has a keystore path.** Secrets (ADR-0033) are wrapped with Electron `safeStorage`
  (Keychain, DPAPI, libsecret/KWallet), and Nomad refuses Linux's `basic_text` fallback because its
  key is fixed. The phone has no keystore module; it keeps the Vault key in a plain file
  (`vault-key` in `mobile/backend/backend.mjs`).
- **Moving between Vaults exists in a small form.** A solo Vault that joins another records
  `vault_carry_from` and copies its records across (`CARRY_PREFIXES` in `vault.js`).
- **Who treats "knows the Vault key" as trust.** The AI Bridge doesn't: it checks a signature by the
  Device's writer key against `/.vault/devices/` (`isVaultMember`). Device presence
  (`shared/device-presence.mjs`) takes the `deviceKey` a peer says it has, and only uses it for the
  Connected label.

## Decision

### 1. Words

- The **Vault key** is the Vault's Autobase key, as today. After this ADR it is an address: knowing it
  lets a peer find and carry the Vault's blocks, not read them.
- The Vault's **encryption key** is the 32-byte Autobase `encryptionKey`. Whoever has it reads the
  Vault. One Vault has one encryption key for its whole life.
- A Device's **keystore key** wraps the encryption key on that Device's disk. It lives in the OS
  keystore and never leaves it.
- The **recovery key** is a secret the user writes down. It is not stored on any Device.
- A **Vault move** makes a new Vault with a new Vault key and encryption key, copies every record into
  it, and brings the user's remaining Devices over. Encrypting an existing Vault is a move; removing a
  Device is a move.

### 2. What is encrypted, and what isn't

The Vault is opened with `encryptionKey` on every Device, so every core of it is encrypted: each
Device's writer core, the system core, the encryption view and the Hyperbee view. That covers every
`/.vault/**` and `/.drafts/**` record, inline or not.

- **The record format doesn't change.** Encryption is below the Hyperbee: the
  `{ metadata, blob, value }` records and the ops `shared/fs-core.mjs` applies are byte-for-byte the same, so `FS_FORMAT_VERSION`
  stays 1 and the golden test keeps passing. What changes is that an app that can't open an encrypted
  base can't read the Vault, so the move is gated on every Device's version (§7).
- **A blob core in the Vault must use the Vault's encryption.** Drafts store bytes inline today. The
  `draft-blobs` core that ADR-0012 plans must be opened with the base's writer encryption
  (`base.getWriterEncryption()`), not as a plain `store.get`. `fs-core.mjs` gets a test that fails if
  a Vault blob core opens without it.
- **Not in scope:** Space Root Drives (bookmarks, the Drive Registry, `hyper://private/`, AI chats),
  Space Libraries, Profile Drives and every drive the user publishes. A Root Drive is also browsed as a
  site and a Space Library is shared with other people, so each needs its own key delivery and
  re-key rule. The mechanism here (keystore-wrapped secret, delivery by pairing, re-key by move) is
  the one they will reuse, in their own ADR. The UI says "your Vault" and lists what that covers; it
  never says "all your data is encrypted".

### 3. Keys on each Device: wrapped by the OS keystore

Every Device passes Autobase a `blindEncryption` handler, so the encryption key is on disk only as
`autobase/blind-encryption`, wrapped by the Device's keystore key.

| Device | Keystore | Notes |
|---|---|---|
| macOS | Keychain via `safeStorage` | tied to the app's signature; see "When the keystore can't unwrap" |
| Windows | DPAPI via `safeStorage` | tied to the Windows user |
| Linux | libsecret or KWallet via `safeStorage` | with `basic_text` (no keyring), see below |
| Android | Android Keystore, a non-exportable AES-256-GCM key | new Expo module `mobile/modules/nomad-keystore` |
| Own Peer | a file the operator protects, or a passphrase at start | the Peer ADR decides; never weaker than its disk |

- **The handler is small and shared.** `shared/vault-crypto.mjs` builds `{ encrypt, decrypt }` around
  a `wrap(bytes)` / `unwrap(bytes)` pair each runtime supplies: `safeStorage` in the main process on
  desktop; on the phone, an RPC from the Bare backend to the React Native side, which asks
  `nomad-keystore`. The keystore key never enters JavaScript. The encryption key does, in the process
  that opens the Vault, and is never logged, never sent over IPC to a renderer, and never written
  anywhere but `autobase/blind-encryption`.
- **No passphrase by default.** The Keystore key on Android is made without
  `setUserAuthenticationRequired`, and desktop's `safeStorage` asks nothing while the user is logged in
  to the OS. So the Vault opens at start without a prompt, which is what keeps Jobs and sync working
  unattended (§9). The protection is the one the OS gives: a stolen powered-off laptop with disk
  encryption, a copied data folder, a backup, or another OS user reads nothing.
- **Linux with no keyring.** `safeStorage`'s `basic_text` key is fixed, so wrapping with it is no
  protection at rest. Nomad still encrypts the Vault (sync and Peers are still protected) and stores
  the encryption key wrapped with `basic_text`, and Settings → Security says in one sentence that this
  computer keeps the Vault's key unprotected, with a link to set a passphrase (§8).
- **The Vault key stays where it is.** The phone's `vault-key` file and desktop's `vault_key`
  setting don't change: after this ADR the Vault key is only an address.

### 4. Linking a Device hands it the encryption key

Pairing (`docs/multi-device-protocol.md` §2) is unchanged on the wire: the member's
`candidate.confirm({ key, encryptionKey })` now carries a real `encryptionKey`, and blind-pairing
already encrypts the response to the candidate.

- **The candidate keeps it.** `submitInvite` (desktop) and `pairDevice` (phone) read
  `result.encryptionKey` and open the Vault with it and the keystore handler. Autobase then stores it
  wrapped. The candidate mints its writer key before it knows the secret
  (`Autobase.getLocalCore(store)` with no key), as now; Autobase sets the writer core's encryption on
  the first open (spike S1 checks this on both runtimes).
- **Approval stays manual** (ADR-0006, never auto-accepted). The approve screen adds one sentence:
  the new Device will be able to read everything in your Vault.
- **Own Peers** (PR #134) get the encryption key the same way, because they pair the same way. A Blind
  Peer is never given it: it holds the Vault's ciphertext and the recovery log (§6) and nothing else.
- **Space Library invites** keep passing `encryptionKey`, still `null` until Space Libraries are
  encrypted.

### 5. When the keystore can't unwrap: link again, or use the recovery key

A wrapped secret can stop opening: a Mac build signed with another certificate can't read the
Keychain item (CLAUDE.md, Releasing), the OS user profile is rebuilt, a data folder is restored on a
new computer, or a phone's Keystore is cleared. That Device still has every block and its writer
key; it lacks only the secret.

- bg detects it on open (`decrypt` throws) and keeps the Vault closed. Browsing still works.
  Vault-backed pages and screens show one notice, **Unlock your Vault on this computer**, with two
  ways in:
  1. **From another Device.** It shows an invite code, as linking does, and another Device approves
     it. The approver sees that the candidate's key is already a Device of this Vault and says so
     ("Your MacBook asks to unlock again"), adds no writer, and confirms with the encryption key.
  2. **With the recovery key** (§6).
- Never a silent fallback to a plain copy: there isn't one.

### 6. The recovery key and the recovery log

If every Device is lost, the Vault can be read again only with the recovery key, and only from
somewhere that still holds its blocks: an Own or Blind Peer, or a backup of a Device's data folder.
The setup screens say this plainly. With neither, the recovery key opens nothing.

- **Making it.** Settings → Security → **Make a recovery key** (and once in onboarding, skippable)
  makes 32 random bytes and shows them once as 24 words (BIP-39 English list), with Copy and Print.
  The user types three of the words back. Nomad keeps only the derived **recovery public key**
  (X25519, `crypto_box_seed_keypair` over `hash('nomad/recovery/v1' ‖ words)`), in the Vault:

  ```
  /.vault/recovery.json   { type: 'nomad/recovery', publicKey, createdAt, createdBy }
  ```

  Making a new one replaces the record and the old words stop working for later Vaults (§7).
- **The recovery log** is a single-writer Hypercore at a key pair derived from the recovery public
  key (`keyPair(hash('nomad/recovery-log/v1' ‖ publicKey))`), so someone holding only the words can find it
  on the DHT. Every Device can derive that key pair, so any of them appends to it. Each entry is:

  ```
  { vaultKey, sealed: crypto_box_seal({ vaultKey, encryptionKey, at }, recoveryPublicKey),
    prev: <vaultKey of the Vault this one moved from> | null,
    devices: [<name>…], by: <writer key>, sig: <by's signature over the rest> }
  ```

  A Device appends one when the Vault is made, when it is moved (§7) and when the recovery key
  changes. The log is tiny and every Device and Peer (Blind ones too: entries are sealed) replicates
  it in full.
- **Restoring.** On a new Device: **Restore from a recovery key** derives the key pair, reads the log
  from the network or from a chosen backup folder, opens the newest entry whose chain of `prev` reaches
  the first one, and opens that Vault read-only. It can't become a writer (no Device is left to add
  it), so it does what joining a Vault already does with a solo Vault: it makes a new Vault on this
  Device, copies every record across (the carry path, all prefixes this time), and appends a new log
  entry. The new Vault gets a new recovery key prompt if the user wants one.
- **A removed Device can append to the log too.** It can't read anything new, but it can append a
  forged entry pointing at a Vault it made. So when two entries claim the same `prev`, restore shows
  both with their Device names and dates and asks which one is the user's ("Laptop, Phone, moved
  2 Nov" against "Phone (lost), moved 3 Nov"). An entry signed by a key that another entry lists as
  removed is shown second. This is the known limit of a recovery key with no server; spike S3 checks
  it holds up in practice.

### 7. A Vault move: how an existing Vault becomes encrypted, and how a removed Device is shut out

There is no way to re-key an Autobase in place, and a Device that once had the encryption key keeps it.
So both jobs are one operation: make a new Vault and move.

1. **Who runs it.** Any computer that writes the Vault. The phone can ask for one (it writes the
   request record below) but doesn't run it in the first version, since the phone never makes a Vault
   of its own today.
2. **When it may run.** Only when every listed Device and Own Peer has said it can open an encrypted
   Vault: each one writes `features: { vaultCrypto: 1 }` on its own `/.vault/devices/` record at
   start. Until then Settings → Security says which Device needs updating. A Device that isn't updated
   would see a frozen Vault, not an error.
3. **Make and fill.** The mover makes the new Vault with `encrypt: true` in a fresh namespace (its
   root `local` core is held by the old Vault, the same reason as `_storeFor` in `autobases.js`), then
   copies every record of the old Vault into it, skipping the removed Device's own records. It also
   rewrites `/.vault/recovery.json` and appends to the recovery log.
4. **Tell the others, in the old Vault.**

   ```
   /.vault/move.json
     { type: 'nomad/vault-move', to: <new Vault key>, reason: 'encrypt' | 'remove',
       removed: [<deviceId>…], by, at,
       keys: { <deviceId>: crypto_box_seal(encryptionKey, <that Device's X25519 key>) } }
   ```

   Each remaining Device's X25519 key is the Curve25519 form of its Vault writer key
   (`crypto_sign_ed25519_pk_to_curve25519`), so the mover can seal to it without asking, and each
   Device opens its box with its own writer secret key. The removed Device gets no box.
5. **Each Device comes over.** On reading `move.json`, a Device opens its box, mints a writer key for
   the new Vault, and asks for it with a record in the old Vault, the way a drive writer grant already
   works (`/.vault/drive-writers/<newVaultKey>/<writerKey>.json`, ADR-0026). Any Device that already
   writes the new Vault adds it (`addWriter`, as an indexer) and marks it granted, only when the ask
   comes from a `deviceId` the new Vault lists and `move.json` doesn't name as removed. The Device then
   switches (`vault.events 'changed'`, which the AI Bridge, presence and the Vault apps already follow)
   and writes `movedAt` on its record in the new Vault.
6. **The old Vault goes away.** When every remaining Device and Own Peer has `movedAt`, each one
   deletes the old Vault's cores from its store. A Device that stays offline keeps the old Vault alive
   on the others until it returns or the user removes it from the new Vault.

**Device ids.** A move gives every Device a new writer key, and many records name a Device by its
key: Jobs' `device`, open tabs (`/.vault/tabs/<deviceKey>.json`), update requests and status,
drive-writer and persona-writer asks. So a Device record gains a stable `deviceId`, its writer key in
the first Vault it joined (so every existing record keeps its path and meaning), plus `writerKey`, its
key in the current Vault. Records keep naming Devices by `deviceId`. The two checks that need the live
key look it up by `writerKey`: the AI Bridge's `isVaultMember` and device presence.

**Removing a Device** is now: `removeWriter` and the record delete as today, the removeWriter fan-out to
drives as today, then a move with `reason: 'remove'`. The Devices screen says "Remove and lock out",
explains that the removed Device keeps what it already had but gets nothing new, and shows the move's
progress per Device. For a Device the user wiped themselves, **Remove without locking out** skips the
move; it is a secondary choice.

**The Inbox moves too.** A removed Device knows every Persona's inbox seed (ADR-0036 §2). A move with
`reason: 'remove'` runs ADR-0036's **Change inbox address** for each Persona with an Inbox, so the
removed Device can't read new messages either.

### 8. An optional passphrase, later

Some users want the Vault closed until they say so, not just until the OS user logs in. Settings →
Security gets **Require a passphrase when Nomad starts**, in a later step (Rollout 5):

- The keystore key is then wrapped too, by a key from Argon2id over the passphrase (salt in the
  Device's local settings). On the phone, the same switch asks for biometrics instead, with the
  Keystore key created with user authentication.
- While the Vault is locked, Nomad still browses, and Vault-backed features say they are locked: Notes,
  Reader, Names (a typed name doesn't resolve), Mods (pages load without them), Personas and Sessions
  (a site's `getCurrent()` returns `null` and no `change` fires), Jobs (§9), and the AI's personal
  capabilities. Replication of the Vault's ciphertext continues if spike S1 shows corestore serves the
  cores without the base open; if not, the Device stops passing the Vault along while locked.
- It is per Device. The phone can stay unlocked while a shared desktop asks.

### 9. Jobs and other work that runs with nobody there

With the default keystore unlock (§3), nothing changes: the Vault opens at start, `app/bg/ai/jobs.js`
reads the Jobs and runs the ones due, on schedule and once on wake, as ADR-0030 says. Background AI
tagging of Notes and Reader posts, remote updates (ADR-0031) and open-tabs publishing keep working.

With a passphrase (§8):

- A locked Device doesn't know its Jobs exist, because the Jobs are Vault records. So nothing runs and
  nothing is recorded as failed. On unlock, every Job whose `dueAt` passed runs once, the same rule as
  waking from sleep.
- The phone's Jobs list shows "Waiting for <computer> to be unlocked" from that computer's device
  record (`locked: true`, written when it locks and cleared on unlock), so a missed morning digest
  has a reason.
- The settings screen says it before the switch is turned on: Jobs on this computer won't run until
  you unlock Nomad.

A Job never gets the encryption key or the keystore key in any form: they aren't capabilities, and
`execute` has no path to them.

### 10. Secrets stay on their computer

ADR-0033 §1 kept Secrets out of the Vault for three reasons: the Vault replicates in plain form, it
isn't encrypted at rest, and a lost Device can't be shut out. This ADR answers all three, and Secrets
still stay where they are, because the remaining reasons stand: the phone and Own Peers would get
every API key, and a Job runs on one computer.

A later ADR may add **Use on all my computers** per Secret. The shape it should take, so nothing here
has to change: the value goes in a Vault record sealed per computer (to each desktop Device's X25519
key, never to the phone's or a Peer's), the per-Job grants stay local, and a move with
`reason: 'remove'` re-seals to the remaining computers and tells the user to rotate the key at its
service, since the removed computer had it.

### 11. The phone

- **Keystore.** `mobile/modules/nomad-keystore` (Kotlin, Android Keystore, AES-256-GCM,
  non-exportable, no user authentication by default) exposes `wrap` / `unwrap` to React Native. The
  backend asks for them over the existing RPC as `RPC_KEYSTORE_WRAP` / `RPC_KEYSTORE_UNWRAP`, so the
  Bare worklet never sees the keystore key. The backend opens the Vault only after the RN side is up,
  which is already the order.
- **Pairing and moves.** `pairDevice` keeps `result.encryptionKey`. The backend follows `move.json` like
  desktop (§7 step 5), with the same shared code in `shared/vault-crypto.mjs`.
- **Unlocking again** (§5) on the phone is the same two choices, from Settings → Devices.
- **The AI panel is unchanged.** Its turns run on a computer over the AI Bridge, which reads the Vault
  there.

## Considered options

- **Encrypt only at rest (wrap the corestore files), not the cores.** Simpler, and it leaves sync and
  every Peer with plain blocks. Rejected: the main thing the user gains here is that something other
  than their own Devices can hold the Vault.
- **A passphrase by default.** Strongest at rest, and it would stop Jobs, AI tagging, open-tab sync and
  remote updates on every restart, and put a password between the user and every Note. Rejected as the
  default; offered per Device (§8).
- **Derive the encryption key from the recovery key.** Recovery becomes trivial, and then every Device
  needs the recovery key to make the next Vault after a removal, or every Device keeps it, which a
  removed Device would too. Rejected.
- **Keep one Vault and rotate keys inside it.** Autobase 7 has no public re-key, and its block keys all
  derive from the one `encryptionKey`, so a Device that had it reads every later block. Rejected until
  Autobase supports re-keying; a move does the same job with today's code.
- **Encrypt records ourselves above the Hyperbee** (seal each `value`). Works without Autobase support,
  but leaves paths (`/.vault/notes/<id>`, `/.vault/reader/<space>/follows/<host>`) in the clear, and
  paths say a lot. Rejected.
- **Re-pair every Device after a move.** No new protocol, and the user walks to every Device each time
  they remove one. Rejected for the sealed boxes in `move.json`.
- **Put the recovery log's contents in the recovery key** (the key is the Vault key and secret). No log
  needed, and the key stops working at the first move. Rejected.

## Consequences

- Every Device needs a working keystore to open the Vault without a prompt. A Mac build signed with a
  different certificate already loses Secrets; now it also asks to unlock the Vault once (§5). The
  release rules in CLAUDE.md matter more.
- The first encrypted Vault is a move, so every existing user's Vault key changes once. Anything that
  stored the Vault key outside the Vault (the `vault_key` setting, the phone's `vault-key` file, the AI
  Bridge and presence channel ids) follows `vault.events 'changed'`, which already exists for joining
  another Vault.
- Device records gain `deviceId`, `writerKey`, `features`, `movedAt` and `locked`. Code that names a
  Device must use `deviceId`, and code that checks a live connection must use `writerKey`. That is a
  sweep across `vault.js`, `device-pairing.js`, `ai-bridge.js`, `device-presence.mjs`, `open-tabs`,
  `jobs`, `remote-update`, `drive-writers` and `personas` on both runtimes, with tests.
- Removing a Device costs a full copy of the Vault on one computer and a sync on the others. For a
  Vault with a year of saved articles that may be tens of megabytes; spike S2 measures it.
- Blind Peers (PR #134 §4) may now hold the Vault and the recovery log.
- Losing every Device and having no Peer and no backup still loses the Vault. The recovery key doesn't
  change that, and the UI says so where the key is made.
- `docs/multi-device-protocol.md` gains §1.6 (the move record, the recovery record and log, device ids)
  and §2's note that `encryptionKey` is now set. CONTEXT.md gains encryption key, recovery key and
  Vault move, and the Vault entry says what is encrypted.
- The nomad.dev docs get a "How your Vault is protected" page: what is encrypted, what isn't (§2), what
  a removed Device keeps, and what the recovery key can and can't do.

## Still open

- **Root Drives and Space Libraries.** The same mechanism, in their own ADR (§2). A Space Library is
  harder: its secret goes to other people, and removing a member is a move of a shared Space.
- **What a locked Device passes along** (§8), pending spike S1.
- **Re-keying in place** if Autobase adds it, which would make removal cheap.
- **Secrets on all computers** (§10).

## Spikes before *Accepted*

- **S1, an encrypted Vault on both runtimes.** Desktop makes a Vault with `encrypt: true` and a
  `safeStorage` `blindEncryption` handler; a phone pairs with the key from `candidate.confirm`, wraps it
  through `nomad-keystore`, becomes a writer, and both read each other's records. Then a non-writer
  with only the Vault key mirrors every core and can't decode a block. Check whether corestore serves a
  Vault's cores while the base isn't open.
- **S2, a move with three Devices.** One computer, one more computer and a phone; one of them offline
  for the move and back a day later. Measure copy time and size for a large Vault, check every record
  arrives, that the device-id sweep keeps Jobs, tabs and grants pointing at the right Device, and that
  the removed Device's replication of the new Vault gets nothing.
- **S3, restore.** From the 24 words alone against a Blind Peer, and against a copied data folder;
  then with a forged log entry from a removed Device, to check the restore screen makes the right
  choice obvious.

## Rollout

1. **Rules and records.** `shared/vault-crypto.mjs` (the `blindEncryption` handler shape, move and
   recovery records, sealing, the recovery words, the `features` gate) with tests; `deviceId` and
   `writerKey` on Device records and the sweep that uses them; `features: { vaultCrypto: 1 }` written
   by every Device. Ships before anything is encrypted, so every Device is ready when the move comes.
2. **Keystores.** `safeStorage` handler on desktop, `nomad-keystore` on the phone, and pairing that
   keeps `encryptionKey`. New Vaults (a first Device, a restore) are made encrypted from here on.
3. **The move.** `move.json`, sealed boxes, writer asks for the new Vault, the switch and cleanup; the
   one-time move for existing Vaults, started from Settings → Security and offered once in a notice;
   "Remove and lock out" on desktop and the phone.
4. **Recovery.** Make a recovery key, the recovery log, Restore from a recovery key, and Unlock again
   from another Device.
5. **Passphrase lock.** Desktop passphrase, phone biometrics, the locked states, and Jobs' waiting
   notice.
6. **Docs.** nomad.dev "How your Vault is protected", `multi-device-protocol.md`, CONTEXT.md.
