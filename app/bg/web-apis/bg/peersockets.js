// @ts-nocheck
// TODO: Peersockets was a Hyperspace-specific feature. Reimplementation using
// Protomux channels over Hyperswarm connections is deferred.
import { Duplex, Readable } from 'streamx';
import * as drives from '../../hyper/drives';
import { PermissionsError } from 'beaker-error-constants';

const sessionAliases = new Map();

// exported api
// =

export default {
  async join(topic) {
    await getSenderDrive(this.sender); // validate origin
    // Return a no-op duplex — messages are silently dropped until peersockets is reimplemented
    const stream = new Duplex({
      write(data, cb) { cb(null); },
    });
    stream.objectMode = true;
    return stream;
  },

  async watch() {
    await getSenderDrive(this.sender); // validate origin
    // Return a no-op readable — peer join/leave events not surfaced until reimplemented
    return new Readable();
  },
};

// internal methods
// =

async function getSenderDrive(sender) {
  var url = sender.getURL();
  if (!url.startsWith('hyper://')) {
    throw new PermissionsError(
      'PeerSockets are only available on hyper:// origins'
    );
  }
  return drives.getOrLoadDrive(url);
}
