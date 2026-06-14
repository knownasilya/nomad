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

### User model

**Space**:
A named user context with its own Root Drive and browser session isolation (separate cookies, localStorage, and Electron partition). The user can have multiple Spaces; one is active at a time.
_Avoid_: profile, account, identity, workspace
