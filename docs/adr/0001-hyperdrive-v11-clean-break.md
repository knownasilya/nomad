# Hyperdrive v11 with clean break — no v10 data migration

We are migrating from Hyperdrive v10 (via the Hyperspace daemon) to Hyperdrive v11 running in-process with Corestore + Hyperswarm v4. Existing v10 drives stored in `~/.hyperspace` or `~/.hyperdrive` are not migrated and will not be accessible after the upgrade. Users start fresh.

## Why

Hyperdrive v11 dropped the `metadata`/`content` core split, mounts, and the manifest concept — the on-disk format is incompatible with v10. Writing a reliable bidirectional migration for arbitrary user drives is at least as large as the migration itself, and the social-graph features built on v10 mounts (follow graph, address book) were inherited from Beaker and are not active Nomad features. The user base is small enough that a clean break is the pragmatic choice.

## Considered options

A compatibility read path (load v10 drives as read-only while writing new content to v11) was considered but rejected: it would require maintaining both the Hyperspace daemon and the new in-process stack simultaneously, doubling the networking and storage surface during a transition period with no defined end date.
