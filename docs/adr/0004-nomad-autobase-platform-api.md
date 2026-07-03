# nomad.autobase as a first-class platform API with Collaborative Drive shape

Multi-writer collaboration is exposed via a new `nomad.autobase` platform API. The primary abstraction is a **Collaborative Drive** — an Autobase-backed drive whose API mirrors `nomad.hyperdrive`. Writer management (`inviteWriter`, `addWriter`) is part of the API, not left to templates or shell UI.

## Why

Drive apps run in a sandboxed context and cannot import npm modules. Autobase must be a platform-provided global to be usable in templates. The Collaborative Drive shape was chosen over a raw Autobase wrapper so that template authors work with a familiar API — a multi-user wiki is a near-drop-in rewrite of a single-user drive app. Nomad owning the writer invitation handshake prevents every multi-user template from reimplementing the same Autobase acknowledgment protocol.

## Considered options

- Raw Autobase wrapper (`nomad.autobase.create(bootstrapKey, { apply, open })`): rejected because it requires template authors to understand Autobase internals and diverges from the `nomad.hyperdrive` API shape.
- Shell UI-managed writers: rejected because it makes templates passive — they cannot drive their own collaboration model.
- Template-vendored Autobase (bundled script): rejected as a dead end — every collaborative app would vendor the same library with no shared upgrade path.
