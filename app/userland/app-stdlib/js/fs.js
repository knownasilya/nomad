import { isFilenameBinary } from './is-ext-binary.js';
import { joinPath, slugify } from './strings.js';

// typedefs
// =

/**
 * @typedef {Object} FSQueryOpts
 * @prop {string|string[]} path
 * @prop {string} [type]
 * @prop {Object} [meta]
 * @prop {string} [sort] - 'name', 'ctime', 'mtime'
 * @prop {boolean} [reverse]
 * @prop {number} [limit]
 * @prop {number} [offset]
 *
 * @typedef {Object} Stat
 * @prop {number} mode
 * @prop {number} size
 * @prop {number} offset
 * @prop {number} blocks
 * @prop {Date} atime
 * @prop {Date} mtime
 * @prop {Date} ctime
 * @prop {string} linkname
 *
 * @typedef {Object} FSQueryResult
 * @prop {string} type
 * @prop {string} path
 * @prop {string} url
 * @prop {Stat} stat
 * @prop {string} drive
 * @prop {any} [content]
 */

// exported
// =

/**
 * @param {Hyperdrive} fs
 * @param {FSQueryOpts} query
 * @returns {Promise<FSQueryResult[]>}
 */
export async function queryRead(fs, query) {
  var files = await fs.query(query);
  for (let file of files) {
    if (isFilenameBinary(file.path)) continue;
    file.content = await fs
      .readFile(file.path, 'utf8')
      .catch((err) => undefined);
    if (file.path.endsWith('.json')) {
      try {
        file.content = JSON.parse(file.content);
      } catch (e) {
        // ignore
      }
    }
  }
  return files;
}

/**
 * @param {Hyperdrive} fs
 * @param {FSQueryOpts} query
 * @returns {Promise<boolean>}
 */
export async function queryHas(fs, query) {
  var files = await fs.query(query);
  return files.length > 0;
}

/**
 * @param {Hyperdrive} fs
 * @param {string} path
 */
export async function ensureDir(fs, path) {
  try {
    let st = await fs.stat(path).catch((e) => null);
    if (!st) {
      await fs.mkdir(path);
    } else if (!st.isDirectory()) {
      console.error(
        'Warning! Filesystem expects a folder but an unexpected file exists at this location.',
        { path }
      );
    }
  } catch (e) {
    console.error('Filesystem failed to make directory', { path, error: e });
  }
}

/**
 * @param {Hyperdrive} fs
 * @param {string} path
 */
export async function ensureParentDir(fs, path) {
  return ensureDir(fs, path.split('/').slice(0, -1).join('/'));
}

/**
 * @param {string} containingPath
 * @param {string} title
 * @param {Object} fs
 * @param {string} ext
 * @returns {Promise<string>}
 */
export async function getAvailableName(containingPath, title, fs, ext = '') {
  var basename = slugify((title || '').trim() || 'untitled').toLowerCase();
  for (let i = 1; i < 1e9; i++) {
    let name =
      (i === 1 ? basename : `${basename}-${i}`) + (ext ? `.${ext}` : '');
    let st = await fs.stat(joinPath(containingPath, name)).catch((e) => null);
    if (!st) return name;
  }
  // yikes if this happens
  throw new Error('Unable to find an available name for ' + title);
}
