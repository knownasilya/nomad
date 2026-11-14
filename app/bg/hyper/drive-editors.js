// @ts-nocheck
//
// Who can edit a drive, for site-info's Editors tab: its writers (the user's own Devices named from
// their Vault writer grants), the requests waiting, and its open invite links (shared/drive-invites.mjs).
// Adding, removing and approving go through nomad.fs (createInvite, approveRequest, denyRequest,
// removeWriter); cancelling a link is here.

import b4a from 'b4a';
import * as autobases from './autobases';
import * as vault from './vault';
import { editorRows, isInviteId } from '../../../shared/drive-invites.mjs';
import { grantsPrefix, isKey } from '../../../shared/drive-writers.mjs';

const WRITERS_PREFIX = '/.data/walled.garden/writers/';

// { writable, collaborative, self, writers, requests, invites } for drive `key`, or null for a drive
// that isn't an Autobase (an old Hyperdrive has one writer and no editors to show).
export async function editors(key) {
  if (!isKey(key) || !(await autobases.isKnownAutobase(key))) return null;
  const sess = await autobases.getOrLoadCollaborativeDrive(key);
  if (!sess) return null;
  await sess.base.update().catch(() => {});
  const self = sess.base.local?.key ? b4a.toString(sess.base.local.key, 'hex') : null;
  const writers = [];
  for (const { path } of await autobases.listRecords(sess, WRITERS_PREFIX)) {
    const rec = await autobases.readJson(sess, path).catch(() => null);
    if (rec) writers.push(rec);
  }
  const grants = await vault.listAppRecords(grantsPrefix(key)).catch(() => []);
  const writable = !!sess.writable;
  return {
    writable,
    collaborative: !!sess.collaborative,
    self,
    writers: editorRows(writers, { self, grants }),
    requests: writable ? autobases.listPendingRequests(key) : [],
    invites: writable ? await autobases.listInvites(sess) : [],
  };
}

export async function cancelInvite(key, id) {
  if (!isKey(key) || !isInviteId(id)) throw new Error('Bad invite');
  const sess = await autobases.getOrLoadCollaborativeDrive(key);
  if (!sess?.writable) throw new Error('Only a device that can edit this drive can cancel its links');
  await autobases.cancelInvite(sess, id);
}
