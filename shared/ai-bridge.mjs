// nomad/shared/ai-bridge.mjs
//
// The canonical wire protocol for the AI Bridge (ADR-0013), shared byte-for-byte by BOTH
// runtimes: the desktop app (app/bg/hyper/ai-bridge.js) and the mobile backend
// (mobile/backend/lib/ai-bridge.mjs). Like fs-core.mjs this module has NO bare imports —
// the app and mobile keep separate node_modules and run on two engines, so each side imports
// this by relative path and injects its own already-resolved deps (`b4a`, and a
// hypercore-crypto-shaped `crypto` with sign/verify/randomBytes). See fs-core.mjs for the
// full rationale on dependency injection + version parity.
//
// The Bridge is a single Protomux channel (protocol `nomad/ai-bridge`) carrying JSON frames.
// It is request/response + streaming and holds NO persisted state: the AI Client owns the
// transcript and ships the full message history in every `request` frame; the AI Provider runs
// one turn and forgets (ADR-0013 §5).
//
// ── Lifecycle over one channel ────────────────────────────────────────────────
//   Client → HELLO { v }
//   Provider → CHALLENGE { nonce }              (only if opted in to serve; else UNAVAILABLE)
//   Client → AUTH { deviceKey, signature }      (signature over the nonce by the Vault writer key)
//   Provider → READY { model } | DENIED { reason }
//   Client → REQUEST { id, messages, opts }     (id-multiplexed; several may be in flight)
//   Provider → CHUNK { id, text } | TOOL { id, event }
//   Provider → PROMPT { id, permission } ↔ Client → PROMPT_RESULT { id, allow }   (reverse consent)
//   Provider → DONE { id } | ERROR { id, message }   (terminal for that id)
//   Client → CANCEL { id }                      (abort an in-flight turn)
// ──────────────────────────────────────────────────────────────────────────────

export const AI_BRIDGE_PROTOCOL = 'nomad/ai-bridge';
export const AI_BRIDGE_VERSION = 1;

// Frame type tags. Kept as short string constants so both runtimes reference the same names.
export const FRAME = Object.freeze({
  HELLO: 'hello',
  CHALLENGE: 'challenge',
  AUTH: 'auth',
  READY: 'ready',
  DENIED: 'denied',
  UNAVAILABLE: 'unavailable',
  REQUEST: 'request',
  CHUNK: 'chunk',
  TOOL: 'tool',
  PROMPT: 'prompt',
  PROMPT_RESULT: 'promptResult',
  DONE: 'done',
  ERROR: 'error',
  CANCEL: 'cancel',
  HEARTBEAT: 'heartbeat', // Provider → Client keepalive while a turn is in flight (model load / slow first token)
});

// The single Protomux message slot carries these frames as JSON bytes. Encode/decode are the
// ONLY place the wire bytes are produced, so both runtimes stay in lockstep.
export function encodeFrame(b4a, frame) {
  return b4a.from(JSON.stringify(frame));
}

// Returns the parsed frame, or null on malformed input (a peer must never crash the channel on
// a bad frame — it drops it, exactly like the autobase-control channel).
export function decodeFrame(b4a, buf) {
  try {
    const obj = JSON.parse(b4a.toString(buf));
    if (obj && typeof obj.t === 'string') return obj;
    return null;
  } catch {
    return null;
  }
}

// Auth handshake (ADR-0013 §2): the Provider proves nothing; the Client proves it is a member
// of the Provider's Vault writer set by signing a fresh Provider-issued nonce with its Vault
// writer keypair (the same `local` core keypair it registered during pairing). A random
// public-Drive peer can open the channel but cannot produce this signature.

// Provider side: mint a fresh challenge. `nonce` is raw bytes; `nonceHex` travels in the frame.
export function makeChallenge(crypto, bytes = 32) {
  const nonce = crypto.randomBytes(bytes);
  return { nonce, nonceHex: bufToHex(nonce) };
}

// Client side: sign the Provider's nonce with this Device's Vault writer secret key.
export function signChallenge(crypto, b4a, nonceHex, secretKey) {
  const nonce = b4a.from(nonceHex, 'hex');
  return bufToHex(crypto.sign(nonce, secretKey));
}

// Provider side: verify the Client's signature over the nonce WE issued, by the public key it
// claims (`deviceKeyHex`). Membership (deviceKeyHex ∈ Vault writer set) is checked separately by
// the caller — this only proves the peer holds that key's secret.
export function verifyChallenge(crypto, b4a, nonceHex, signatureHex, deviceKeyHex) {
  try {
    const nonce = b4a.from(nonceHex, 'hex');
    const sig = b4a.from(signatureHex, 'hex');
    const pub = b4a.from(deviceKeyHex, 'hex');
    if (sig.length !== 64 || pub.length !== 32) return false;
    return crypto.verify(nonce, sig, pub);
  } catch {
    return false;
  }
}

function bufToHex(buf) {
  // b4a-agnostic: Buffer/Uint8Array both work with this. Avoids importing b4a just for hex.
  let s = '';
  for (let i = 0; i < buf.length; i++) s += buf[i].toString(16).padStart(2, '0');
  return s;
}
