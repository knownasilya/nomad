# beaker.hyperdrive redesigned to match Hyperdrive v11 — no compatibility shim

The `beaker.hyperdrive` API exposed to drive apps is redesigned to match Hyperdrive v11's native API (`get`, `put`, `del`, `list`, `entry`) rather than wrapping v11 behind the old `stat`/`readFile`/`writeFile`/`readdir` surface.

## Why

Maintaining a shim that faithfully emulates `stat()`, `diff()`, and `createNetworkActivityStream()` on top of v11 is nearly as much work as a direct rewrite, and it leaves a bespoke abstraction to maintain indefinitely. V11's API is simpler — call sites get shorter, not longer. The user base is new enough that a clean API break is acceptable. Templates and docs are being rewritten in parallel.

## Considered options

A compatibility layer (`pauls-dat-api2`-shaped adapter over v11) was considered and rejected. The old API's `stat.mount`, `stat.isDirectory()`, and mount-traversal queries have no v11 equivalent, so the shim would have needed to invent semantics rather than just remap method names.
