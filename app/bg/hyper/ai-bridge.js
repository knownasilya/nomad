// @ts-nocheck
//
// The AI Bridge (ADR-0013): a live, authenticated Device-to-Device channel that lets an AI
// Client (a Device with no reachable AI Runtime — typically mobile) run nomad.ai.chat() on
// another of the user's Devices — the AI Provider — over the shared Hyperswarm connection.
//
// It is a Protomux channel (protocol `nomad/ai-bridge`) layered onto the same swarm connections
// used for replication — the exact pattern as the writer-request control channel in
// autobases.js and peersockets. The chat NEVER travels through the Vault's Autobase (that would
// bloat the signed oplog and replicate private chats to every Device); the Vault is used only
// for trust (the channel is keyed on the Vault key, and the Client authenticates by signing a
// challenge with its Vault writer keypair — the Vault writer set is the security boundary).
//
// This module is pure transport + the auth state machine. It imports nothing from web-apis to
// avoid a cycle: the serve handler (which drives runChat) is registered via setServeChat() by
// bg/web-apis/bg/ai.ts, and the Client-side callbacks (onChunk/onTool/onPrompt) are supplied by
// the caller. See shared/ai-bridge.mjs for the wire format.

import Protomux from 'protomux';
import c from 'compact-encoding';
import b4a from 'b4a';
import crypto from 'hypercore-crypto';
import http from 'http';
import https from 'https';
import * as logLib from '../logger';
import * as daemon from './daemon';
import * as vault from './vault';
import * as settingsDb from '../dbs/settings';
import {
  AI_BRIDGE_PROTOCOL,
  AI_BRIDGE_VERSION,
  FRAME,
  encodeFrame,
  decodeFrame,
  makeChallenge,
  signChallenge,
  verifyChallenge,
} from '../../../shared/ai-bridge.mjs';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'ai-bridge' });

// Global opt-in: a Device serves as a Provider only when the user has enabled it (ADR-0013 §7).
export const SHARE_PROVIDER_SETTING = 'ai_share_provider';

// peerId (remotePublicKey hex) -> Peer
const peers = new Map();
let installed = false;
let serveChat = null; // registered by bg/ai.ts: ({ messages, opts, signal, requestPermission, sendChunk, sendTool }) => Promise<void>

let _reqSeq = 0;
function nextReqId() {
  return 'r' + ++_reqSeq;
}

// Public API
// =

// bg/ai.ts registers the function that actually runs a turn (via runChat). Keeping runChat on the
// web-apis side means the agentic loop + tools live in exactly one place.
export function setServeChat(handler) {
  serveChat = handler;
}

// Serving as a Provider (§7 opt-in). Serving also requires a reachable local AI Runtime, checked
// per-HELLO so we never advertise availability we can't honor.
export async function isSharingEnabled() {
  return !!(await settingsDb.get(SHARE_PROVIDER_SETTING));
}

// Client entry point. Forwards one nomad.ai.chat() turn to an available Provider and streams the
// result back through the supplied callbacks. Resolves when the turn ends; rejects on a remote
// error, on no Provider being reachable, or on abort. Frames are request-id multiplexed so
// several turns can share one channel.
//   onChunk(text)            — streamed assistant text
//   onTool(event)            — tool activity (start / write Checkpoint payloads)
//   onPrompt(permission)     — reverse consent: return Promise<boolean> (this Device is where the
//                              human is, so the modifyDrive prompt is shown HERE, not on the Provider)
export async function requestRemoteChat({ messages, opts = {}, signal = null, onChunk, onTool, onPrompt }) {
  ensureInstalled();
  const peer = await pickProvider(signal);
  const id = nextReqId();

  return new Promise((resolve, reject) => {
    peer.clientReqs.set(id, { onChunk, onTool, onPrompt, resolve, reject });
    if (signal) {
      if (signal.aborted) sendFrame(peer, { t: FRAME.CANCEL, id });
      else signal.addEventListener('abort', () => sendFrame(peer, { t: FRAME.CANCEL, id }), { once: true });
    }
    // Only forward the Drive-scoping opts; signal/requestPermission are reconstructed Provider-side.
    sendFrame(peer, {
      t: FRAME.REQUEST,
      id,
      messages,
      opts: { driveUrl: opts.driveUrl || null, allowWrite: opts.allowWrite, context: opts.context || null },
    });
  }).finally(() => peer.clientReqs.delete(id));
}

// True if at least one connected peer has authenticated as a Provider and is ready. Cheap hint
// for the wiring layer; requestRemoteChat performs the real (awaited) discovery.
export function hasReadyProvider() {
  for (const peer of peers.values()) if (peer.clientState === 'ready') return true;
  return false;
}

// Internal: channel setup
// =

function ensureInstalled() {
  const swarm = daemon.getSwarm();
  if (!swarm) {
    logger.info('ai-bridge install deferred (no swarm yet)');
    return;
  }
  // Attach the connection listener once, but ALWAYS re-scan existing connections: a Device that
  // pairs (gets a Vault) AFTER connecting needs the channel opened on connections that were up
  // while getVaultKey() still returned null. openOnConn is a no-op for peers already set up.
  const conns = swarm.connections ? [...swarm.connections].length : 0;
  logger.info('ai-bridge install', { alreadyInstalled: installed, connections: conns });
  if (!installed) {
    installed = true;
    swarm.on('connection', (conn) => openOnConn(conn));
  }
  for (const conn of swarm.connections) openOnConn(conn);
}

// Called on daemon start so a Device can serve/consume without anyone calling requestRemoteChat first.
export function install() {
  ensureInstalled();
}

// MUST NOT throw: runs inside the swarm 'connection' emitter (shared with corestore replication).
// An uncaught error here would propagate into the emitter and could destabilize the swarm, so the
// whole body is guarded — on any failure the Bridge silently no-ops and replication is untouched.
async function openOnConn(conn) {
  try {
    const peerId = conn.remotePublicKey ? b4a.toString(conn.remotePublicKey, 'hex') : null;
    if (!peerId) return;

    // Key the channel on the Vault key: only the user's own Devices know it and open the matching
    // {protocol, id}, so a random public-Drive peer's mux never pairs this channel (§2a).
    const vaultKey = await vault.getVaultKey();
    if (!vaultKey) {
      logger.info('ai-bridge openOnConn: no vault key, skipping', { peerId });
      return; // no Vault on this Device yet — nothing to bridge
    }

    const mux = Protomux.from(conn);
    const idBuf = b4a.from(vaultKey, 'hex');

    // Register a pairing handler ONCE per mux so a REMOTE-initiated channel OPEN is ACCEPTED (opens
    // our side) rather than rejected. Both sides open proactively too, but their OPENs race: whichever
    // arrives before the other has opened would, without this, hit Protomux's reject path
    // (_requestSession) and close the channel. With pair() the late side accepts. Standard Protomux
    // pattern (same as corestore replication).
    if (!mux[PAIRED_FLAG]) {
      mux[PAIRED_FLAG] = true;
      mux.pair({ protocol: AI_BRIDGE_PROTOCOL, id: idBuf }, () => _openChannel(mux, peerId, idBuf));
    }
    _openChannel(mux, peerId, idBuf);
  } catch (err) {
    // swallow — never destabilize the swarm/replication for an AI-Bridge failure
    logger.warn('ai-bridge openOnConn threw', { error: err?.toString() });
  }
}

const PAIRED_FLAG = '_nomadAiBridgePaired';

function _openChannel(mux, peerId, idBuf) {
  if (peers.has(peerId)) return;
  const peer = newPeer(peerId);
  const channel = mux.createChannel({
    protocol: AI_BRIDGE_PROTOCOL,
    id: idBuf,
    messages: [{ encoding: c.buffer, onmessage: (data) => onFrame(peer, data) }],
    onopen() {
      logger.info('ai-bridge channel OPEN (paired)', { peerId });
    },
    onclose() {
      cleanupPeer(peer);
      peers.delete(peerId);
    },
  });
  if (!channel) return; // channel for this {protocol,id} already exists on the mux
  peer.channel = channel;
  peer.msg = channel.messages[0];
  peers.set(peerId, peer);
  channel.open();
  logger.info('ai-bridge opened channel', { peerId });
}

function newPeer(peerId) {
  return {
    peerId,
    channel: null,
    msg: null,
    // client role (we ask THEM to serve us)
    clientState: 'idle', // idle | authenticating | ready | denied | unavailable
    providerModel: null,
    readyWaiters: [],
    clientReqs: new Map(), // id -> { onChunk, onTool, onPrompt, resolve, reject }
    // serve role (they ask US to serve)
    authedClient: false,
    nonceHex: null,
    serveReqs: new Map(), // id -> { controller, promptResolve }
  };
}

function cleanupPeer(peer) {
  // Fail every in-flight request this peer was serving us, and abort every turn we were serving it.
  for (const req of peer.clientReqs.values()) req.reject(new Error('AI Provider disconnected'));
  peer.clientReqs.clear();
  for (const s of peer.serveReqs.values()) {
    try {
      s.controller.abort();
    } catch {}
  }
  peer.serveReqs.clear();
  for (const w of peer.readyWaiters) w(false);
  peer.readyWaiters = [];
}

function sendFrame(peer, frame) {
  try {
    peer.msg.send(encodeFrame(b4a, { v: AI_BRIDGE_VERSION, ...frame }));
  } catch (err) {
    logger.warn('ai-bridge send failed', { error: err.toString() });
  }
}

// Internal: frame dispatch
// =

function onFrame(peer, data) {
  const f = decodeFrame(b4a, data);
  if (!f) return;
  switch (f.t) {
    // --- serve role (we are the Provider) ---
    case FRAME.HELLO:
      return onHello(peer);
    case FRAME.AUTH:
      return onAuth(peer, f);
    case FRAME.REQUEST:
      return onRequest(peer, f);
    case FRAME.CANCEL:
      return onCancel(peer, f);
    case FRAME.PROMPT_RESULT:
      return onPromptResult(peer, f);
    // --- client role (we are the Client) ---
    case FRAME.CHALLENGE:
      return onChallenge(peer, f);
    case FRAME.READY:
      return onReady(peer, f, true);
    case FRAME.DENIED:
    case FRAME.UNAVAILABLE:
      return onReady(peer, f, false);
    case FRAME.CHUNK:
    case FRAME.TOOL:
    case FRAME.PROMPT:
    case FRAME.DONE:
    case FRAME.ERROR:
      return onClientStream(peer, f);
  }
}

// Serve role
// =

async function onHello(peer) {
  // Only offer to serve if opted in AND we can actually reach a local AI Runtime right now, so
  // "channel ready" always means online-and-working (§3, no stale advertisement).
  const hasHandler = !!serveChat;
  const sharing = await isSharingEnabled();
  const reachable = await localRuntimeReachable();
  logger.info('ai-bridge HELLO received', { peerId: peer.peerId, hasHandler, sharing, reachable });
  if (!hasHandler || !sharing || !reachable) {
    logger.info('ai-bridge replying UNAVAILABLE', { peerId: peer.peerId, hasHandler, sharing, reachable });
    return sendFrame(peer, { t: FRAME.UNAVAILABLE });
  }
  const { nonceHex } = makeChallenge(crypto);
  peer.nonceHex = nonceHex;
  sendFrame(peer, { t: FRAME.CHALLENGE, nonce: nonceHex });
}

async function onAuth(peer, f) {
  // The advertised deviceKey is the Client's WRITER CORE key (what's in the Vault device record).
  // For a corestore manifest core that is NOT the raw ed25519 signer that made the signature — the
  // signer lives in the core's manifest. So: (1) membership = deviceKey is a Vault device; (2) verify
  // the signature against the signer key derived from that writer core's manifest (binding the
  // signature to the specific member core). See the mobile onChallenge counterpart.
  const nonceHex = peer.nonceHex;
  peer.nonceHex = null;
  let ok = false;
  if (nonceHex && f.deviceKey && f.signature && (await isVaultMember(f.deviceKey))) {
    const signerKey = await getWriterSignerKey(f.deviceKey);
    ok = !!signerKey && verifyChallenge(crypto, b4a, nonceHex, f.signature, signerKey);
  }
  if (!ok) {
    logger.info('ai-bridge auth denied', { peerId: peer.peerId, deviceKey: f.deviceKey });
    return sendFrame(peer, { t: FRAME.DENIED, reason: 'not a Vault device' });
  }
  peer.authedClient = true;
  const model = await settingsDb.get('ai_default_model');
  logger.info('ai-bridge serving client', { peerId: peer.peerId, deviceKey: f.deviceKey });
  sendFrame(peer, { t: FRAME.READY, model: model || null });
}

// A Vault writer core key (the deviceKey) is a manifest key, not the raw signer. Open that core
// (replicated as a Vault writer) and return its manifest signer's ed25519 public key hex — the key
// the AUTH signature verifies against. Falls back to the deviceKey itself for a legacy non-manifest
// core (where key === signer publicKey).
async function getWriterSignerKey(deviceKeyHex) {
  try {
    const store = daemon.getCorestore();
    if (!store) return null;
    const core = store.get({ key: b4a.from(deviceKeyHex, 'hex') });
    await core.ready();
    const signer = core.manifest && core.manifest.signers && core.manifest.signers[0];
    return signer && signer.publicKey ? b4a.toString(signer.publicKey, 'hex') : deviceKeyHex;
  } catch (err) {
    logger.warn('ai-bridge getWriterSignerKey failed', { error: err?.toString() });
    return null;
  }
}

async function onRequest(peer, f) {
  if (!peer.authedClient) return sendFrame(peer, { t: FRAME.ERROR, id: f.id, message: 'not authenticated' });
  const id = f.id;
  const controller = new AbortController();
  const entry = { controller, promptResolve: null };
  peer.serveReqs.set(id, entry);

  // Reverse consent (§6): the modifyDrive prompt is shown on the CLIENT (where the human is), so
  // the Provider's requestPermission relays a PROMPT frame and awaits the PROMPT_RESULT.
  const requestPermission = (permission /*, sender */) =>
    new Promise((resolve) => {
      entry.promptResolve = resolve;
      sendFrame(peer, { t: FRAME.PROMPT, id, permission });
    });

  // Keepalive: remote inference can take a while to load the model / produce the first token, during
  // which no chunks flow. Ping the Client so it doesn't hit its idle timeout on a healthy-but-slow turn.
  const heartbeat = setInterval(() => sendFrame(peer, { t: FRAME.HEARTBEAT, id }), 15000);
  try {
    await serveChat({
      messages: f.messages,
      opts: f.opts || {},
      signal: controller.signal,
      requestPermission,
      sendChunk: (text) => sendFrame(peer, { t: FRAME.CHUNK, id, text }),
      sendTool: (event) => sendFrame(peer, { t: FRAME.TOOL, id, event }),
    });
    sendFrame(peer, { t: FRAME.DONE, id });
  } catch (err) {
    logger.warn('ai-bridge serve error', { id, error: err?.toString() });
    sendFrame(peer, { t: FRAME.ERROR, id, message: err?.message || 'AI error' });
  } finally {
    clearInterval(heartbeat);
    peer.serveReqs.delete(id);
  }
}

function onCancel(peer, f) {
  const entry = peer.serveReqs.get(f.id);
  if (entry) {
    try {
      entry.controller.abort();
    } catch {}
  }
}

function onPromptResult(peer, f) {
  const entry = peer.serveReqs.get(f.id);
  if (entry?.promptResolve) {
    const resolve = entry.promptResolve;
    entry.promptResolve = null;
    resolve(!!f.allow);
  }
}

// Client role
// =

async function onChallenge(peer, f) {
  try {
    const { deviceKey, secretKey } = await getLocalSigning();
    if (!deviceKey || !secretKey) throw new Error('no local writer key');
    const signature = signChallenge(crypto, b4a, f.nonce, secretKey);
    sendFrame(peer, { t: FRAME.AUTH, deviceKey, signature });
  } catch (err) {
    logger.warn('ai-bridge client sign failed', { error: err?.toString() });
    settleReady(peer, false);
  }
}

function onReady(peer, f, ok) {
  peer.clientState = ok ? 'ready' : f.t === FRAME.UNAVAILABLE ? 'unavailable' : 'denied';
  peer.providerModel = ok ? f.model || null : null;
  settleReady(peer, ok);
}

function onClientStream(peer, f) {
  const req = peer.clientReqs.get(f.id);
  if (!req) return;
  switch (f.t) {
    case FRAME.CHUNK:
      return req.onChunk?.(f.text);
    case FRAME.TOOL:
      return req.onTool?.(f.event);
    case FRAME.PROMPT:
      // Show the consent prompt locally and relay the answer back.
      return Promise.resolve(req.onPrompt ? req.onPrompt(f.permission) : false)
        .then((allow) => sendFrame(peer, { t: FRAME.PROMPT_RESULT, id: f.id, allow: !!allow }))
        .catch(() => sendFrame(peer, { t: FRAME.PROMPT_RESULT, id: f.id, allow: false }));
    case FRAME.DONE:
      return req.resolve();
    case FRAME.ERROR:
      return req.reject(new Error(f.message || 'AI error'));
  }
}

// Client-side handshake helpers
// =

// Authenticate to every connected peer that hasn't been tried, and resolve to the first Provider
// that becomes ready. Throws if none is reachable within the window.
async function pickProvider(signal) {
  ensureInstalled();
  const candidates = [...peers.values()];
  if (!candidates.length) throw noProviderError();

  const attempts = candidates.map((peer) => ensureClientReady(peer).then((ok) => (ok ? peer : null)));
  // Resolve as soon as one succeeds; otherwise wait for all to settle.
  const ready = await firstTruthy(attempts, signal);
  if (!ready) throw noProviderError();
  return ready;
}

function ensureClientReady(peer) {
  if (peer.clientState === 'ready') return Promise.resolve(true);
  if (peer.clientState === 'denied' || peer.clientState === 'unavailable') return Promise.resolve(false);
  return new Promise((resolve) => {
    peer.readyWaiters.push(resolve);
    if (peer.clientState === 'idle') {
      peer.clientState = 'authenticating';
      sendFrame(peer, { t: FRAME.HELLO });
      // Don't hang forever if the peer never answers (e.g. old build without the Bridge).
      setTimeout(() => settleReady(peer, false), 10000);
    }
  });
}

function settleReady(peer, ok) {
  if (!ok && peer.clientState === 'authenticating') peer.clientState = 'unavailable';
  const waiters = peer.readyWaiters;
  peer.readyWaiters = [];
  for (const w of waiters) w(peer.clientState === 'ready' ? true : ok);
}

// Resolve to the first attempt that yields a truthy value; null if all are falsy. Respects abort.
function firstTruthy(promises, signal) {
  return new Promise((resolve) => {
    let remaining = promises.length;
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    if (signal) signal.addEventListener('abort', () => finish(null), { once: true });
    for (const p of promises) {
      p.then((v) => {
        if (v) finish(v);
        else if (--remaining === 0) finish(null);
      }).catch(() => {
        if (--remaining === 0) finish(null);
      });
    }
  });
}

// Trust + runtime helpers
// =

// This Device's Vault writer keypair — the identity it registered during pairing. The secret key
// lives on the live writable local core (hypercore@11 exposes core.keyPair); we sign the
// Provider's nonce with it. deviceKey (hex public key) == the key in /.vault/devices/<key>.json.
async function getLocalSigning() {
  const sess = await vault.getVault();
  const kp = sess?.base?.local?.keyPair;
  if (!kp?.secretKey) return { deviceKey: null, secretKey: null };
  return { deviceKey: b4a.toString(kp.publicKey, 'hex'), secretKey: kp.secretKey };
}

// Membership = the deviceKey is a Device of this Vault. addDevice/removeDevice keep the device
// records and the Autobase writer set in lockstep, so the records are an accurate membership list;
// a revoked Device (removeWriter) also loses its record, so it fails here on its next handshake.
async function isVaultMember(deviceKeyHex) {
  try {
    const devices = await vault.listDevices();
    const ok = devices.some((d) => d.key === deviceKeyHex);
    logger.info('ai-bridge isVaultMember', {
      checking: deviceKeyHex,
      known: devices.map((d) => d.key),
      match: ok,
    });
    return ok;
  } catch (err) {
    logger.warn('ai-bridge isVaultMember failed', { error: err?.toString() });
    return false;
  }
}

let _reachCache = { at: 0, ok: false, baseUrl: null };
// Cheap, cached probe of the local AI Runtime so onHello doesn't hammer it (§4 cached check).
// Exported so the routing layer (bg/ai.ts) makes the SAME local-first decision from one probe.
// Uses Node http/https (NOT global fetch): in the Electron main process global fetch routes through
// Chromium's network stack and commonly fails on http://localhost, so the whole codebase avoids it
// (see fetchJson in bg/ai.ts). Using fetch here made this always-false → the Provider replied
// UNAVAILABLE to every Client → "No AI Device is online".
export async function localRuntimeReachable() {
  const baseUrl = (await settingsDb.get('ai_base_url')) || 'http://localhost:11434/v1';
  const now = Date.now();
  if (_reachCache.baseUrl === baseUrl && now - _reachCache.at < 15000) return _reachCache.ok;
  const ok = await _probeRuntime(baseUrl);
  _reachCache = { at: now, ok, baseUrl };
  return ok;
}

function _probeRuntime(baseUrl) {
  return new Promise((resolve) => {
    try {
      const endpoint = baseUrl.replace(/\/$/, '') + '/models';
      const proto = new URL(endpoint).protocol === 'https:' ? https : http;
      const req = proto.get(endpoint, (res) => {
        res.resume(); // drain
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2500, () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

function noProviderError() {
  const err = new Error('No AI Device is online');
  err.name = 'NoAiProviderError';
  return err;
}
