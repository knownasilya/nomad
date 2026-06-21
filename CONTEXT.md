# Nomad

A peer-to-peer browser built on Hypercore Protocol. Users author and browse content stored in Drives, distributed over Hyperswarm without central servers.

## Language

### Core data

**Drive**:
A Hyperdrive v11 content store identified by a public key. The atomic unit of P2P data in Nomad. Each Drive is owned by exactly one keypair; other peers replicate it read-only.
_Avoid_: hyperdrive, site, archive, dat

**Root Drive**:
The Drive backing a Space. Contains `/drives.json` and any user-created content for that Space. Created automatically when a Space is first used.
_Avoid_: home drive, profile drive, user drive

**Drive Registry**:
The `/drives.json` file inside a Space's Root Drive. Lists the Drive keys the Space knows about.
_Avoid_: drive list, drive catalog, drive index

**Collaborative Drive**:
A multi-writer Drive backed by Autobase. Multiple Writers can append to it; reads are linearised across all writers. Exposed via `beaker.autobase`; API shape mirrors `beaker.hyperdrive`.
_Avoid_: shared drive, multi-user drive, autobase drive

**Writer**:
A keypair that has been granted append access to a Collaborative Drive. Writers are added explicitly via `inviteWriter` / `addWriter`; they are not inferred from replication.
_Avoid_: author, contributor, collaborator

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

**AI Config**:
The `/ai/` folder inside a Drive, containing `system.md` (the system prompt) and optionally a `tools/` directory. A Drive has an AI Config when it includes this folder. Any Drive can opt into AI behaviour by adding an `ai` key to its `/index.json` — either an inline object `{ "model": "..." }` or a pointer string `"hyper://..."` delegating to another Drive's AI Config.
_Avoid_: agent config, AI settings, model config

**Chat Bubble**:
A floating chat overlay Nomad injects into a Drive page when `"chatBubble": true` is set in the Drive's `/index.json`. The overlay is provided entirely by Nomad (a Lit custom element injected via the main process); the Drive author does not need to write any chat UI code. The bubble uses `beaker.ai.chat()` resolved against the same Drive's AI Config.
_Avoid_: chat widget, chat overlay, embedded chat

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

### User model

**Space**:
A named user context with its own Root Drive and browser session isolation (separate cookies, localStorage, and Electron partition). The user can have multiple Spaces; one is active at a time. Spaces belong to a Vault.
_Avoid_: profile, account, identity, workspace

**Vault**:
The private, identity-level Collaborative Drive that indexes a single user's Spaces (by Root Drive key) and trusted Devices. It is the root of trust for multi-device: every Device the user owns is a Writer of the Vault, and a new Device joins by pairing into it. Distinct from a Space — the Vault is the parent that ties one user's Spaces and Devices together.
_Avoid_: account, identity, profile, keyring, sync base

**Device**:
A single installation of Nomad holding its own keypair. A user's trusted Devices are all Writers of that user's Vault and of every Drive the Vault indexes, so any Device can edit anything the user owns. A Device is added by pairing into the Vault (see Writer Keys).
_Avoid_: machine, client, peer, node, seat
