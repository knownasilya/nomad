# Remote AI via a Device-to-Device Bridge, not the Vault

A Device without its own AI Runtime (typically mobile) can run `nomad.ai.chat()` by forwarding the
call to another of the user's Devices — the **AI Provider** — over a live **AI Bridge**, a Protomux
control channel on the shared Hyperswarm connection. The Provider runs the *entire* agentic loop
(model calls **and** the Drive tools) and streams frames back; the **AI Client** is a thin forwarder
that owns the transcript. The chat is **never** routed through the Vault's Autobase.

## Why not the Vault

The obvious "share across Devices" primitive is the Vault, since every Device already writes it. But
the Vault is an append-only, signed, eventually-consistent oplog **replicated to every Device**.
Streaming chat through it would permanently bloat the signed log, copy private chats to all Devices
forever, and offers no request/response, streaming, or cancel semantics. AI chat is a live, ephemeral,
two-Device interaction. So the Vault's role here is **discovery and trust only**; the traffic rides a
live channel — the same pattern as the existing `nomad/autobase-control` writer-request channel and
`nomad/peersocket`.

## Decisions

1. **Proxy at the `nomad.ai.chat` layer, not the AI Runtime (HTTP) layer.** The Provider runs the full
   `runChat` loop. Rejected: having the Client run the loop and borrow only the Provider's
   `/v1/chat/completions` endpoint — that forces the Client to execute the Drive tools locally, but a
   Client cannot write Drives it merely paired into (the ADR-0010 exclusive-local-core limit), so its
   agentic writes would reject on exactly the Drives a user wants to edit from their phone.

2. **Bridge keyed on the Vault topic; trust by signature challenge against the Vault Writer set.** A
   Hyperswarm connection's `remotePublicKey` is a random per-instance swarm key with no relation to a
   Device's Vault Writer key, so connection identity proves nothing. On channel open the Provider sends
   a nonce; the Client signs it with its Vault Writer keypair (`Autobase.getLocalCore`); the Provider
   verifies the signer is in the live Vault Writer set. Rejected: a Vault-key-derived shared secret —
   it proves possession of the key, not authorized membership, so a `removeWriter`-revoked Device that
   cached the key would still pass.

3. **Availability comes from the live handshake, not Vault data.** A Provider answers the Bridge only
   when its own AI Runtime is currently reachable, so "channel open + handshake" means *online and
   working* — no stale advertisement. No required Vault wire-format change (avoids touching the
   `FS_FORMAT_VERSION` golden); a device-record `capabilities` field is an optional cosmetic hint only.
   Selection when multiple Providers are online: first-available in v1; user-designated preferred
   Device later.

4. **Local-first, remote-fallback — general to all Devices.** A Device uses its own AI Runtime when
   reachable (cached check), else discovers a Provider, else shows a distinct "no AI Device online"
   state (never a hang). Mobile always falls through to a Provider; a desktop whose Ollama is down
   borrows another desktop's Runtime for free. The global-model fallback resolves against the
   **Provider's** settings; Drive/Space-level AI Config comes from the replicated Drive and is
   identical on both.

5. **The Bridge is stateless; the Client owns the transcript.** Each `request` frame ships the full
   message history (the Prompt Session already lives in the Client's localStorage). The Provider runs
   one turn and forgets — a Provider crash loses nothing, and no chat history is persisted anywhere but
   the Client.

6. **Consent always relays to the Client; write capability splits owned-now vs. approval-later.** The
   `modifyDrive` consent prompt fires on whichever Device runs the chat — remoted, that is the Provider,
   which may be unattended and is editing the *Client user's* Drive, so the prompt is relayed back over
   the Bridge to the Client (a new reverse-direction frame). Write capability then splits: writes to
   **Provider-owned Drives** work in v1; writes to **Client-owned / paired-into Drives** are **stubbed**
   with a clear rejection in v1 and unlocked later by the ADR-0010 per-Drive-device-writer-key fix
   (the owner Device approves granting the Provider a per-Drive writer key). Held all remote writes
   until that fix would make the write story uniform but blocks the common case for the hardest unsolved
   piece — rejected in favor of shipping the common case now.

7. **Provider sharing is opt-in (default off).** Although a requesting Device is already a Vault Writer
   that can edit everything the user owns — so serving inference is not a new trust escalation — a
   Provider may point `ai_base_url` at a metered API or run local inference that drains a laptop. So
   sharing is off until enabled by a `Settings → AI` toggle, and a serving indicator shows when the
   Device is actively answering a Client.

## Consequences

- **New shared Bridge protocol** (frame codec in `shared/`, matched byte-for-byte across `app` and
  `mobile` like `fs-core.mjs`): auth handshake, then `request` → `chunk` / `tool` /
  (reverse) `prompt` ↔ `promptResult` → terminal `done` | `error`, plus `cancel`; request-id
  multiplexed over one channel.
- **`runChat` gains an `AbortSignal`** (none today) threaded into `streamCompletion` and the tool loop;
  a `cancel` frame or channel close fires it. A cancel stops future work but does **not** auto-revert a
  Checkpoint the turn already wrote — the existing revert UI covers that.
- **Remote requests need a synthetic `sender`** whose `getURL()` returns the Client's `driveUrl` (for
  AI Config resolution) and whose permission requests route over the Bridge instead of a local prompt.
- **Mobile RN⇄Bare RPC needs a streaming variant** (`RPC_NOMAD_RESULT` is single-reply today) and must
  **not** apply the fixed 15s `fsCall` timeout to AI streams — use an idle/heartbeat timeout.
- Bridge traffic rides the **Noise-encrypted** Hyperswarm connection, so chat never crosses the wire in
  plaintext and — combined with Provider statelessness — never lands on disk except in the Client's own
  localStorage.
- **Keep the three AI surfaces in sync** (per CLAUDE.md): any `nomad.ai.chat` signature/opts change
  touches `bg/ai.ts`, `fg/ai.ts`, and the external `ai` manifest.
