/*
Passkeys, the page's side (ADR-0049). This function runs in the page's MAIN world (the preload
injects its source with webFrame.executeJavaScript), so it must not use anything from outside its
own body. It wraps navigator.credentials.create() and .get(): a call with `publicKey` goes to
`bridge` (the preload's contextBridge object, which asks bg over IPC); everything else, and every
call bg hands back with { fallback: true }, goes to the browser's own WebAuthn untouched.

What comes back is built to look like the browser's own: a PublicKeyCredential whose response is an
AuthenticatorAttestationResponse or AuthenticatorAssertionResponse, with ArrayBuffers, the
getTransports()/getAuthenticatorData()/getPublicKey() helpers and toJSON(). Nothing here holds a key
or decides anything: bg reads the origin from the frame and signs.
*/

export function installPasskeyShim(bridge, win) {
  const nav = win.navigator;
  const creds = nav && nav.credentials;
  const PKC = win.PublicKeyCredential;
  if (!bridge || !creds || !PKC || creds.__nomadPasskeys) return false;

  const nativeCreate = creds.create.bind(creds);
  const nativeGet = creds.get.bind(creds);

  const b64url = (buf) => {
    const bytes =
      buf instanceof ArrayBuffer
        ? new Uint8Array(buf)
        : ArrayBuffer.isView(buf)
          ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
          : null;
    if (!bytes) throw new TypeError('Expected a BufferSource');
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return win.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const unb64url = (str) => {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = win.atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  };
  const credList = (list) =>
    Array.isArray(list)
      ? list.map((c) => ({ type: c && c.type, id: b64url(c.id), transports: c && c.transports }))
      : undefined;

  // The options as plain JSON for the bridge. A bad buffer is the page's TypeError, as natively.
  function createJSON(pk) {
    return {
      rp: pk.rp ? { id: pk.rp.id, name: pk.rp.name } : undefined,
      user: pk.user
        ? { id: b64url(pk.user.id), name: pk.user.name, displayName: pk.user.displayName }
        : undefined,
      challenge: b64url(pk.challenge),
      pubKeyCredParams: Array.isArray(pk.pubKeyCredParams)
        ? pk.pubKeyCredParams.map((p) => ({ type: p && p.type, alg: p && p.alg }))
        : undefined,
      timeout: pk.timeout,
      excludeCredentials: credList(pk.excludeCredentials),
      authenticatorSelection: pk.authenticatorSelection
        ? {
            authenticatorAttachment: pk.authenticatorSelection.authenticatorAttachment,
            residentKey: pk.authenticatorSelection.residentKey,
            requireResidentKey: pk.authenticatorSelection.requireResidentKey,
            userVerification: pk.authenticatorSelection.userVerification,
          }
        : undefined,
      attestation: pk.attestation,
      extensions: pk.extensions && pk.extensions.credProps ? { credProps: true } : undefined,
    };
  }
  function getJSON(pk) {
    return {
      challenge: b64url(pk.challenge),
      timeout: pk.timeout,
      rpId: pk.rpId,
      allowCredentials: credList(pk.allowCredentials),
      userVerification: pk.userVerification,
    };
  }

  const own = (obj, props) => {
    for (const k of Object.keys(props))
      Object.defineProperty(obj, k, { value: props[k], enumerable: true, configurable: true });
    return obj;
  };

  function toCredential(c) {
    const r = c.response;
    const isCreate = typeof r.attestationObject === 'string';
    const Resp = isCreate ? win.AuthenticatorAttestationResponse : win.AuthenticatorAssertionResponse;
    const response = Object.create(Resp ? Resp.prototype : Object.prototype);
    const clientDataJSON = unb64url(r.clientDataJSON);
    if (isCreate) {
      const attestationObject = unb64url(r.attestationObject);
      own(response, {
        clientDataJSON,
        attestationObject,
        getTransports: () => r.transports.slice(),
        getAuthenticatorData: () => unb64url(r.authenticatorData),
        getPublicKey: () => unb64url(r.publicKey),
        getPublicKeyAlgorithm: () => r.publicKeyAlgorithm,
      });
    } else {
      own(response, {
        clientDataJSON,
        authenticatorData: unb64url(r.authenticatorData),
        signature: unb64url(r.signature),
        userHandle: r.userHandle ? unb64url(r.userHandle) : null,
      });
    }
    const ext = c.clientExtensionResults || {};
    const cred = Object.create(PKC.prototype);
    own(cred, {
      id: c.id,
      rawId: unb64url(c.id),
      type: 'public-key',
      authenticatorAttachment: c.authenticatorAttachment,
      response,
      getClientExtensionResults: () => JSON.parse(JSON.stringify(ext)),
      // WebAuthn L3's JSON form, what libraries send to the server.
      toJSON: () => ({
        id: c.id,
        rawId: c.id,
        type: 'public-key',
        authenticatorAttachment: c.authenticatorAttachment,
        response: JSON.parse(JSON.stringify(r)),
        clientExtensionResults: JSON.parse(JSON.stringify(ext)),
      }),
    });
    return cred;
  }

  let seq = 0;
  function call(kind, options, json, native) {
    const signal = options.signal;
    if (signal && signal.aborted)
      return Promise.reject(signal.reason || new win.DOMException('The operation was aborted.', 'AbortError'));
    const id = `${Date.now().toString(36)}-${++seq}`;
    return new Promise((resolve, reject) => {
      let done = false;
      const onAbort = () => {
        if (done) return;
        done = true;
        bridge.cancel(id);
        reject(signal.reason || new win.DOMException('The operation was aborted.', 'AbortError'));
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(bridge[kind](id, json)).then(
        (res) => {
          if (done) return;
          done = true;
          if (signal) signal.removeEventListener('abort', onAbort);
          if (res && res.fallback) return resolve(native(options));
          if (res && res.credential) return resolve(toCredential(res.credential));
          const e = (res && res.error) || {};
          reject(new win.DOMException(e.message || 'The operation either timed out or was not allowed.', e.name || 'NotAllowedError'));
        },
        () => {
          if (done) return;
          done = true;
          reject(new win.DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'));
        }
      );
    });
  }

  function create(options) {
    if (!options || !options.publicKey) return nativeCreate(options);
    let json;
    try {
      json = createJSON(options.publicKey);
    } catch (e) {
      return Promise.reject(e);
    }
    return call('create', options, json, nativeCreate);
  }

  function get(options) {
    // Conditional (autofill) requests wait for a pick from a field's menu, which Nomad doesn't draw:
    // they stay with the browser, and isConditionalMediationAvailable() says no.
    if (!options || !options.publicKey || options.mediation === 'conditional') return nativeGet(options);
    let json;
    try {
      json = getJSON(options.publicKey);
    } catch (e) {
      return Promise.reject(e);
    }
    return call('get', options, json, nativeGet);
  }

  const define = (obj, name, value) =>
    Object.defineProperty(obj, name, { value, writable: true, configurable: true, enumerable: false });
  define(creds, 'create', create);
  define(creds, 'get', get);
  define(creds, '__nomadPasskeys', true);
  define(PKC, 'isUserVerifyingPlatformAuthenticatorAvailable', () => Promise.resolve(true));
  define(PKC, 'isConditionalMediationAvailable', () => Promise.resolve(false));
  if (typeof PKC.getClientCapabilities === 'function') {
    const nativeCaps = PKC.getClientCapabilities.bind(PKC);
    define(PKC, 'getClientCapabilities', () =>
      Promise.resolve(nativeCaps())
        .catch(() => ({}))
        .then((caps) =>
          Object.assign({}, caps, {
            conditionalCreate: false,
            conditionalGet: false,
            passkeyPlatformAuthenticator: true,
            userVerifyingPlatformAuthenticator: true,
          })
        )
    );
  }
  return true;
}
