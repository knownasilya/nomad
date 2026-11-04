// nomad/shared/note-live.mjs
//
// The link between the user's own Devices that carries live Note editing (ADR-0041): which Notes
// each Device has open, and the Yjs sync and cursor messages of the sessions they share. Like
// device-presence.mjs this module has NO bare imports: each runtime injects its own Protomux,
// compact-encoding and b4a, plus the Vault key signing and checking.
//
// One Protomux channel (protocol `nomad/note-live`) per swarm connection, keyed on the Vault key.
// The Vault key alone proves nothing, so each side challenges the other: it sends a fresh nonce, and
// the other signs it with its Vault writer key (AUTH, as the AI Bridge does, ADR-0013). Note text
// is sent only to a peer whose signature checked out, and taken only from one.
//
// Frames are JSON:
//   CHALLENGE { nonce }                 on open, both ways
//   AUTH { deviceKey, sig }             the answer: `sig` over proofMessage(nonce, handshake hash)
//   OK {}                               your AUTH checked out
//   OPEN { ids }                        the Notes open here now (after AUTH, and on each change)
//   JOIN { id, seed, edited }           join this Note's session (seed: the record it started from)
//   WANT { id }                         send me your whole document: mine joins yours
//   STATE { id, update, seed, edited }  the whole document (base64 Yjs update)
//   MSG { id, m }                       a y-protocols sync or awareness message (base64)
//   LEAVE { id }                        this Device closed the Note

export const NOTE_LIVE_PROTOCOL = 'nomad/note-live';

export const FRAME = Object.freeze({
  CHALLENGE: 'challenge',
  AUTH: 'auth',
  OK: 'ok',
  OPEN: 'open',
  JOIN: 'join',
  WANT: 'want',
  STATE: 'state',
  MSG: 'msg',
  LEAVE: 'leave',
});

const PAIRED_FLAG = '_nomadNoteLivePaired:';
const KEY_RE = /^[0-9a-f]{64}$/;
const HEX_RE = /^[0-9a-f]+$/;
const ID_RE = /^[a-z0-9-]{1,40}$/;
// A frame bigger than this is dropped: a Note is at most 100,000 characters.
export const MAX_FRAME = 1_000_000;

function noop(..._args) {}

// What a Device signs to answer a CHALLENGE. The protocol name keeps the signature from passing as
// any other protocol's proof (the AI Bridge signs bare 32-byte nonces), and the connection's Noise
// handshake hash, which both ends share, keeps it from being relayed onto another connection.
export function proofMessage(nonceHex, handshakeHex) {
  return `${NOTE_LIVE_PROTOCOL}\n${nonceHex}\n${handshakeHex || ''}`;
}

export function encodeFrame(b4a, frame) {
  return b4a.from(JSON.stringify(frame));
}

// The frame, or null when it's malformed. A peer must never break the channel on bad bytes.
export function decodeFrame(b4a, buf) {
  try {
    if (!buf || buf.length > MAX_FRAME) return null;
    const f = JSON.parse(b4a.toString(buf));
    if (!f || typeof f !== 'object' || typeof f.t !== 'string') return null;
    switch (f.t) {
      case FRAME.CHALLENGE:
        return typeof f.nonce === 'string' && HEX_RE.test(f.nonce) && f.nonce.length === 64
          ? f
          : null;
      case FRAME.AUTH:
        return typeof f.deviceKey === 'string' &&
          KEY_RE.test(f.deviceKey) &&
          typeof f.sig === 'string' &&
          HEX_RE.test(f.sig)
          ? f
          : null;
      case FRAME.OK:
        return { t: f.t };
      case FRAME.OPEN:
        return Array.isArray(f.ids)
          ? {
              t: f.t,
              ids: f.ids.filter((id) => typeof id === 'string' && ID_RE.test(id)).slice(0, 200),
            }
          : null;
      case FRAME.JOIN:
      case FRAME.WANT:
      case FRAME.LEAVE:
      case FRAME.STATE:
      case FRAME.MSG:
        if (typeof f.id !== 'string' || !ID_RE.test(f.id)) return null;
        if (f.t === FRAME.MSG && typeof f.m !== 'string') return null;
        if (f.t === FRAME.STATE && typeof f.update !== 'string') return null;
        return f;
      default:
        return null; // a newer Device's frame
    }
  } catch {
    return null;
  }
}

/**
 * swarm, Protomux, c, b4a  the runtime's
 * getVaultKey()            hex, or null while this Device has no Vault
 * getDeviceKey()           hex: this Device's Vault writer key
 * randomHex()              32 random bytes as hex, for a nonce
 * sign(message)            hex signature of `message` (a string) with this Device's Vault writer key
 * verify(deviceKey, message, sigHex) -> Promise<boolean>: a listed Vault Device, and its signature
 * onPeer(deviceKey, up)    a checked Device connected (up) or went
 * onFrame(deviceKey, f)    an OPEN/JOIN/WANT/STATE/MSG/LEAVE frame from a checked Device
 * openIds()                the Notes open here, sent to each Device once it checks out
 */
export function createNoteLink({
  swarm,
  Protomux,
  c,
  b4a,
  getVaultKey,
  getDeviceKey,
  randomHex,
  sign,
  verify,
  onPeer = noop,
  onFrame = noop,
  openIds = () => [],
  log = noop,
}) {
  const channels = new Set(); // every open channel's peer state
  const byDevice = new Map(); // deviceKey -> peer, once checked
  let installed = false;

  function install() {
    if (!swarm) return;
    if (!installed) {
      installed = true;
      swarm.on('connection', (conn) => {
        openOnConn(conn);
      });
    }
    for (const conn of swarm.connections) openOnConn(conn);
  }

  // MUST NOT throw: runs inside the swarm 'connection' emitter, shared with corestore replication.
  async function openOnConn(conn) {
    try {
      const [vaultKey, deviceKey] = await Promise.all([getVaultKey(), getDeviceKey()]);
      if (!vaultKey || !deviceKey) return;
      const mux = Protomux.from(conn);
      const id = b4a.from(vaultKey, 'hex');
      if (!mux[PAIRED_FLAG + vaultKey]) {
        mux[PAIRED_FLAG + vaultKey] = true;
        mux.pair({ protocol: NOTE_LIVE_PROTOCOL, id }, () => openChannel(mux, id, deviceKey, conn));
      }
      openChannel(mux, id, deviceKey, conn);
    } catch (err) {
      log('openOnConn failed', err && err.message);
    }
  }

  function openChannel(mux, id, deviceKey, conn) {
    const hs = conn && conn.handshakeHash ? b4a.toString(conn.handshakeHash, 'hex') : '';
    // checked: we checked its AUTH; accepted: it checked ours. Note frames flow once both hold.
    const peer = {
      channel: null,
      nonce: null,
      hs,
      deviceKey: null,
      checked: false,
      accepted: false,
      up: false,
    };
    const channel = mux.createChannel({
      protocol: NOTE_LIVE_PROTOCOL,
      id,
      messages: [
        {
          encoding: c.buffer,
          onmessage(buf) {
            onMessage(peer, deviceKey, buf).catch((err) => log('frame failed', err && err.message));
          },
        },
      ],
      onopen() {
        peer.nonce = randomHex();
        sendRaw(peer, { t: FRAME.CHALLENGE, nonce: peer.nonce });
      },
      onclose() {
        channels.delete(peer);
        if (peer.up && byDevice.get(peer.deviceKey) === peer) {
          byDevice.delete(peer.deviceKey);
          onPeer(peer.deviceKey, false);
        }
      },
    });
    if (!channel) return; // already open on this mux
    peer.channel = channel;
    channels.add(peer);
    channel.open();
  }

  function sendRaw(peer, frame) {
    try {
      peer.channel.messages[0].send(encodeFrame(b4a, frame));
    } catch {}
  }

  async function onMessage(peer, ownKey, buf) {
    const f = decodeFrame(b4a, buf);
    if (!f) return;
    if (f.t === FRAME.CHALLENGE) {
      sendRaw(peer, {
        t: FRAME.AUTH,
        deviceKey: ownKey,
        sig: await sign(proofMessage(f.nonce, peer.hs)),
      });
      return;
    }
    if (f.t === FRAME.AUTH) {
      const nonce = peer.nonce;
      peer.nonce = null; // one answer per challenge
      if (!nonce || peer.checked || f.deviceKey === ownKey) return;
      if (!(await verify(f.deviceKey, proofMessage(nonce, peer.hs), f.sig))) {
        log('note-live auth failed', f.deviceKey.slice(0, 8));
        return;
      }
      peer.deviceKey = f.deviceKey;
      peer.checked = true;
      sendRaw(peer, { t: FRAME.OK });
      return ready(peer);
    }
    if (f.t === FRAME.OK) {
      peer.accepted = true;
      return ready(peer);
    }
    if (!peer.up) return; // nothing else until both sides checked each other
    onFrame(peer.deviceKey, f);
  }

  function ready(peer) {
    if (!peer.checked || !peer.accepted || peer.up) return;
    peer.up = true;
    const old = byDevice.get(peer.deviceKey);
    byDevice.set(peer.deviceKey, peer);
    if (!old) onPeer(peer.deviceKey, true);
    sendRaw(peer, { t: FRAME.OPEN, ids: openIds() });
  }

  // Send to one checked Device. False when it isn't connected.
  function send(deviceKey, frame) {
    const peer = byDevice.get(deviceKey);
    if (!peer) return false;
    sendRaw(peer, frame);
    return true;
  }

  function broadcast(frame) {
    for (const peer of byDevice.values()) sendRaw(peer, frame);
  }

  function devices() {
    return [...byDevice.keys()];
  }

  function reset() {
    for (const peer of channels) {
      try {
        peer.channel.close();
      } catch {}
    }
    channels.clear();
    byDevice.clear();
  }

  return { install, send, broadcast, devices, reset };
}
