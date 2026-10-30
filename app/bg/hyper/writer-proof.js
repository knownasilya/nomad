// Proving, over one swarm connection, that a peer is a current Writer of a Drive (ADR-0025 §5).
// Used by the peersockets rooms so a Live Doc page applies document updates only from Writers.
//
// The proof is a signature over `roomId ‖ handshakeHash` by the Drive's writer keypair. Both ends
// of a Noise connection share its handshake hash, so a proof can't be replayed onto another
// connection or another room. In hypercore 11 a writer key is a manifest hash, not the signing key:
// the verifier opens the writer core and checks against its manifest signer (as ai-bridge.js does).

import b4a from 'b4a';
import crypto from 'hypercore-crypto';

const KEY_RE = /^[0-9a-f]{64}$/;

export function proofMessage(roomId, handshakeHash) {
  return b4a.concat([roomId, handshakeHash]);
}

// The frame this Device sends, or null when it holds no writer key for the Drive.
export function makeWriterProof(base, roomId, handshakeHash) {
  const kp = base?.local?.keyPair;
  if (!base?.writable || !kp?.secretKey || !handshakeHash) return null;
  const signature = crypto.sign(proofMessage(roomId, handshakeHash), kp.secretKey);
  return {
    writerKey: b4a.toString(base.local.key, 'hex'),
    signature: b4a.toString(signature, 'hex'),
  };
}

// The frame as sent, or null on anything malformed. A bad frame never breaks the channel.
export function decodeWriterProof(buf) {
  try {
    const obj = JSON.parse(b4a.toString(buf));
    if (
      obj &&
      typeof obj.writerKey === 'string' &&
      KEY_RE.test(obj.writerKey) &&
      typeof obj.signature === 'string' &&
      /^[0-9a-f]{128}$/.test(obj.signature)
    ) {
      return obj;
    }
  } catch {}
  return null;
}

// The ed25519 key a writer core's appends are signed with: its manifest's first signer, or the key
// itself for a legacy core without a manifest. A Writer that was added but hasn't written yet may
// not have sent its manifest to this Device: opening the core asks the peers, so wait a moment.
export async function writerSignerKey(store, writerKeyHex, waitMs = 3000) {
  const core = store.get({ key: b4a.from(writerKeyHex, 'hex') });
  try {
    await core.ready();
    const end = Date.now() + waitMs;
    while (!core.manifest && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 25));
    }
    const signer = core.manifest && core.manifest.signers && core.manifest.signers[0];
    return signer && signer.publicKey ? signer.publicKey : b4a.from(writerKeyHex, 'hex');
  } finally {
    await core.close().catch(() => {});
  }
}

// Whether `key` may append to the base now: its bootstrap key, or a member not removed.
export async function isCurrentWriter(base, key) {
  if (b4a.equals(key, base.key)) return true;
  if (!base.system) return false;
  const info = await base.system.get(key);
  return !!info && !info.isRemoved;
}

// The proven writer key (hex), or null. Re-reads the writer set once, since a Writer added a
// moment ago may not have reached this Device's view yet.
export async function verifyWriterProof({ base, store, roomId, handshakeHash, proof }) {
  if (!proof || !handshakeHash) return null;
  try {
    const signer = await writerSignerKey(store, proof.writerKey);
    const ok = crypto.verify(
      proofMessage(roomId, handshakeHash),
      b4a.from(proof.signature, 'hex'),
      signer
    );
    if (!ok) return null;
    const key = b4a.from(proof.writerKey, 'hex');
    if (await isCurrentWriter(base, key)) return proof.writerKey;
    await base.update();
    return (await isCurrentWriter(base, key)) ? proof.writerKey : null;
  } catch {
    return null;
  }
}
