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
import { makeWriterProof, decodeWriterProof, verifyWriterProof } from '../../hyper/writer-proof';

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
    if (!rooms.has(idHex)) rooms.set(idHex, new Room(id, drive));
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
    // A page joining a room that's already open (another tab of the same Drive) learns its peers.
    for (const [peerId, peer] of room.channels) {
      if (!peer.channel.opened) continue;
      stream.push(['join', { peerId }]);
      if (peer.writerKey) stream.push(['writer', { peerId, writerKey: peer.writerKey }]);
    }
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

// A room's join streams get 'message' { peerId, message, writerKey } plus, for peers in this
// room (not every swarm connection, as watch() reports), 'join' { peerId }, 'leave' { peerId }
// and 'writer' { peerId, writerKey } once a peer proves it is a current Writer of the Drive
// (ADR-0025 §5). writerKey stays null for a peer that hasn't proved it.
class Room {
  id: any;
  idHex: string;
  drive: any;
  joinStreams: Set<any>;
  watchStreams: Set<any>;
  channels: Map<any, any>;

  constructor(id, drive) {
    this.id = id;
    this.idHex = b4a.toString(id, 'hex');
    this.drive = drive; // an Autobase session (has .base) or a Hyperdrive (no Writer proofs)
    this.joinStreams = new Set();
    this.watchStreams = new Set();
    this.channels = new Map(); // peerKeyHex -> { channel, msg, proof, conn, writerKey, proofSent }
  }

  _push(event, detail) {
    for (const s of this.joinStreams) s.push([event, detail]);
  }

  // Send this Device's Writer proof once per channel, as soon as it has one. Called on open and
  // before every send, so a Device that becomes a Writer later still proves it.
  _sendProof(peer) {
    if (peer.proofSent || !this.drive?.base) return;
    const proof = makeWriterProof(this.drive.base, this.id, peer.conn.handshakeHash);
    if (!proof) return;
    peer.proofSent = true;
    peer.proof.send(b4a.from(JSON.stringify(proof)));
  }

  async _onProof(peerId, data) {
    const peer = this.channels.get(peerId);
    const base = this.drive?.base;
    if (!peer || !base) return;
    const writerKey = await verifyWriterProof({
      base,
      store: daemon.getCorestore(),
      roomId: this.id,
      handshakeHash: peer.conn.handshakeHash,
      proof: decodeWriterProof(data),
    });
    if (!writerKey || this.channels.get(peerId) !== peer) return;
    peer.writerKey = writerKey;
    this._push('writer', { peerId, writerKey });
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
            const writerKey = room.channels.get(peerId)?.writerKey || null;
            room._push('message', { peerId, message: data, writerKey });
          },
        },
        {
          // A Writer proof (ADR-0025). A peer on an older build never sends one.
          encoding: c.buffer,
          onmessage(data) {
            room._onProof(peerId, data);
          },
        },
      ],
      onopen() {
        for (const ws of room.watchStreams) ws.push(['join', { peerId }]);
        room._push('join', { peerId });
        const peer = room.channels.get(peerId);
        if (peer) room._sendProof(peer);
      },
      onclose() {
        room.channels.delete(peerId);
        for (const ws of room.watchStreams) ws.push(['leave', { peerId }]);
        room._push('leave', { peerId });
        room._maybeCleanup();
      },
    });

    if (!channel) return; // already exists on this mux

    this.channels.set(peerId, {
      channel,
      msg: channel.messages[0],
      proof: channel.messages[1],
      conn,
      writerKey: null,
      proofSent: false,
    });
    channel.open();
  }

  sendTo(peerId, msg) {
    const peer = this.channels.get(peerId);
    if (!peer?.msg) return;
    this._sendProof(peer);
    peer.msg.send(msg);
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
