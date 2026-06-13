import b4a from 'b4a';
import * as filesystem from './index';
import { query } from './query';
import { normalizeUrl } from '../../lib/urls';

// exported api
// =

export async function setup() {
  var privateDrive = filesystem.get();
  const entry = await privateDrive.drive.entry('/beaker/pins.json').catch(() => null);
  if (entry) return;

  // migrate bookmarks
  var pins = [];
  for (let bookmark of await query(privateDrive, { path: '/bookmarks/*.goto' })) {
    const meta = bookmark.stat?.metadata || bookmark.metadata || {};
    if (meta.pinned || meta['beaker/pinned']) {
      pins.push(normalizeUrl(meta.href));
      // Remove pin flags from metadata
      const newMeta = Object.assign({}, meta);
      delete newMeta.pinned;
      delete newMeta['beaker/pinned'];
      const buf = await privateDrive.drive.get(bookmark.path);
      await privateDrive.drive.put(bookmark.path, buf || b4a.alloc(0), { metadata: newMeta });
    }
  }
  await write(pins);
}

export async function getCurrent() {
  return read();
}

export async function isPinned(url) {
  return (await read()).includes(url);
}

export async function add(url) {
  var data = await read();
  if (!data.includes(url)) {
    data.push(url);
    await write(data);
  }
}

export async function remove(url) {
  var data = await read();
  var index = data.indexOf(url);
  if (index === -1) return;
  data.splice(index, 1);
  await write(data);
}

// internal methods
// =

async function read() {
  var data;
  try {
    const buf = await filesystem.get().drive.get('/beaker/pins.json');
    data = buf ? JSON.parse(b4a.toString(buf)) : [];
  } catch (e) {
    data = [];
  }
  return data.filter((b) => b && typeof b === 'string').map((v) => normalizeUrl(v));
}

async function write(data) {
  data = data && Array.isArray(data) ? data : [];
  data = data.filter((b) => b && typeof b === 'string');
  await filesystem.get().drive.put('/beaker/pins.json', b4a.from(JSON.stringify(data, null, 2)));
}
