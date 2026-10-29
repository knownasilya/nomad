// nomad/shared/device-presence.mjs
//
// Which of the user's Devices this Device is connected to right now, shared byte-for-byte by the
// desktop app (app/bg/hyper/device-presence.js) and the mobile backend (mobile/backend/backend.mjs).
// Like ai-bridge.mjs this module has NO bare imports: each runtime injects its own Protomux,
// compact-encoding and b4a.
//
// One Protomux channel (protocol `nomad/device-presence`) per swarm connection, keyed on the Vault
// key exactly like the AI Bridge, so only the user's own Devices pair it. Once paired, each side
// sends one HELLO naming its Vault writer key (the key of its /.vault/devices/<key>.json record).
// The peer is "connected" while that channel stays open.
//
// This is a display hint, not an auth step: a peer that knows the Vault key could name another
// Device. Anything that grants access (the AI Bridge, Autobase writers) proves its key itself.

export const PRESENCE_PROTOCOL = 'nomad/device-presence';

const PAIRED_FLAG = '_nomadPresencePaired:';
const KEY_RE = /^[0-9a-f]{64}$/;

function noop(..._args) {}

export function encodeHello(b4a, deviceKey) {
  return b4a.from(JSON.stringify({ t: 'hello', deviceKey }));
}

// The HELLO frame, or null on anything malformed. A peer must never break the channel on bad bytes.
export function decodeHello(b4a, buf) {
  try {
    const obj = JSON.parse(b4a.toString(buf));
    if (
      obj &&
      obj.t === 'hello' &&
      typeof obj.deviceKey === 'string' &&
      KEY_RE.test(obj.deviceKey)
    ) {
      return obj;
    }
  } catch {}
  return null;
}

// getVaultKey / getDeviceKey return hex strings (or null while this Device has no Vault); they may
// be async. install() is idempotent: call it again once a Vault opens to cover live connections.
export function createDevicePresence({
  swarm,
  Protomux,
  c,
  b4a,
  getVaultKey,
  getDeviceKey,
  log = noop,
}) {
  const peers = new Set(); // { channel, deviceKey }, one per open channel
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
      // Accept a remote-initiated OPEN too; both sides open, and whichever OPEN lands first would
      // otherwise be rejected (same race as the AI Bridge).
      // Keyed per Vault, so a Device that unlinks and joins another Vault pairs the new id too.
      if (!mux[PAIRED_FLAG + vaultKey]) {
        mux[PAIRED_FLAG + vaultKey] = true;
        mux.pair({ protocol: PRESENCE_PROTOCOL, id }, () => openChannel(mux, id, deviceKey));
      }
      openChannel(mux, id, deviceKey);
    } catch (err) {
      log('openOnConn failed', err && err.message);
    }
  }

  // createChannel returns null when this mux already has the channel open, so a re-scan is a no-op.
  function openChannel(mux, id, deviceKey) {
    const peer = { channel: null, deviceKey: null };
    const channel = mux.createChannel({
      protocol: PRESENCE_PROTOCOL,
      id,
      messages: [
        {
          encoding: c.buffer,
          onmessage(buf) {
            const hello = decodeHello(b4a, buf);
            if (!hello) return;
            peer.deviceKey = hello.deviceKey;
            log('device connected', hello.deviceKey.slice(0, 8));
          },
        },
      ],
      onopen() {
        channel.messages[0].send(encodeHello(b4a, deviceKey));
      },
      onclose() {
        peers.delete(peer);
        if (peer.deviceKey) log('device disconnected', peer.deviceKey.slice(0, 8));
      },
    });
    if (!channel) return; // this {protocol, id} is already open on the mux
    peer.channel = channel;
    peers.add(peer);
    channel.open();
  }

  // Vault writer keys of the Devices connected right now.
  function connectedDevices() {
    const out = new Set();
    for (const peer of peers) if (peer.deviceKey) out.add(peer.deviceKey);
    return out;
  }

  // This Device left its Vault: stop announcing the old key. A later install() reopens channels.
  function reset() {
    for (const peer of peers) {
      try {
        peer.channel.close();
      } catch {}
    }
    peers.clear();
  }

  return { install, connectedDevices, reset };
}
