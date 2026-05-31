import { session } from 'electron';
import * as beakerProtocol from './beaker';
import * as assetProtocol from './asset';
import * as hyperProtocol from './hyper';

// Track which partitions have already been registered so we don't double-register
const registered = new Set();

/**
 * Register beaker://, asset://, and hyper:// on a non-default session partition.
 * Safe to call multiple times for the same partition (idempotent).
 * @param {string} partition  e.g. 'persist:space-2'
 */
export function registerForPartition(partition) {
  if (!partition || registered.has(partition)) return;
  registered.add(partition);
  const sess = session.fromPartition(partition);
  beakerProtocol.register(sess.protocol);
  assetProtocol.register(sess.protocol);
  hyperProtocol.register(sess.protocol);
}
