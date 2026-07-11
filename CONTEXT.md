# Nomad

A peer-to-peer browser built on Hypercore Protocol. Users author and browse content stored in Drives, distributed over Hyperswarm without central servers.

## Language

### Core data

**Drive**:
A content store identified by a public key — the atomic unit of P2P data in Nomad. Every Drive is
an Autobase (a linearised Hyperbee view over one or more writers' oplogs; ADR-0010). A Drive born
with one writer can gain more via `addWriter` **without changing its key/URL**; a single-writer Drive
is just a Drive with one writer. All access goes through the one backend-agnostic **`nomad.fs`** API.
_Avoid_: hyperdrive, collaborative drive, site, archive, dat

**Root Drive**:
The Drive backing a Space. Contains `/drives.json` and any user-created content for that Space. Created
automatically (as an Autobase) when a Space is first used.
_Avoid_: home drive, profile drive, user drive

**Drive Registry**:
The `/drives.json` file inside a Space's Root Drive. Lists the Drive keys the Space knows about.
_Avoid_: drive list, drive catalog, drive index

**Writer**:
A keypair granted append access to a Drive. Writers are added explicitly via `addWriter` (through
pairing/invites); they are not inferred from replication. A Drive's writer set (its Autobase oplog) is
the security boundary.
_Avoid_: author, contributor, collaborator

### Drafts

**Draft**:
A user's unpublished changes to a Drive — staged file writes and deletes that stay private to that
user's own Devices and are not replicated to any other peer until Published. Reading a Drive in Draft
Mode shows these changes merged over the Drive's published state. A Draft is a Drive-wide concept
(any file), distinct from a Post's `draft` field, which marks an already-replicated Post that Readers
hide — the two are different axes (unreplicated vs. replicated-but-unlisted) and can co-occur.
_Avoid_: working copy, staging, branch, unpublished changes

**Draft Mode**:
The per-Drive editing state in which writes are captured into that Drive's Draft instead of being
appended to the Drive directly. Toggled in the editor/explorer. Edits left in Draft Mode stay off the
wire.
_Avoid_: preview mode, edit mode, staging mode

**Publish**:
The action that folds a Drive's Draft into the Drive — replaying the staged writes and deletes as real
appends so they linearise into the Drive's replicated state and become visible to all peers — then
clears the Draft. Can be all-or-subset.
_Avoid_: commit, push, go live, release, sync

### Shell chrome

**Tab Layout**:
The navigation mode for the browser shell. Either `top-bar` (horizontal strip of tabs above the navbar) or `sidebar` (vertical panel replacing the tab strip). A global setting; the same layout applies across all Spaces.
_Avoid_: navigation mode, tab style, view mode

**Tab Sidebar**:
The vertical navigation panel shown when Tab Layout is `sidebar`. Renders groups as collapsible folder sections and ungrouped tabs as a flat list. Can be positioned left or right, resized, and collapsed to an icon rail. Distinct from any content-area panel.
_Avoid_: side panel, sidebar (unqualified), drawer

**Sidebar Rail**:
The collapsed state of the Tab Sidebar: a narrow strip (~48px) showing only favicons. Toggled independently from group-level collapse.
_Avoid_: mini sidebar, icon bar

### AI

**AI Runtime**:
The external OpenAI-compatible inference server (Ollama, LM Studio, or any `/v1/chat/completions`-compatible server) that executes model calls. Configured globally in Nomad settings via `ai_base_url` and `ai_default_model`. Not bundled; user-managed separately.
_Avoid_: local model, AI server, LLM backend

**AI Provider**:
A Device that runs the full `nomad.ai.chat()` agentic loop — model calls *and* the Drive tools — on behalf of another of the same user's Devices, and streams the result back. It is the Device that actually reaches an AI Runtime. Distinct from the AI Runtime itself: the Provider is a Nomad Device; the Runtime is the external inference server the Provider talks to.
_Avoid_: host, server, AI host, master

**AI Client**:
A Device that cannot (or chooses not to) reach an AI Runtime of its own, so it forwards a `nomad.ai.chat()` call to an AI Provider and renders the streamed result. Typically the mobile Device. The Client contributes the request context (which Drive, which messages); the Provider contributes the loop and the Runtime.
_Avoid_: thin client, slave, requester

**AI Bridge**:
The live, authenticated channel between two of a user's Devices that carries a forwarded `nomad.ai.chat()` call from an AI Client to an AI Provider and streams the result (and reverse-direction permission prompts) back. It is a Protomux channel over the shared Hyperswarm connection, keyed on the Vault and gated by a signature challenge against the Vault's Writer set. Distinct from the Vault itself: the Vault replicates data (eventual-consistency oplog); the AI Bridge is request/response and carries no persisted state — the chat never enters the Vault. See ADR-0013.
_Avoid_: AI channel, AI relay, AI proxy, RPC channel

**AI Config**:
The `/ai/` folder inside a Drive, containing `system.md` (the system prompt) and optionally a `tools/` directory. A Drive has an AI Config when it includes this folder. Any Drive can opt into AI behaviour by adding an `ai` key to its `/index.json` — either an inline object `{ "model": "..." }` or a pointer string `"hyper://..."` delegating to another Drive's AI Config.
_Avoid_: agent config, AI settings, model config

**Chat Bubble**:
A floating chat overlay Nomad injects into a Drive page when `"chatBubble": true` is set in the Drive's `/index.json`. The overlay is provided entirely by Nomad (a Lit custom element injected via the main process); the Drive author does not need to write any chat UI code. The bubble uses `nomad.ai.chat()` resolved against the same Drive's AI Config.
_Avoid_: chat widget, chat overlay, embedded chat

**AI Sidebar**:
The collapsible right-hand panel — in both the editor and the explorer — that hosts an agentic chat over the Drive currently open in that app. Unlike the Chat Bubble (injected into a Drive page, resolved against that page's own Drive), the AI Sidebar runs inside a `nomad://` app (`nomad://editor` / `nomad://explorer`) and directs `nomad.ai.chat()` at the *open* Drive via an explicit Drive URL. The agent reads, lists, and writes files across that Drive directly. One shared component (`app-stdlib`) serves both apps; each host supplies unsaved-changes gating and post-write reload.
_Avoid_: agent sidebar, chat sidebar, prompt panel, sidebar (unqualified — see Tab Sidebar)

**Prompt Session**:
One conversation in the AI Sidebar — the ordered transcript of user turns and assistant turns, plus the Checkpoints produced by those turns. Reverting the whole session undoes every Checkpoint it produced.
_Avoid_: chat session, thread, conversation

**Checkpoint**:
The revertible unit of AI edits: the bundle of file writes produced by a single assistant turn, each capturing the file's prior content (or its prior absence). Reverting a Checkpoint restores those files to their pre-turn state — rewriting prior content and deleting files the turn created. Distinct from Monaco's built-in per-keystroke undo, which does not cover writes the agent makes directly to the Drive.
_Avoid_: snapshot, restore point, undo step

### Social data

**Profile Drive**:
A Drive with `type: "walled.garden/person"` in its `/index.json`. Represents a user's public social identity — name, avatar, bio, and a structured links array. Distinct from the Root Drive, which is always private. Referenced in the Drive Registry under a `profile` tag.
_Avoid_: identity drive, person drive, social profile

**Writer Keys**:
The set of a user's Device keys. The Vault is their canonical source; they are also published as `/.data/walled.garden/writer-keys.json` inside the Profile Drive so other peers can resolve multiple Device writers back to one identity.

**Feed**:
A Drive that declares `type: "walled.garden/feed"` in its `/index.json`, advertising channel metadata (title, description, author, icon, language) and where its items live (`itemsPath`, `itemType`). The unit a Reader subscribes to.
_Avoid_: channel, source, rss

**Blog**:
A Feed whose items are Posts, implemented as a Collaborative Drive so all the user's Devices are Writers under one stable URL. References a Profile Drive for author identity. Distinct from a Profile Drive, which is the identity itself rather than a publication.
_Avoid_: site, publication

**Post**:
A single blog entry: a directory under a Blog's `/posts/` holding a `post.json` (`walled.garden/post` metadata) plus a body file (`index.html`, `index.md`, or `index.txt`) and any co-located assets. Addressable by its own URL.
_Avoid_: article, entry, page

**Reader**:
The in-browser feature that subscribes to Feeds and presents their Posts as an aggregated, RSS-like stream.
_Avoid_: feed reader, aggregator, rss client

**Follow**:
Subscribing to a Feed by adding its URL to the user's own `walled.garden/follows` record (outbound-only) in their private Root Drive. Because a Follow is stored on the *follower's* side and no aggregate follower list is ever published, who follows a user is not exposed at the data layer (ADR-0013). There is deliberately no "Followers" list or count.
_Avoid_: followers list, subscriber list, friend

### Discovery

**Listed**:
The opt-in state in which a public Drive announces itself for discovery and can appear in search
results. Toggled explicitly by the author (the `indexable` field in `/index.json`), never implied by
other metadata: declaring Topics without being Listed does nothing, and a Listed Drive with no
Topics is still searchable by title, description, and Keywords. Never applies to `hyper://private/`,
the Vault, or a Root Drive.
_Avoid_: published (see Publish), indexed, public (unqualified), discoverable

**Topic**:
A browsable category a Drive declares in its `/index.json` to be listed under for public discovery.
The unit search is scoped by: a user browses or searches *within* a Topic. Treated as an exact-match
facet by an indexer, so a Drive declares at most five, written as lowercase hyphenated slugs (any
script) so independent indexers agree on the same shelves without a registry. Distinct from a
Keyword (a search aid, not a category) and from a Hyperswarm announce topic (a transport
rendezvous, ADR-0014).
_Avoid_: tag, category, channel, hashtag

**Keyword**:
A free-text term an author adds to a Drive's `/index.json` to improve search matching; matched
alongside title and description when searching, capped at 12 per Drive. Declaring a Keyword does not
list the Drive under any Topic.
_Avoid_: tag, search term, meta keyword

### User model

**Space**:
A named user context with its own Root Drive and browser session isolation (separate cookies, localStorage, and Electron partition). The user can have multiple Spaces; one is active at a time. Spaces belong to a Vault.
_Avoid_: profile, account, identity, workspace

**Vault**:
The private, identity-level Collaborative Drive that indexes a single user's Spaces (by Root Drive key) and trusted Devices, and holds that user's in-flight Drafts. It is the root of trust for multi-device: every Device the user owns is a Writer of the Vault, and a new Device joins by pairing into it. Because every Device already writes the Vault, it is also where Drafts live so they sync privately across a user's Devices. Distinct from a Space — the Vault is the parent that ties one user's Spaces and Devices together.
_Avoid_: account, identity, profile, keyring, sync base

**Device**:
A single installation of Nomad holding its own keypair. A user's trusted Devices are all Writers of that user's Vault and of every Drive the Vault indexes, so any Device can edit anything the user owns. A Device is added by pairing into the Vault (see Writer Keys).
_Avoid_: machine, client, peer, node, seat
