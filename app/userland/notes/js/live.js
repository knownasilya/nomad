// The open Note's live session, as nomad://notes sees it (ADR-0041): a Yjs document kept in step
// with the session in bg (bg/notes/live-notes.js) over nomad.vault.openLiveNote / liveNoteSend.
// The session joins the same Note open on the user's other Devices, and the AI types into it, so
// the editor (bound with yCollab) shows their edits as they happen and their cursors.

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { diffEdits } from '../../../../shared/note-diff.mjs';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const MSG_RESET = 2;
const FROM_HUB = 'hub';
const SYNC_TIMEOUT_MS = 4000;

export const COLORS = ['#e5484d', '#e2701b', '#2f9e44', '#0b8bd1', '#d6409f', '#0f9c8c', '#8d6e00', '#3e63dd'];

export function colorFor(key) {
  let h = 0;
  for (const ch of String(key || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export const canLive = () => typeof window.nomad?.vault?.openLiveNote === 'function';

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(str) {
  const bin = atob(String(str || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Put `want` in `ytext` as the edits from what it holds now (keeps everyone else's cursors).
export function setYText(ytext, want) {
  const edits = diffEdits(ytext.toString(), want);
  if (!edits.length) return;
  ytext.doc.transact(() => {
    for (let k = edits.length - 1; k >= 0; k--) {
      const e = edits[k];
      if (e.to > e.from) ytext.delete(e.from, e.to - e.from);
      if (e.insert) ytext.insert(e.from, e.insert);
    }
  });
}

/**
 * Join Note `id`'s session. `user` is { name, color, colorLight } for this page's cursor.
 * onStatus(status)   the session's { saving, unsaved, error, devices, ai, updatedAt }
 * onPeers()          someone joined, left, or moved their cursor
 * onReset()          the session took another Device's document: connect again
 * Returns { ydoc, ytext, awareness, whenSynced, others(), destroy() }.
 */
export function connectLiveNote({ id, user, onStatus = () => {}, onPeers = () => {}, onReset = () => {} }) {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('text');
  const awareness = new awarenessProtocol.Awareness(ydoc);
  awareness.setLocalStateField('user', user);
  const conn = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  let closed = false;
  let asked = false;
  let resolveSynced;
  let rejectSynced;
  const whenSynced = new Promise((resolve, reject) => {
    resolveSynced = resolve;
    rejectSynced = reject;
  });
  const timer = setTimeout(() => rejectSynced(new Error('The note did not load in time')), SYNC_TIMEOUT_MS);
  whenSynced.catch(() => {}).finally(() => clearTimeout(timer));

  const send = (bytes) => {
    if (closed) return;
    nomad.vault.liveNoteSend(id, conn, b64(bytes)).catch(() => {});
  };
  const sendAwareness = (clients) => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, clients));
    send(encoding.toUint8Array(enc));
  };
  // Ask for the session's document, once it has us.
  const ask = () => {
    if (asked) return;
    asked = true;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, ydoc);
    send(encoding.toUint8Array(enc));
    sendAwareness([ydoc.clientID]);
  };

  const stream = nomad.vault.openLiveNote(id, conn);
  stream.addEventListener('status', (e) => {
    ask();
    onStatus(e);
  });
  stream.addEventListener('failed', (e) => rejectSynced(new Error(e.message || 'Live editing is not available')));
  stream.addEventListener('message', (e) => {
    if (closed) return;
    try {
      const bytes = unb64(e.data);
      const dec = decoding.createDecoder(bytes);
      const type = decoding.readVarUint(dec);
      if (type === MSG_SYNC) {
        ask();
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        const kind = syncProtocol.readSyncMessage(dec, enc, ydoc, FROM_HUB);
        if (encoding.length(enc) > 1) send(encoding.toUint8Array(enc));
        if (kind === syncProtocol.messageYjsSyncStep2) resolveSynced();
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(dec), FROM_HUB);
      } else if (type === MSG_RESET) {
        onReset();
      }
    } catch (err) {
      console.warn('[notes] bad live message', err);
    }
  });

  ydoc.on('update', (update, origin) => {
    if (origin === FROM_HUB) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    send(encoding.toUint8Array(enc));
  });
  awareness.on('update', ({ added, updated, removed }, origin) => {
    if (origin === 'local') sendAwareness([...added, ...updated, ...removed]);
  });
  awareness.on('change', () => onPeers());

  // The others in the Note: [{ clientId, name, color, ai }].
  const others = () => {
    const out = [];
    for (const [clientId, st] of awareness.getStates()) {
      if (clientId === ydoc.clientID || !st || !st.user) continue;
      out.push({ clientId, name: String(st.user.name || 'Someone'), color: st.user.color || '#888', ai: !!st.user.ai });
    }
    return out;
  };

  return {
    ydoc,
    ytext,
    awareness,
    whenSynced,
    others,
    destroy() {
      if (closed) return;
      awarenessProtocol.removeAwarenessStates(awareness, [ydoc.clientID], 'local');
      closed = true;
      clearTimeout(timer);
      try {
        stream.close();
      } catch {}
      awareness.destroy();
      ydoc.destroy();
    },
  };
}
