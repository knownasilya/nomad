// Mobile side of the AI Bridge (ADR-0013) — the AI Client half.
//
// Mobile has no local AI Runtime, so it runs nomad.ai.chat() by forwarding the turn to another of
// the user's Devices (the AI Provider — typically the desktop) over a Protomux channel on the
// shared Hyperswarm connection, and streaming the result back. This mirrors the desktop client in
// app/bg/hyper/ai-bridge.js and shares the SAME wire format via shared/ai-bridge.mjs (cross-engine
// parity is guarded by tests/unit/ai-bridge.test.js). Mobile is client-ONLY: it never serves (no
// Runtime), so an inbound HELLO is answered UNAVAILABLE.
//
// Factory-style (not a singleton): the Vault is late-bound (assigned on pairing), so the backend
// passes a `getVault` accessor that returns the current Vault Autobase (or null) at call time.

import Protomux from 'protomux'
import c from 'compact-encoding'
import b4a from 'b4a'
import crypto from 'hypercore-crypto'
import {
  AI_BRIDGE_PROTOCOL,
  AI_BRIDGE_VERSION,
  FRAME,
  encodeFrame,
  decodeFrame,
  signChallenge
} from '../../../shared/ai-bridge.mjs'

const PAIRED_FLAG = '_nomadAiBridgePaired'

export function createAiBridge ({ swarm, getVault }) {
  const peers = new Map() // peerId hex -> Peer
  let installed = false
  let reqSeq = 0
  const nextReqId = () => 'm' + (++reqSeq)

  // Idempotent. Attaches the connection listener once, but ALWAYS re-scans existing connections so
  // that calling install() again after the Vault opens (pairing completes) opens the channel on
  // connections that were already up when getVault() still returned null. openOnConn is a no-op for
  // peers we've already set up.
  function install () {
    if (!swarm) return
    if (!installed) {
      installed = true
      swarm.on('connection', (conn) => openOnConn(conn))
    }
    for (const conn of swarm.connections) openOnConn(conn)
  }

  // MUST NOT throw: this runs inside the swarm 'connection' emitter, shared with corestore
  // replication. An uncaught error here would propagate into the emitter and can crash the Bare
  // worklet, which RN then restarts → reconnect → re-crash (an emulator-locking loop). So the whole
  // body is guarded; on any failure the Bridge silently no-ops and replication is untouched.
  function openOnConn (conn) {
    try {
      const peerId = conn.remotePublicKey ? b4a.toString(conn.remotePublicKey, 'hex') : null
      if (!peerId) return
      const vault = getVault()
      if (!vault || !vault.key) return // not paired yet — nothing to bridge

      const mux = Protomux.from(conn)
      const idBuf = vault.key // Buffer; desktop keys on the same 32 bytes (b4a.from(vaultKeyHex,'hex'))

      // Register a pairing handler ONCE per mux so a REMOTE-initiated OPEN is ACCEPTED instead of
      // rejected. Both sides also open proactively, but their OPENs race — whichever arrives before
      // the other has opened would otherwise hit Protomux's reject path and close the channel. This
      // is the exact bug behind the "channel CLOSED / no reply from provider" symptom.
      if (!mux[PAIRED_FLAG]) {
        mux[PAIRED_FLAG] = true
        mux.pair({ protocol: AI_BRIDGE_PROTOCOL, id: idBuf }, () => openChannel(mux, peerId, idBuf))
      }
      openChannel(mux, peerId, idBuf)
    } catch {
      // swallow — never destabilize the swarm/replication for an AI-Bridge failure
    }
  }

  function openChannel (mux, peerId, idBuf) {
    if (peers.has(peerId)) return
    const peer = newPeer(peerId)
    const channel = mux.createChannel({
      protocol: AI_BRIDGE_PROTOCOL,
      id: idBuf,
      messages: [{ encoding: c.buffer, onmessage: (data) => onFrame(peer, data) }],
      onopen () {
        console.log('[ai-bridge] channel OPEN (paired) with', peerId.slice(0, 8))
      },
      onclose () {
        console.log('[ai-bridge] channel CLOSED with', peerId.slice(0, 8))
        cleanupPeer(peer)
        peers.delete(peerId)
      }
    })
    if (!channel) return // channel for this {protocol,id} already exists on the mux
    console.log('[ai-bridge] opened channel to', peerId.slice(0, 8))
    peer.channel = channel
    peer.msg = channel.messages[0]
    peers.set(peerId, peer)
    channel.open()
  }

  function newPeer (peerId) {
    return {
      peerId,
      channel: null,
      msg: null,
      clientState: 'idle', // idle | authenticating | ready | denied | unavailable
      providerModel: null,
      readyWaiters: [],
      clientReqs: new Map() // id -> { onChunk, onTool, onPrompt, resolve, reject }
    }
  }

  function cleanupPeer (peer) {
    for (const req of peer.clientReqs.values()) req.reject(new Error('AI Provider disconnected'))
    peer.clientReqs.clear()
    for (const w of peer.readyWaiters) w(false)
    peer.readyWaiters = []
  }

  function sendFrame (peer, frame) {
    try {
      peer.msg.send(encodeFrame(b4a, { v: AI_BRIDGE_VERSION, ...frame }))
    } catch {}
  }

  // Client entry point. Forwards one turn to an available Provider; resolves on done, rejects on a
  // remote error / no Provider / abort. onChunk/onTool stream results; onPrompt(permission) shows
  // the relayed modifyDrive consent HERE (this Device is where the human is) and returns Promise<bool>.
  async function requestRemoteChat ({ messages, opts = {}, signal = null, onChunk, onTool, onPrompt, onHeartbeat }) {
    install()
    const peer = await pickProvider(signal)
    const id = nextReqId()
    return new Promise((resolve, reject) => {
      peer.clientReqs.set(id, { onChunk, onTool, onPrompt, onHeartbeat, resolve, reject })
      if (signal) {
        if (signal.aborted) sendFrame(peer, { t: FRAME.CANCEL, id })
        else signal.addEventListener('abort', () => sendFrame(peer, { t: FRAME.CANCEL, id }), { once: true })
      }
      sendFrame(peer, {
        t: FRAME.REQUEST,
        id,
        messages,
        opts: { driveUrl: opts.driveUrl || null, allowWrite: opts.allowWrite, context: opts.context || null }
      })
    }).finally(() => peer.clientReqs.delete(id))
  }

  function onFrame (peer, data) {
    const f = decodeFrame(b4a, data)
    if (!f) return
    switch (f.t) {
      case FRAME.HELLO:
        return sendFrame(peer, { t: FRAME.UNAVAILABLE }) // mobile has no Runtime — never serves
      case FRAME.CHALLENGE:
        return onChallenge(peer, f)
      case FRAME.READY:
        return onReady(peer, f, true)
      case FRAME.DENIED:
      case FRAME.UNAVAILABLE:
        return onReady(peer, f, false)
      case FRAME.CHUNK:
      case FRAME.TOOL:
      case FRAME.PROMPT:
      case FRAME.DONE:
      case FRAME.ERROR:
      case FRAME.HEARTBEAT:
        return onClientStream(peer, f)
    }
  }

  function onChallenge (peer, f) {
    try {
      const vault = getVault()
      const kp = vault?.local?.keyPair
      if (!kp?.secretKey || !vault?.local?.key) throw new Error('no local writer key')
      // Advertise the WRITER CORE key (what's in this Device's Vault record), but sign with the core's
      // signer secret. For a corestore manifest core these differ: local.key is the manifest key (the
      // membership id) and kp.publicKey is the signer the desktop derives from the core's manifest to
      // verify this signature.
      const deviceKey = b4a.toString(vault.local.key, 'hex')
      const signature = signChallenge(crypto, b4a, f.nonce, kp.secretKey)
      sendFrame(peer, { t: FRAME.AUTH, deviceKey, signature })
    } catch {
      settleReady(peer, false)
    }
  }

  function onReady (peer, f, ok) {
    peer.clientState = ok ? 'ready' : f.t === FRAME.UNAVAILABLE ? 'unavailable' : 'denied'
    peer.providerModel = ok ? f.model || null : null
    console.log('[ai-bridge] provider', peer.peerId.slice(0, 8), '->', peer.clientState, 'model', peer.providerModel, f.reason ? '(' + f.reason + ')' : '')
    settleReady(peer, ok)
  }

  function onClientStream (peer, f) {
    const req = peer.clientReqs.get(f.id)
    if (!req) return
    switch (f.t) {
      case FRAME.CHUNK:
        return req.onChunk && req.onChunk(f.text)
      case FRAME.TOOL:
        return req.onTool && req.onTool(f.event)
      case FRAME.PROMPT:
        return Promise.resolve(req.onPrompt ? req.onPrompt(f.permission) : false)
          .then((allow) => sendFrame(peer, { t: FRAME.PROMPT_RESULT, id: f.id, allow: !!allow }))
          .catch(() => sendFrame(peer, { t: FRAME.PROMPT_RESULT, id: f.id, allow: false }))
      case FRAME.HEARTBEAT:
        return req.onHeartbeat && req.onHeartbeat()
      case FRAME.DONE:
        return req.resolve()
      case FRAME.ERROR:
        return req.reject(new Error(f.message || 'AI error'))
    }
  }

  async function pickProvider (signal) {
    install()
    const candidates = [...peers.values()]
    console.log('[ai-bridge] pickProvider: candidates', candidates.length, 'swarm conns', swarm?.connections ? [...swarm.connections].length : 0)
    if (!candidates.length) throw noProviderError()
    const attempts = candidates.map((peer) => ensureClientReady(peer).then((ok) => (ok ? peer : null)))
    const ready = await firstTruthy(attempts, signal)
    console.log('[ai-bridge] pickProvider: ready?', !!ready)
    if (!ready) throw noProviderError()
    return ready
  }

  function ensureClientReady (peer) {
    if (peer.clientState === 'ready') return Promise.resolve(true)
    if (peer.clientState === 'denied' || peer.clientState === 'unavailable') return Promise.resolve(false)
    return new Promise((resolve) => {
      peer.readyWaiters.push(resolve)
      if (peer.clientState === 'idle') {
        peer.clientState = 'authenticating'
        console.log('[ai-bridge] sent HELLO to', peer.peerId.slice(0, 8))
        sendFrame(peer, { t: FRAME.HELLO })
        setTimeout(() => {
          if (peer.clientState === 'authenticating') console.log('[ai-bridge] HELLO timed out for', peer.peerId.slice(0, 8), '(no reply from provider)')
          settleReady(peer, false)
        }, 10000)
      }
    })
  }

  function settleReady (peer, ok) {
    if (!ok && peer.clientState === 'authenticating') peer.clientState = 'unavailable'
    const waiters = peer.readyWaiters
    peer.readyWaiters = []
    for (const w of waiters) w(peer.clientState === 'ready' ? true : ok)
  }

  function firstTruthy (promises, signal) {
    return new Promise((resolve) => {
      let remaining = promises.length
      let done = false
      const finish = (v) => {
        if (done) return
        done = true
        resolve(v)
      }
      if (signal) signal.addEventListener('abort', () => finish(null), { once: true })
      for (const p of promises) {
        p.then((v) => {
          if (v) finish(v)
          else if (--remaining === 0) finish(null)
        }).catch(() => {
          if (--remaining === 0) finish(null)
        })
      }
    })
  }

  function noProviderError () {
    const err = new Error('No AI Device is online')
    err.name = 'NoAiProviderError'
    return err
  }

  return { install, requestRemoteChat }
}
