# Persona Inbox: direct messages to a Persona, end-to-end encrypted, with the user deciding who gets in

**Status: Proposed.** 2026-11-02. Builds on ADR-0031 (Personas and Sessions, implemented in [#128]),
ADR-0006 (the Vault), ADR-0013 (followers are subscriber-side, which set the "encrypted follow-inbox"
aside as its own ADR) and ADR-0029 (Shared Spaces). Amends ADR-0031 §6: `walled.garden/person` gains
one optional field. Two spikes (below) must pass before *Accepted*.

The user asked how to build a Persona profile and include DMs in it. A Persona already points at a
public Profile Drive (ADR-0031). This ADR gives a Persona an **Inbox**: anyone the user lets in can
send it a private message, only the user's own Devices can read it, and the user can see and reply
from desktop and phone. It also decides who may write to a Persona at all, how spam is held off, and
what the network learns about who talks to whom.

## Where things are today

- **A Persona has no keys of its own.** It is a Vault record that points at a Profile Drive
  (`shared/personas.mjs` in [#128]). The Profile Drive is a collaborative drive whose writers are the
  user's Devices (ADR-0031 §5); its key is an Autobase key, not a key pair anyone can encrypt to.
- **Nothing in Nomad carries a message from one person to another.** The closest things are
  `nomad/space-control` (ADR-0029 §7: a viewer's ask, re-sent to each peer until it lands) and the
  writer requests on `nomad/autobase-control`. Both run inside a Drive's own swarm, between people
  who already share a Drive.
- **ADR-0013** rejected a public follower list and sketched an encrypted follow-inbox ("the
  `autopass`/mailbox pattern") as the only way to get a private one. It deferred it as new machinery
  that needs its own ADR. This is that machinery, used for messages, not follows.
- **Pieces to build on:** `hyperswarm` (and so `hyperdht`), `hypercore-crypto`, `protomux` and
  `compact-encoding` are already dependencies on desktop and the phone; the Vault already syncs
  private records to every Device (Notes, Reader, Sessions); local notifications already exist for
  Jobs (ADR-0030, Electron on desktop, `expo-notifications` on the phone, no push server).

## Decision

### 1. Words

- An **Inbox** is a Persona's ability to receive messages: a key pair held in the Vault and a
  **mailbox** (a network address on the DHT) that the user's online Devices answer.
- A **Message** is one `walled.garden/message` record (§5), sent from one Persona to another.
- A **Conversation** is every Message between one of the user's Personas and one other Profile Drive.
  One to one only. Group chat is a Shared Space, a forum, or a later ADR.
- A **Contact** is a Profile Drive the user has accepted (or written to first) for one Persona.
- A **Message request** is a Message from a Profile Drive that isn't a Contact. It waits in Requests,
  with no notification, until the user accepts, ignores or blocks the sender.

### 2. Each Persona gets its own keys, from one seed in the Vault

Turning on messages for a Persona makes a 32-byte random **inbox seed**, stored only in the Vault:

```
/.vault/inbox/<personaId>.json
  { type: 'nomad/inbox', personaId, seed, mode, createdAt, rotatedAt?, previous?: { seed, until } }
```

Three key pairs are derived from it with domain separation (`keyPair(hash('nomad/inbox/<use>/v1' ‖
seed))`), so one leak doesn't turn into another use:

| Key | Kind | Used for |
|---|---|---|
| `sign` | Ed25519 | signs every Message this Persona sends; proves the sender |
| `box` | X25519 | senders encrypt to it; only this Persona's Devices can open |
| `mailbox` | Ed25519 | the HyperDHT server key the Devices listen on (§4) |

- **Separate from the Profile Drive key.** The Drive can't be rotated without losing the identity
  (ADR-0031 §8). The inbox can: **Change inbox address** makes a new seed, keeps the old one in
  `previous` for 14 days so messages already sent still open, then forgets it.
- **Same exposure as the rest of the Vault.** Anyone who can read the user's Vault can read the seed,
  and so their messages. That is the trust Notes, Reader and Sessions already have (ADR-0031,
  Consequences); the UI does not call this "end-to-end" in a way that implies more.
- **No Writer Keys revival.** The `sign` key proves "the holder of the key this Profile Drive
  publishes", not "these Devices are one person" (ADR-0031 §6).

### 3. Who may message a Persona: three modes, off by default

Each Persona's Inbox has a `mode`, set in My Library → Personas and on the phone:

| Mode | What's published in the Profile Drive | Who can reach the Persona |
|---|---|---|
| **Off** (default) | `inbox.sign` once the Persona has sent a Message, else nothing | nobody new. Contacts the user wrote to can still answer (§3.3). |
| **People I give a link to** | `inbox.sign` only | holders of a **message link** the user handed out, plus Contacts |
| **Anyone, as requests** | `inbox.sign`, `inbox.box`, `inbox.mailbox` | anyone; non-Contacts land in Requests |

1. **A message link** carries the mailbox and box keys, not the seed:
   `nomad://messages/new?to=hyper://<profile>/&mailbox=<hex>&box=<hex>`. It's text the user shares
   any way they like. Changing the inbox address (§2) kills every link at once, so in this mode
   rotation actually stops someone. In *Anyone* mode it can't (the new keys are published), and the
   tools are Block and switching mode.
2. **Every Message carries the sender's own reply address** (`replyTo: { mailbox, box }`) inside the
   encryption (§5), so the recipient can answer even when the sender's mode is Off or link-only.
   Writing to someone makes them a Contact for that Persona, so their reply is not a request.
3. **Off means unpublished, not unreachable to Contacts.** Sending a Message makes the Persona's seed
   if it has none, publishes `inbox.sign` (a recipient needs it to check the sender, §6.3) and starts
   the Devices answering the mailbox, but only for Contacts. Someone the user wrote to can answer at
   the `replyTo` they were given. Switching to Off and changing the address cuts everyone.
4. **Accept, Ignore, Block** on a request. Accept makes a Contact and moves the Conversation to the
   inbox. Ignore deletes the request; the sender can ask again. Block keeps a `blocked` Contact record
   so their later Messages are dropped on arrival. None of these is ever sent to the sender (§6.4).

```
/.vault/contacts/<personaId>/<sha256(profileKey)>.json
  { type: 'nomad/contact', personaId, profileUrl, state: 'accepted' | 'blocked',
    sign, replyTo?: { mailbox, box }, createdAt, updatedAt }
```

### 4. How a Message travels

- **The mailbox is a HyperDHT server** keyed by the `mailbox` key pair. Each of the user's Devices
  that is online and has the Vault listens on it: desktop always while running, the phone while its
  backend runs. Any one of them that answers takes delivery for all of them, because it writes the
  Message to the Vault, which syncs it to the rest (§7).
- **The sender connects with a fresh key pair for every delivery,** never the swarm key pair it uses
  to replicate Drives. Otherwise the recipient (and any DHT node it reached) could tie the sender's
  messages to all of that Device's other replication traffic.
- **One frame each way,** a small protocol `nomad/inbox/1` (compact-encoding) on the encrypted
  stream: the sender sends `{ v: 1, sealed }`, the mailbox answers `{ ok: true }` once the Message is
  in its local Vault, and the connection closes.
- **`sealed` is a sealed box** (`crypto_box_seal`) to the recipient's `box` key, holding
  `{ message, sig, replyTo }`. The sealed box hides the sender from anyone in the middle; the
  signature inside proves the sender to the recipient. `sig` is Ed25519 by the sender's `sign` key
  over `'nomad/inbox/v1' ‖ recipientBox ‖ canonicalJSON(message)`. Binding the recipient's key stops
  a recipient from forwarding a signed Message to a third person as if it had been sent to them.
- **The sender's outbox is in their Vault.** A Message is written as `queued` first, then any of the
  sender's Devices delivers it: right away, on start, on a network change, then backing off to every
  30 minutes, for 30 days, after which it is marked *Not delivered* and the UI says so. Two Devices
  may both deliver; the recipient keeps one copy by Message `id`.
- **When both sides are offline nothing moves.** There is no relay in this version. With desktop and
  phone both able to send and receive, the window is any moment one Device on each side is online,
  which for a person with a computer that stays on is most of the day. A store-and-forward relay is
  the first thing to add (§8, Still open).

### 5. The `walled.garden/message` schema

A new content convention (ADR-0005), because two different browsers or apps must agree on it.

```ts
// app/lib/schemas/walled.garden/message.ts
export const MessageSchema = z.object({
  type: z.literal('walled.garden/message'),
  id: z.string().min(16).max(40),             // 16 random bytes, base32
  from: z.url(),                               // the sender's Profile Drive, hyper://<key>/
  to: z.url(),                                 // the recipient's Profile Drive
  createdAt: z.iso.datetime(),
  text: z.string().min(1).max(8000),           // plain text; links are shown, never fetched
  inReplyTo: z.string().optional(),            // another Message id in the Conversation
});
```

- **Text only.** No HTML, no Markdown images, no attachments. Nothing in a Message makes the reader's
  browser load anything, so a Message can't carry a tracking pixel or a read receipt in disguise. A
  file is shared as a `hyper://` link the reader chooses to open.
- **The frame is capped at 64 KiB** before decryption, so a mailbox never decrypts a large blob.
- `PersonSchema` gains `inbox?: { v: 1, sign: hex64, box?: hex64, mailbox?: hex64 }` (§3). This
  amends ADR-0031 §6. Both schemas go through the usual checklist: the Zod files, `index.ts`, the
  regenerated editor types, and `walled-garden-schemas.md` on nomad.dev.

The stored copy wraps it with local state that never travels:

```
/.vault/messages/<personaId>/<conversationKey>/<createdAt>-<id>.json
  { type: 'nomad/message-record', direction: 'in' | 'out', message,
    status: 'queued' | 'delivered' | 'failed' | 'received', request?: true, readAt? }

conversationKey = sha256(sort([myProfileKey, theirProfileKey]).join(':'))
```

### 6. Spam and abuse

The defaults do most of the work: the Inbox is Off until the user turns it on, and *link-only* is the
mode the UI suggests first. For a Persona in *Anyone* mode:

1. **One request per stranger.** A sender who isn't a Contact gets one Message into Requests. Later
   ones from the same `sign` key are dropped until the user accepts. At most 200 requests wait;
   past that the oldest go.
2. **Rate limits at the mailbox:** at most 30 deliveries an hour from one remote address and 10 a
   minute overall from non-Contacts, applied before decryption where possible (the remote address is
   known at the handshake; the sender's `sign` key only after opening the box, which is cheap).
3. **The sender must be checkable.** Before a request is shown, the receiving Device reads the
   sender's Profile Drive `index.json` (client-only, ADR-0013's mitigation) and checks that its
   `inbox.sign` matches the signature. A request that can't be checked within 7 days is dropped.
   The request shows the sender's title, picture **and drive key**, the same way the login prompt
   does (ADR-0031 §7.3), so a look-alike name can't pass for someone the user knows.
4. **The sender learns nothing from the answer.** The mailbox sends the same `{ ok: true }` for a
   Contact, a request, a duplicate, a blocked sender and a rate-limited one, after it has written or
   dropped the Message. So a sender can't tell they were blocked, ignored or read. There are no read
   receipts, no typing indicators and no "online" status. The one thing a sender does learn is that
   some Device of the recipient was online when the ack came; that is the cost of not having a relay.
5. **Requests don't notify** and never appear on the phone's lock screen.
6. **Not chosen for now:** proof of work on each request (costs real phones battery and still loses to
   a botnet), and shared blocklists (nobody to run one). Both can be added behind the same `ok`.

### 7. The Sessions tie-in (ADR-0031)

1. **Messages belong to the Persona, never to a Session.** No page API reads or sends messages, and
   `nomad.session` gains nothing. ADR-0031 §9 says a Session never gets the Persona's own authority;
   speaking as the user to another person is exactly that authority. A site the user is logged into
   with `profile` can learn the Profile Drive URL, and in *Anyone* mode the inbox keys in it, so it
   can *write to* the user like anyone else. That is what `profile` already means: the profile is
   public.
2. **The From Persona is the one ADR-0031 §4 resolves** when the user starts a Conversation from a
   tab (the Space's Persona, then the default). In nomad://messages the user picks it. A reply always
   comes from the Persona the Conversation belongs to.
3. **The writer check (ADR-0031 §5) guards the Inbox too.** The inbox keys are published in the
   Profile Drive, so a foreign writer could swap them and read every new Message. So: a Persona that
   isn't `usable` can't turn on its Inbox, can't send, and its Devices stop answering its mailbox.
   Every time the Profile Drive syncs, a Device checks that the published `inbox` matches the keys
   derived from the Vault's seed, and if not, stops and tells the user "Someone changed the inbox
   address on your Persona *Work*". *Vault not ready* pauses this check; it never raises the alarm.
4. **Deleting a Persona** deletes its inbox seed, Contacts and Messages, after a confirm that says
   so, and removes `inbox` from its Profile Drive. Ending a Session has no effect on messages.
5. **Shared Spaces (ADR-0029):** Personas are per Member, so a Message is never written to a Space
   Library. A Persona bound to a Shared Space uses its Inbox like any other.
6. **The user's AI doesn't read messages in this version.** Messages are text written by other
   people and arrive unasked: the plainest path for a prompt injection into a personal turn that can
   write Notes and Drives. A later ADR can add read-only capabilities with that in mind. Page turns
   and Jobs never get them.

### 8. Who can learn who talks to whom

| Who | What they can learn | Why, and what limits it |
|---|---|---|
| Someone in the middle | that two addresses exchanged a few kilobytes | Noise-encrypted stream; sealed box inside. Hiding the addresses needs a relay or Tor. |
| DHT nodes near the mailbox key | the recipient's Devices' addresses (announces) and a sender's address (one lookup) | the same as for any Drive's discovery key. The sender's key is fresh, so lookups aren't linked to each other. |
| Anyone with the Profile Drive URL | in *Anyone* mode, the mailbox key, so where the user's Devices are; never who writes | lookups don't announce. In *link-only* mode the mailbox isn't public. |
| The recipient | the sender's Persona (by design), address and send time | direct delivery shows the address. A relay would hide it (Still open). |
| The sender | that a Device of the recipient was online at ack time | the same `ok` for every outcome (§6.4). Never read state. |
| A site with a Session | nothing about messages | no page API. |
| Anyone with the user's Vault | every Message, in plain text | the Vault is the trust boundary (§2). |
| The user's other Devices | everything | they share the Vault on purpose. |

What this does **not** give: forward secrecy (a stolen seed opens any captured past traffic until the
address is changed), deniability (Messages are signed), or hiding addresses from the other party. The
UI and the nomad.dev page say so in those words.

### 9. Where the user reads and writes

- **Desktop:** a new internal app, `nomad://messages` (`app/userland/messages/`, registered in
  `bg/protocols/nomad.js` with `fallbackToIndexHTML`, in the browser menu): Conversations on the left
  grouped by Persona, Requests as a tab with a count, a plain text composer. It talks to a new
  internal API `nomad.inbox` (`internalOnly`, like `nomad.personas`). site-info on a Profile Drive
  gets **Message**, which opens a new Conversation from the tab's Persona. My Library → Personas gets
  the mode, **Copy message link** and **Change inbox address**. An OS notification for a new Message
  from a Contact, never for a request; the `inbox_notify` setting turns it off. Light and dark, built
  from `common.css` like nomad://notes.
- **Phone:** a Messages screen (`mobile/components/Messages.tsx`, an entry in `screens`, opened from
  the menu) over `RPC_APPS` `messages`, using `ScreenHeader`, `ListSection`/`ListRow`, the
  `BottomSheet` + `KeyboardInset` for the composer, and `ActionSheet` for Accept / Ignore / Block. The
  phone sends and receives itself (its backend runs the mailbox while alive) and sees everything the
  computer received through the Vault. Local notifications with `expo-notifications`, as Jobs do;
  there is no push server, so a closed phone learns of a Message when it next opens.

### 10. Code layout

- `shared/inbox.mjs`: record paths, key derivation labels, the conversation key, the frame encode and
  decode, the consent decision (`classify(message, contacts, mode) → inbox | request | drop`) and the
  limits. Pure; crypto comes from the caller, as in `shared/personas.mjs`. Tests
  `tests/unit/inbox.test.js`, including a golden frame so desktop and phone stay byte-identical.
- `app/bg/hyper/inbox.js` (desktop) and `mobile/backend/lib/inbox.mjs` (phone): the mailbox server,
  the outbox loop, the profile checks of §6.3 and §7.3.
- `app/bg/web-apis/bg/inbox.ts` + `manifests/internal/inbox.ts`: the internal `nomad.inbox` API.
- `app/lib/schemas/walled.garden/message.ts` and the `inbox` field in `person.ts`.
- No public API, so the sync triad (nomad.dev API page, `API_REFERENCE`, `nomad-dts.js`) doesn't apply.
  nomad.dev gets a user page under Personas and the schema entries.

## Considered options

- **A mailbox topic derived from the Profile Drive key** (`hash('inbox' ‖ profileKey)`), as first
  sketched. Simple, but anyone with the URL can compute it and watch it forever, it can never be
  changed without a new Profile Drive, and a hyperswarm connection carries the sender's swarm key.
  A separate seed (§2) fixes all three.
- **Use the Device's swarm key pair to deliver.** Free, and links every Message a Device sends to
  every Drive it replicates. Rejected (§4).
- **A two-writer Autobase per Conversation.** Offline delivery comes free whenever either side
  seeds it, and history syncs itself. But the Conversation's discovery key puts both people's
  Devices on one topic for as long as it exists, adding a writer is itself a consent ceremony, and a
  Message can never be taken back from the log. Kept in mind for group chat.
- **The sender writes into a Drive of their own and the recipient polls it.** The recipient has to
  learn the Drive exists, which is a message; and polling many strangers' Drives is the spam vector.
- **Publish the inbox always, filter only by Requests.** The usual social-network default. Off and
  link-only are cheap and give the user a real way to shut a stalker out (§3.1).
- **Let a Session send messages** (`sendMessage` permission). Turns any site the user logs into into
  something that can speak for them. Rejected (§7.1). A page *asking the browser to open a composer*
  that the user sends is still open.
- **A Signal-style ratchet.** Gives forward secrecy, at the cost of per-pair state synced across every
  Device of both people. The stored copy sits in the Vault in plain text anyway, so the gain is small
  until the Vault itself is encrypted at rest. Later.

## Consequences

- Two schema changes (`walled.garden/message`, `inbox` on `walled.garden/person`); no change to the
  Autobase wire format or `FS_FORMAT_VERSION`.
- A new long-lived network listener per Persona with an Inbox, on every online Device. Its cost is
  one DHT announce per Persona; the UI shows the Inbox as on per Persona so the user knows.
- The Vault gains four record kinds (inbox, contact, message record, and the outbox state on it).
  Every Message sent or received is a Vault write.
- ADR-0013 is unchanged: there is still no follower list, and a follow still tells the target
  nothing. A follow request over this Inbox would be a new Message type and its own decision.
- Writer requests and Shared Space invites still don't carry a Persona (ADR-0031, Consequences). An
  Inbox makes "message the owner to ask for access" possible without that.
- Messages from strangers are the easiest way to reach a user's AI with hostile text, which is why
  the AI is kept out (§7.6).

## Still open

- **A relay for offline delivery and hiding addresses.** A peer the user trusts (their own always-on
  machine, or a `blind-peer`-style service) that holds sealed frames for a Persona's mailbox until a
  Device collects them. It would fix both-sides-offline and stop the recipient learning the sender's
  address. Its own ADR.
- **A compose intent for pages.** A page asking the browser to open a composer to a Profile Drive,
  which the user sends or not, and the page learns nothing either way. Useful for the forum template.
- **The AI and messages** (§7.6).
- **Groups.**

## Spikes before *Accepted*

- **S1, several Devices on one mailbox key.** Confirm that HyperDHT reaches *some* server when two or
  three Devices announce the same key pair, and how fast it fails over when one is gone. If it
  doesn't, each Device gets its own derived mailbox key and the published field becomes a short list.
- **S2, the phone in the background.** How long the phone's backend keeps a mailbox reachable after
  the app leaves the screen, and what that costs in battery. This sets how the UI describes phone
  delivery.

## Rollout

1. **Rules and records.** `shared/inbox.mjs` with tests and a golden frame, the schemas, the Vault
   records, CONTEXT.md entries (Inbox, Message, Conversation, Contact, Message request).
2. **Desktop send and receive.** The mailbox, the outbox loop, the profile and key checks,
   `nomad.inbox`, My Library → Personas controls, nomad://messages, site-info's Message.
3. **Phone.** The Messages screen over `RPC_APPS`, then the phone's own mailbox and outbox.
4. **Docs.** nomad.dev: a Messages page under Personas (what is and isn't private, in the words of
   §8), and the schema entries.

[#128]: https://github.com/knownasilya/nomad/pull/128
