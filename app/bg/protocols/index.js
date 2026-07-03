import { session } from 'electron';
import * as logLib from '../logger';
import * as nomadProtocol from './nomad';
import * as assetProtocol from './asset';
import * as hyperProtocol from './hyper';

const logger = logLib.child({ category: 'browser', subcategory: 'protocols' });

// Track which partitions have already been registered so we don't double-register
const registered = new Set();

/**
 * Register nomad://, asset://, and hyper:// on a non-default session partition.
 * Safe to call multiple times for the same partition (idempotent).
 * @param {string} partition  e.g. 'persist:space-2'
 */
export function registerForPartition(partition) {
  if (!partition || registered.has(partition)) return;
  const sess = session.fromPartition(partition);
  // Register each scheme independently so a failure in one doesn't prevent the
  // others — most importantly, a throw must never leave a partition marked as
  // registered (poisoning the Set) while nomad:// is actually unhandled, which
  // strands the session's tabs on ERR_UNKNOWN_URL_SCHEME.
  let nomadOk = false;
  try {
    nomadProtocol.register(sess.protocol);
    nomadOk = true;
  } catch (e) {
    logger.error('Failed to register nomad:// for partition', { partition, err: e });
  }
  try {
    assetProtocol.register(sess.protocol);
  } catch (e) {
    logger.error('Failed to register asset:// for partition', { partition, err: e });
  }
  try {
    hyperProtocol.register(sess.protocol);
  } catch (e) {
    logger.error('Failed to register hyper:// for partition', { partition, err: e });
  }
  // Only consider the partition done once nomad:// (the one tabs depend on for
  // their own assets) is actually handled. Otherwise leave it out of the Set so
  // a later call can retry.
  if (nomadOk) registered.add(partition);
}
