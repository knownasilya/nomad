// Pure, dependency-injected backend router for the beaker.fs facade (used by fs.js).
//
// WHY THIS IS A SEPARATE, DI MODULE: the routing *decisions* are the regression-prone part (the
// autobase-port breakage where `hyper://private/` — a root drive the Vault migration converted to an
// Autobase — was mis-detected as a Hyperdrive and hung ~60s). Pulling them out of the Electron-
// coupled fs.js lets them be unit-tested with plain fakes (see tests/unit/fs-router.test.js), the
// same DI pattern shared/fs-core.mjs uses. This module imports NOTHING — every collaborator is
// injected — so it loads under any runtime/test runner.
//
// Injected deps:
//   hyperdriveAPI, autobaseAPI  — the two backend impls (objects of async methods)
//   isCollaborativeDrive(url)   — true if the (canonical) url is an Autobase
//   isRootUrl(url)              — true for the private/space root drive (always local)
//   getDriveConfig(key)         — registry entry for a hex key, or undefined
//   fromURLToKey(url, dns?)     — resolve a url (incl. dns aliases like 'private') to a hex key
//   spaceRootKeyForSender(ctx)  — hex key of the caller's space root, or null (per-space 'private')
//   parseDriveUrl(url)          — { hostname, version, pathname, search }
const HEX_KEY = /^[0-9a-f]{64}$/i

export function createFsRouter(deps) {
  const {
    hyperdriveAPI, autobaseAPI,
    isCollaborativeDrive, isRootUrl, getDriveConfig,
    fromURLToKey, spaceRootKeyForSender, parseDriveUrl,
  } = deps

  const _other = (api) => (api === autobaseAPI ? hyperdriveAPI : autobaseAPI)
  const _keyFromUrl = (url) => { try { return parseDriveUrl(url).hostname } catch { return url } }

  // Resolve the hostname (incl. the per-space `private` alias) to its real hex key.
  async function _resolveKey(ctx, url) {
    if (_keyFromUrl(url) === 'private') {
      const k = await spaceRootKeyForSender(ctx)
      if (k) return k
    }
    return fromURLToKey(url, true)
  }

  // Rewrite a url to canonical `hyper://<hexkey>/…` form BEFORE detection, so aliases (esp.
  // `private`) resolve and both detection AND the backend impl see the real key. This is what
  // stops an Autobase root drive from being mis-routed to the Hyperdrive backend (which hangs).
  async function canonical(ctx, url) {
    try {
      const key = await _resolveKey(ctx, url)
      if (key && HEX_KEY.test(key)) {
        const urlp = parseDriveUrl(url)
        const version = urlp.version ? `+${urlp.version}` : ''
        return `hyper://${key}${version}${urlp.pathname || '/'}${urlp.search || ''}`
      }
    } catch { /* fall through to the original url */ }
    return url
  }

  async function _isAutobase(url) {
    try { return await isCollaborativeDrive(url) } catch { return false }
  }

  // Canonicalise + pick the backend. Returns the resolved url alongside the api.
  async function dispatch(ctx, url) {
    const u = await canonical(ctx, url)
    const isAutobase = await _isAutobase(u)
    return { api: isAutobase ? autobaseAPI : hyperdriveAPI, url: u, isAutobase }
  }

  // True when the backend is KNOWN locally, so a "not here" result is authoritative and we must NOT
  // retry under the other backend (opening the wrong backend blocks for minutes). `url` is canonical.
  function backendKnown(url, isAutobase) {
    if (isAutobase) return true // known Autobase: session, registry, or persisted meta
    try {
      if (isRootUrl(url)) return true // a root/space drive is always local — a miss is real
      if (getDriveConfig(_keyFromUrl(url))) return true // locally-registered → type known
    } catch { /* treat detection errors as "unknown" */ }
    return false
  }

  // Read with a single fallback to the other backend when the detected one returns nothing (covers
  // remote drives whose type isn't known locally yet). null / empty-array = "not here". The
  // fallback is SKIPPED for known-local drives — otherwise a missing file hangs opening the wrong
  // backend. `empty` treats null and [] as absent.
  async function read(ctx, method, url, rest) {
    const { api: primary, url: u, isAutobase } = await dispatch(ctx, url)
    const other = _other(primary)
    const known = backendKnown(u, isAutobase)
    const empty = (r) => r == null || (Array.isArray(r) && r.length === 0)
    try {
      const res = await primary[method].call(ctx, u, ...rest)
      if (known || !empty(res)) return res
      try { const alt = await other[method].call(ctx, u, ...rest); if (!empty(alt)) return alt } catch { /* ignore */ }
      return res
    } catch (e) {
      if (known) throw e
      try { return await other[method].call(ctx, u, ...rest) } catch { /* ignore */ }
      throw e
    }
  }

  return { canonical, dispatch, backendKnown, read }
}
