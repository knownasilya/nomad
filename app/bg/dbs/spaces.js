import * as db from './profile-data-db';
import * as settingsDb from './settings';

// globals
// =

var activeSpaceId = 1;
var spacesCache = []; // Array<Space>

// exported api
// =

export async function setup() {
  spacesCache = await db.all('SELECT * FROM spaces ORDER BY sort_order ASC, id ASC');
  const stored = await settingsDb.get('active_space_id');
  activeSpaceId = stored ? Number(stored) : 1;

  // ensure active space id is valid
  if (!spacesCache.find((s) => s.id === activeSpaceId)) {
    activeSpaceId = spacesCache[0]?.id || 1;
  }
}

// Called from filesystem.setup() after the root drive URL is known
export async function backfillDefaultSpaceDrive(rootDriveUrl) {
  // Always query DB directly — don't rely on the in-memory cache being ready
  const space = await db.get('SELECT * FROM spaces WHERE id = 1');
  if (space && !space.root_drive_url) {
    await db.run('UPDATE spaces SET root_drive_url = ? WHERE id = 1', [rootDriveUrl]);
    // refresh cache entry
    const cached = spacesCache.find((s) => s.id === 1);
    if (cached) cached.root_drive_url = rootDriveUrl;
  }
}

export async function list() {
  spacesCache = await db.all('SELECT * FROM spaces ORDER BY sort_order ASC, id ASC');
  return spacesCache;
}

export async function get(id) {
  return db.get('SELECT * FROM spaces WHERE id = ?', [id]);
}

export function getCachedAll() {
  return spacesCache;
}

export function getCachedActiveId() {
  return activeSpaceId;
}

export function getCachedActive() {
  return spacesCache.find((s) => s.id === activeSpaceId) || spacesCache[0] || null;
}

export async function getActive() {
  return get(activeSpaceId);
}

export async function setActive(id) {
  id = Number(id);
  const space = await get(id);
  if (!space) throw new Error('Space not found: ' + id);
  activeSpaceId = id;
  await settingsDb.set('active_space_id', String(id));
  // refresh cache
  spacesCache = await db.all('SELECT * FROM spaces ORDER BY sort_order ASC, id ASC');
  return space;
}

export async function create({ name, icon = 'circle', color = '#6c6cff' }) {
  // The root_drive_url is set later by filesystem after the drive is created
  const result = await db.run(
    'INSERT INTO spaces (name, icon, color, partition, created_at) VALUES (?, ?, ?, ?, ?)',
    [name, icon, color, '__pending__', Date.now()]
  );
  const id = result.lastID;
  // Update partition now that we have the id
  await db.run('UPDATE spaces SET partition = ? WHERE id = ?', [`persist:space-${id}`, id]);
  const space = await get(id);
  spacesCache = await db.all('SELECT * FROM spaces ORDER BY sort_order ASC, id ASC');
  return space;
}

export async function update(id, { name, icon, color, rootDriveUrl }) {
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (icon !== undefined) { fields.push('icon = ?'); values.push(icon); }
  if (color !== undefined) { fields.push('color = ?'); values.push(color); }
  if (rootDriveUrl !== undefined) { fields.push('root_drive_url = ?'); values.push(rootDriveUrl); }
  if (!fields.length) return get(id);
  values.push(id);
  await db.run(`UPDATE spaces SET ${fields.join(', ')} WHERE id = ?`, values);
  const space = await get(id);
  // update cache
  const idx = spacesCache.findIndex((s) => s.id === id);
  if (idx !== -1) spacesCache[idx] = space;
  return space;
}

export async function remove(id) {
  if (id === 1) throw new Error('Cannot delete the Personal space');
  await db.run('DELETE FROM spaces WHERE id = ?', [id]);
  spacesCache = spacesCache.filter((s) => s.id !== id);
  if (activeSpaceId === id) {
    await setActive(1);
  }
}
