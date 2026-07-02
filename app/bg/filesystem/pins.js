import b4a from 'b4a';
import * as filesystem from './index';
import * as autobases from '../hyper/autobases';
import { normalizeUrl } from '../../lib/urls';

// exported api
// =

export async function setup() {
  // The private drive is an Autobase (ADR-0010); pins live in the file body of /beaker/pins.json.
  // Fresh drives have no legacy metadata-encoded pins to migrate, so just ensure the file exists.
  const sess = filesystem.get();
  const existing = await autobases.readContent(sess, '/beaker/pins.json');
  if (existing) return;
  await write([]);
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
    const buf = await autobases.readContent(filesystem.get(), '/beaker/pins.json');
    data = buf ? JSON.parse(b4a.toString(buf)) : [];
  } catch (e) {
    data = [];
  }
  return data.filter((b) => b && typeof b === 'string').map((v) => normalizeUrl(v));
}

async function write(data) {
  data = data && Array.isArray(data) ? data : [];
  data = data.filter((b) => b && typeof b === 'string');
  await autobases.putInline(filesystem.get(), '/beaker/pins.json', b4a.from(JSON.stringify(data, null, 2)));
}
