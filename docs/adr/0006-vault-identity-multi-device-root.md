# The Vault: an identity-level Autobase as the root of multi-device sync

Multi-device support is rooted in a new top-level primitive, the **Vault**: a private, identity-level Collaborative Drive (Autobase) that indexes a user's Spaces (by Root Drive key) and trusted Devices (by writer key). A new Device joins by pairing into the Vault using Holepunch's `blind-pairing` (encrypted, signed invite + explicit approval on an existing Device). Once joined, the Device is added as a Writer to the Vault and, eagerly, to every Space Root Drive the Vault indexes — so any Device can edit anything the user owns. Vault creation and the Root-Drive→Autobase migration happen lazily, the first time the user links a Device.

## Why

Spaces are stored only in local SQLite today, so a freshly-paired Device has no way to discover the user's Spaces, and a Space created later on one Device would never reach the others. Something identity-level, multi-writer, and synced has to be the discovery root and the trust anchor. Making it an Autobase reuses the existing Collaborative Drive machinery (ADR-0004) and gives `writer-keys.json` and Device metadata/revocation a natural home. Doing the migration lazily on first link means single-device users — the majority — never pay the cost of a risky mass migration.

## Considered options

- One-shot transfer of Space keys at pair time, no persistent index: rejected because Spaces created after pairing don't propagate, so Devices drift out of sync and need a second sync path anyway.
- Promote the Personal Space's Root Drive to hold the registry: rejected because it couples identity-global state to one Space and erodes the Space boundary.
- Eager migration for all users on app upgrade: rejected as a risky one-time mass migration that touches data even for users who never link a second Device.
- Reuse the homegrown token-over-Protomux invite flow instead of `blind-pairing`: rejected because this handshake is the root of edit-everything trust and warrants the security-reviewed, Keet-proven path.

## Consequences

- Converting a Root Drive to an Autobase changes its `hyper://` key; the local `spaces.root_drive_url` and `/drives.json` references must be rewritten in the same migration.
- Device removal (`removeWriter` across the Vault and all indexed drives) stops future writes but cannot retroactively un-share already-replicated data; the UI must say so plainly rather than imply forward secrecy.
