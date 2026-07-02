import ms from 'ms';
import b4a from 'b4a';
import * as filesystem from './index';
import * as autobases from '../hyper/autobases';
import {
  PATHS,
  TRASH_FIRST_COLLECT_WAIT,
  TRASH_REGULAR_COLLECT_WAIT,
  TRASH_EXPIRATION_AGE,
} from '../../lib/const';
import * as logLib from '../logger';
const logger = logLib.child({
  category: 'hyper',
  subcategory: 'trash-collector',
});

// globals
// =

var nextGCTimeout;

// exported API
// =

export function setup() {
  schedule(TRASH_FIRST_COLLECT_WAIT);
}

/**
 * Add a drive key to the trash list with the current timestamp.
 * @param {string} key hex drive key
 */
export async function add(key) {
  const rootDrive = filesystem.get();
  if (!rootDrive) return;
  const items = await _read(rootDrive);
  if (!items.find((i) => i.key === key)) {
    items.push({ key, deletedAt: Date.now() });
    await _write(rootDrive, items);
  }
}

/**
 * @param {Object} [query]
 * @param {number} [query.olderThan]
 * @returns {Promise<Array<{key: string, deletedAt: number}>>}
 */
export async function query(query = {}) {
  const rootDrive = filesystem.get();
  if (!rootDrive) return [];
  const items = await _read(rootDrive);
  return items.filter((item) => {
    if (query.olderThan && Date.now() - item.deletedAt < query.olderThan) return false;
    return true;
  });
}

/**
 * @param {Object} [opts]
 * @param {number} [opts.olderThan]
 * @returns {Promise<{totalItems: number}>}
 */
export async function collect({ olderThan } = {}) {
  logger.silly('Running trash GC');
  olderThan = typeof olderThan === 'number' ? olderThan : TRASH_EXPIRATION_AGE;

  if (nextGCTimeout) {
    clearTimeout(nextGCTimeout);
    nextGCTimeout = null;
  }

  const rootDrive = filesystem.get();
  if (!rootDrive) {
    schedule(TRASH_REGULAR_COLLECT_WAIT);
    return { totalItems: 0 };
  }

  const items = await _read(rootDrive);
  const toRemove = items.filter((item) => Date.now() - item.deletedAt >= olderThan);
  const remaining = items.filter((item) => Date.now() - item.deletedAt < olderThan);

  if (toRemove.length) {
    logger.info(`Deleting ${toRemove.length} drives from trash`);
    await _write(rootDrive, remaining);
  }

  schedule(TRASH_REGULAR_COLLECT_WAIT);
  logger.silly(`Scheduling next trash GC in ${ms(TRASH_REGULAR_COLLECT_WAIT)}`);

  return { totalItems: toRemove.length };
}

// helpers
// =

async function _read(rootDrive) {
  try {
    const buf = await autobases.readContent(rootDrive, PATHS.TRASH);
    if (!buf) return [];
    return JSON.parse(b4a.toString(buf));
  } catch {
    return [];
  }
}

async function _write(rootDrive, items) {
  await autobases.putInline(rootDrive, PATHS.TRASH, b4a.from(JSON.stringify(items)));
}

function schedule(time) {
  nextGCTimeout = setTimeout(collect, time);
  nextGCTimeout.unref();
}
