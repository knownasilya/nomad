# walled.garden schema namespace

Nomad uses `walled.garden` as the namespace for its social data schemas rather than `unwalled.garden`.

## Why

`unwalled.garden` was an external project by Paul Frazee designed around a crawler-based social network on the Dat protocol. Nomad's schema layer is inspired by that design but is not compatible with it — the storage conventions differ (no enforced `/.data/` path), the schemas have evolved, and the underlying protocol is Hypercore v11 rather than Dat. Inheriting the `unwalled.garden` namespace would imply compatibility guarantees that don't exist and create confusion for developers expecting the original semantics.

## Considered options

- Keep `unwalled.garden`: rejected because it implies compatibility with pfrazee's original spec, which no code in Nomad implements.
- Use a Nomad-specific prefix (e.g. `nomad/`): rejected because schema types are meant to be interoperable across apps, not tied to a single shell.
- Use `walled.garden`: chosen because it signals the relationship to the original concept while making clear this is a distinct, independently-evolved namespace.
