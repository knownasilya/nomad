// Which AI chats made or wrote a drive (ADR-0047): one Vault record per drive,
// /.vault/ai-made/<driveKey>.json, with the rules in shared/ai-origin.mjs. Kept in the Vault, not the
// drive, because a drive can be public and the chat ids are the user's own.
//
// ai.ts calls noteDrive after createDrive and each writeDriveFile; site-info reads it through
// nomad.aiChats.driveOrigins (bg/web-apis/bg/ai-chats.ts).

import * as vault from '../hyper/vault';
import * as drives from '../hyper/drives';
import * as ao from '../../../shared/ai-origin.mjs';

const queues = new Map(); // drive key -> the write in progress, so two writes don't race

async function keyOf(urlOrKey) {
  const key = await drives.fromURLToKey(String(urlOrKey || ''), true);
  return typeof key === 'string' && /^[0-9a-f]{64}$/.test(key) ? key : null;
}

// Keep `origin` on the drive's record. Never throws: a missed note mustn't fail the AI's write.
export function noteDrive(urlOrKey, origin, { made = false, path = '' } = {}) {
  return (async () => {
    const key = await keyOf(urlOrKey);
    if (!key) return;
    const before = queues.get(key) || Promise.resolve();
    const run = before.then(async () => {
      const prev = await vault.readAppRecord(ao.aiMadePath(key));
      const next = ao.addDriveOrigin(prev, key, origin, { made, path });
      if (JSON.stringify(next.ai) === JSON.stringify(ao.driveOriginsOf(prev))) return;
      await vault.putAppRecord(ao.aiMadePath(key), next);
    });
    const kept = run.catch(() => {});
    queues.set(key, kept);
    await kept;
    if (queues.get(key) === kept) queues.delete(key);
  })().catch((err) => console.warn('[ai] Could not note the chat on a drive', err?.message));
}

// The drive's origins, each with the paths it wrote. [] when the AI never wrote it.
export async function driveOrigins(urlOrKey) {
  const key = await keyOf(urlOrKey).catch(() => null);
  if (!key) return [];
  return ao.driveOriginsOf(await vault.readAppRecord(ao.aiMadePath(key)).catch(() => null));
}
