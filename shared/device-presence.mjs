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
//
// A HELLO can also say how long ago the user last used the sender (`activity: { idleMs }`,
// shared/device-activity.mjs), so a notification shows only on the Device they're using.

import { readActivity, lastActiveFrom } from './device-activity.mjs';

export const PRESENCE_PROTOCOL = 'nomad/device-presence';

const PAIRED_FLAG = '_nomadPresencePaired:';
const KEY_RE = /^[0-9a-f]{64}$/;

function noop(..._args) {}

// `status` is an always-on Peer's (shared/peers.mjs makeStatus, ADR-0038): a small object, or none.
// `activity` is shared/device-activity.mjs activityFrame's { idleMs }, or none.
export function encodeHello(b4a, deviceKey, status = null, activity = null) {
  const hello = { t: 'hello', deviceKey };
  if (status) hello.status = status;
  if (activity) hello.activity = activity;
  return b4a.from(JSON.stringify(hello));
}

// The HELLO frame, or null on anything malformed. A peer must never break the channel on bad bytes.
export function decodeHello(b4a, buf) {
  try {
    if (buf.length > 4096) return null;
    const obj = JSON.parse(b4a.toString(buf));
    if (
      obj &&
      obj.t === 'hello' &&
      typeof obj.deviceKey === 'string' &&
      KEY_RE.test(obj.deviceKey)
    ) {
      const status = obj.status && typeof obj.status === 'object' && !Array.isArray(obj.status) ? obj.status : null;
      const activity = readActivity(obj.activity);
      const hello = { t: 'hello', deviceKey: obj.deviceKey };
      if (status) hello.status = status;
      if (activity) hello.activity = activity;
      return hello;
    }
  } catch {}
  return null;
}

// getVaultKey / getDeviceKey return hex strings (or null while this Device has no Vault); they may
// be async. install() is idempotent: call it again once a Vault opens to cover live connections.
// getStatus (a Peer's, optional) is sent with every HELLO; announce() sends it again on every
// channel, so a Peer's status stays current. A HELLO may come more than once: the last one counts.
// getActivity (optional) returns this Device's activityFrame, sent the same way; call announce()
// when device-activity.mjs needsResend says so.
export function createDevicePresence({
  swarm,
  Protomux,
  c,
  b4a,
  getVaultKey,
  getDeviceKey,
  getStatus = null,
  getActivity = null,
  now = () => Date.now(),
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
    const peer = { channel: null, deviceKey: null, status: null, lastActiveAt: null };
    const channel = mux.createChannel({
      protocol: PRESENCE_PROTOCOL,
      id,
      messages: [
        {
          encoding: c.buffer,
          onmessage(buf) {
            const hello = decodeHello(b4a, buf);
            if (!hello) return;
            if (peer.deviceKey !== hello.deviceKey) log('device connected', hello.deviceKey.slice(0, 8));
            peer.deviceKey = hello.deviceKey;
            peer.status = hello.status || null;
            if (hello.activity) peer.lastActiveAt = lastActiveFrom(hello.activity, now());
          },
        },
      ],
      onopen() {
        sendHello(channel, deviceKey);
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

  async function sendHello(channel, deviceKey) {
    let status = null;
    let activity = null;
    try {
      status = getStatus ? await getStatus() : null;
    } catch {}
    try {
      activity = getActivity ? await getActivity() : null;
    } catch {}
    try {
      channel.messages[0].send(encodeHello(b4a, deviceKey, status, activity));
    } catch {}
  }

  // Send this side's HELLO again on every open channel (a Peer's new status).
  async function announce() {
    const deviceKey = await getDeviceKey();
    if (!deviceKey) return;
    for (const peer of peers) if (peer.channel && peer.channel.opened) sendHello(peer.channel, deviceKey);
  }

  // The status each connected key last sent (a Peer's), by key.
  function statuses() {
    const out = new Map();
    for (const peer of peers) if (peer.deviceKey && peer.status) out.set(peer.deviceKey, peer.status);
    return out;
  }

  // When the user last used each connected Device that says (this Device's clock), by key.
  function lastActive() {
    const out = new Map();
    for (const peer of peers) {
      if (!peer.deviceKey || peer.lastActiveAt === null) continue;
      const prev = out.get(peer.deviceKey);
      if (prev === undefined || peer.lastActiveAt > prev) {
        out.set(peer.deviceKey, peer.lastActiveAt);
      }
    }
    return out;
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

  return { install, connectedDevices, statuses, lastActive, announce, reset };
}
