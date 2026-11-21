// Passkeys (ADR-0049): the two WebAuthn ceremonies, with Nomad as the authenticator. Given the page's
// publicKey options (base64url buffers), the page's origin as bg read it from the sending frame (never
// from the page), the store and a way to ask the user, these return the credential the page's shim
// turns into a PublicKeyCredential, or { fallback: true } to hand the call to the computer's own
// WebAuthn (a security key or a phone), or throw a PasskeyError the page sees as a DOMException.
//
// No Electron here, so tests run it on Node with a store of their own (tests/unit/passkeys.test.js).
//
//   store:       { list(), create(fields) -> { rec, x, y, spki }, sign(id, bytes) -> DER signature }
//   ask(prompt): -> { action: 'allow' | 'deny' | 'fallback', id?, verified? }
//   sha256(bytes) -> Uint8Array(32)
//   registrable(host) -> the host's registrable domain or null (the Public Suffix List)

import * as R from '../../../shared/passkeys.mjs';

const view = (p) => ({ id: p.id, ...R.accountLabel(p), createdAt: p.createdAt, lastUsedAt: p.lastUsedAt });

export async function register({ publicKey, page, store, ask, sha256, registrable }) {
  const o = R.normalizeCreateOptions(publicKey);
  if (o.crossPlatformOnly) return { fallback: true };
  const rpId = R.checkRpId(o.rp.id, page.host, registrable);
  const all = await store.list();
  const existing = R.excludedPasskey(all, rpId, o.excludeCredentials);
  const answer = await ask({
    kind: existing ? 'exists' : 'create',
    rpId,
    rpName: o.rp.name,
    account: R.accountLabel({ userName: o.user.name, displayName: o.user.displayName }),
    replaces: existing ? 0 : R.replacedBy(all, rpId, o.user.id).length,
    userVerification: o.userVerification,
    timeout: o.timeout,
  });
  if (answer?.action === 'fallback') return { fallback: true };
  // The site already has this passkey: InvalidStateError, only once the user has seen it (§6.3.2 step 3).
  if (existing) throw new R.PasskeyError('InvalidStateError', 'Nomad already has a passkey for this account');
  if (answer?.action !== 'allow') throw new R.PasskeyError('NotAllowedError', 'The user didn’t save a passkey');

  const made = await store.create({
    rpId,
    rpName: o.rp.name,
    userId: o.user.id,
    userName: o.user.name,
    displayName: o.user.displayName,
    origin: page.origin,
  });
  const credentialId = R.fromB64url(made.rec.id);
  const cdj = R.utf8(
    R.clientDataJSON({ type: 'webauthn.create', challenge: o.challenge, origin: page.origin, crossOrigin: !!page.crossOrigin })
  );
  const authData = R.authenticatorData({
    rpIdHash: sha256(R.utf8(rpId)),
    flags: R.flagsFor({ attested: true, verified: !!answer.verified }),
    credentialId,
    coseKey: R.coseEC2(made.x, made.y),
  });
  return {
    credential: {
      id: made.rec.id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: R.toB64url(cdj),
        attestationObject: R.toB64url(R.attestationObject(authData)),
        authenticatorData: R.toB64url(authData),
        transports: ['internal'],
        publicKey: R.toB64url(made.spki),
        publicKeyAlgorithm: R.ES256,
      },
      clientExtensionResults: o.credProps ? { credProps: { rk: true } } : {},
    },
  };
}

export async function authenticate({ publicKey, page, store, ask, sha256, registrable }) {
  const o = R.normalizeGetOptions(publicKey);
  const rpId = R.checkRpId(o.rpId, page.host, registrable);
  const candidates = R.passkeysFor(await store.list(), rpId, o.allowCredentials);
  const answer = await ask({
    kind: candidates.length ? 'get' : 'none',
    rpId,
    passkeys: candidates.map(view),
    userVerification: o.userVerification,
    timeout: o.timeout,
  });
  if (answer?.action === 'fallback') return { fallback: true };
  const picked = candidates.find((p) => p.id === answer?.id);
  if (answer?.action !== 'allow' || !picked)
    throw new R.PasskeyError('NotAllowedError', 'The user didn’t sign in with a passkey');

  const cdj = R.utf8(
    R.clientDataJSON({ type: 'webauthn.get', challenge: o.challenge, origin: page.origin, crossOrigin: !!page.crossOrigin })
  );
  const authData = R.authenticatorData({
    rpIdHash: sha256(R.utf8(rpId)),
    flags: R.flagsFor({ verified: !!answer.verified }),
  });
  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData, 0);
  signed.set(sha256(cdj), authData.length);
  const signature = await store.sign(picked.id, signed);
  return {
    credential: {
      id: picked.id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON: R.toB64url(cdj),
        authenticatorData: R.toB64url(authData),
        signature: R.toB64url(signature),
        userHandle: picked.userId,
      },
      clientExtensionResults: {},
    },
  };
}
