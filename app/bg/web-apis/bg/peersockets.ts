// Peersockets — per-topic messaging over existing Hyperswarm connections using Protomux channels.
import Protomux from 'protomux';
import c from 'compact-encoding';
import { createHash } from 'crypto';
import b4a from 'b4a';
import { Duplex, Readable } from 'streamx';
import * as drives from '../../hyper/drives';
import * as daemon from '../../hyper/daemon';
import * as autobases from '../../hyper/autobases';
import { PermissionsError } from 'beaker-error-constants';

const PROTOCOL = 'nomad/peersocket';

// roomId hex -> Room
const rooms = new Map();
let swarmListenerInstalled = false;

// exported api
// =

export default {
  async join(topic) {
    const drive = await getSenderDrive(this.sender);
    _ensureSwarmListener();

    const id = _roomId(drive.key, topic);
    const idHex = b4a.toString(id, 'hex');
    if (!rooms.has(idHex)) rooms.set(idHex, new Room(id));
    const room = rooms.get(idHex);

    // Open channels on all existing connections immediately
    const swarm = daemon.getSwarm();
    if (swarm) {
      for (const conn of swarm.connections) room.openOnConn(conn);
    }

    const stream = new Duplex({
      write(data, cb) {
        // Incoming writes are [peerId, msgBuffer] from fg-side send(peerId, msg)
        if (Array.isArray(data) && data.length === 2) {
          const msg = Buffer.isBuffer(data[1]) ? data[1] : b4a.from(data[1]);
          room.sendTo(data[0], msg);
        }
        cb(null);
      },
    });
    stream.objectMode = true;

    room.joinStreams.add(stream);
    stream.on('close', () => {
      room.joinStreams.delete(stream);
      room._maybeCleanup();
    });

    return stream;
  },

  async watch() {
    await getSenderDrive(this.sender); // validate origin
    _ensureSwarmListener();

    const stream = new Readable();
    stream.objectMode = true;
    const swarm = daemon.getSwarm();

    if (swarm) {
      const onConn = (conn) => {
        if (stream.destroyed) {
          swarm.removeListener('connection', onConn);
          return;
        }
        const peerId = conn.remotePublicKey ? b4a.toString(conn.remotePublicKey, 'hex') : null;
        if (!peerId) return;
        stream.push(['join', { peerId }]);
        conn.on('close', () => {
          if (!stream.destroyed) stream.push(['leave', { peerId }]);
        });
      };
      swarm.on('connection', onConn);
      stream.on('close', () => swarm.removeListener('connection', onConn));
    }

    return stream;
  },
};

// internal
// =

class Room {
  id: any;
  idHex: string;
  joinStreams: Set<any>;
  watchStreams: Set<any>;
  channels: Map<any, any>;

  constructor(id) {
    this.id = id;
    this.idHex = b4a.toString(id, 'hex');
    this.joinStreams = new Set();
    this.watchStreams = new Set();
    this.channels = new Map(); // peerKeyHex -> { channel, msg }
  }

  openOnConn(conn) {
    const peerId = conn.remotePublicKey ? b4a.toString(conn.remotePublicKey, 'hex') : null;
    if (!peerId || this.channels.has(peerId)) return;

    let mux;
    try {
      mux = Protomux.from(conn);
    } catch {
      return;
    }

    const room = this;
    const channel = mux.createChannel({
      protocol: PROTOCOL,
      id: this.id,
      messages: [
        {
          encoding: c.buffer,
          onmessage(data) {
            for (const s of room.joinStreams) {
              s.push(['message', { peerId, message: data }]);
            }
          },
        },
      ],
      onopen() {
        for (const ws of room.watchStreams) ws.push(['join', { peerId }]);
      },
      onclose() {
        room.channels.delete(peerId);
        for (const ws of room.watchStreams) ws.push(['leave', { peerId }]);
        room._maybeCleanup();
      },
    });

    if (!channel) return; // already exists on this mux

    this.channels.set(peerId, { channel, msg: channel.messages[0] });
    channel.open();
  }

  sendTo(peerId, msg) {
    const peer = this.channels.get(peerId);
    if (peer?.msg) peer.msg.send(msg);
  }

  _maybeCleanup() {
    if (this.joinStreams.size === 0 && this.watchStreams.size === 0) {
      for (const { channel } of this.channels.values()) {
        try {
          channel.close();
        } catch {}
      }
      rooms.delete(this.idHex);
    }
  }
}

function _roomId(driveKey, topic) {
  return createHash('sha256')
    .update(Buffer.isBuffer(driveKey) ? driveKey : b4a.from(driveKey, 'hex'))
    .update('/')
    .update(topic)
    .digest();
}

function _ensureSwarmListener() {
  if (swarmListenerInstalled) return;
  swarmListenerInstalled = true;
  const swarm = daemon.getSwarm();
  if (!swarm) return;
  swarm.on('connection', (conn) => {
    for (const room of rooms.values()) room.openOnConn(conn);
  });
}

async function getSenderDrive(sender) {
  var url = sender.getURL();
  if (!url.startsWith('hyper://')) {
    throw new PermissionsError('PeerSockets are only available on hyper:// origins');
  }
  // Collaborative (autobase) origins aren't Hyperdrives — getOrLoadDrive would choke on the
  // autobase core. If this origin is a loaded collaborative drive, use its session, which
  // exposes a .key just like a Hyperdrive session (rooms keyed by it work over the same swarm).
  let key;
  try {
    key = new URL(url).hostname;
  } catch {}
  const collab = key && autobases.getCollaborativeDrive(key);
  if (collab) return collab;
  return drives.getOrLoadDrive(url);
}
