import b4a from 'b4a'
import z32 from 'z32'

// Parse a hyper:// URL into a 32-byte drive key + in-drive path.
//
// Accepted forms:
//   hyper://<key>/path/to/file
//   hyper://<key>/?invite=<token>
//   hyper://<key>
//   <key>/path           (scheme optional, assumed hyper)
//
// The query string and fragment are split off the path — a hyper URL's path
// addresses a file inside the drive, so `/?invite=x` must resolve to the drive
// root `/`, not to a (nonexistent) file literally named `/?invite=x`. This
// mirrors desktop's parseDriveUrl (pathname vs. search). The `search` is
// returned so callers can still read params like the writer-invite token.
//
// <key> may be a 52-char z-base-32 key or a 64-char hex key.
export function parseHyperUrl (input) {
  let s = String(input || '').trim()
  if (s.startsWith('hyper://')) s = s.slice('hyper://'.length)

  // The key runs up to the first '/', '?', or '#'; everything after is the path.
  const boundary = s.search(/[/?#]/)
  const keyStr = boundary === -1 ? s : s.slice(0, boundary)
  let rest = boundary === -1 ? '' : s.slice(boundary)

  // Drop the fragment, then split off the query string.
  const hashIdx = rest.indexOf('#')
  if (hashIdx !== -1) rest = rest.slice(0, hashIdx)
  let search = ''
  const qIdx = rest.indexOf('?')
  if (qIdx !== -1) {
    search = rest.slice(qIdx)
    rest = rest.slice(0, qIdx)
  }

  let path = rest || '/'
  if (!path.startsWith('/')) path = '/' + path

  const key = decodeKey(keyStr)
  if (!key) throw new Error(`Invalid hyper key: "${keyStr}"`)

  return { key, keyHex: b4a.toString(key, 'hex'), path, search }
}

function decodeKey (str) {
  if (!str) return null
  // hex (64 chars)
  if (/^[0-9a-fA-F]{64}$/.test(str)) return b4a.from(str, 'hex')
  // z-base-32 (Holepunch keys are 52 chars)
  try {
    const buf = z32.decode(str)
    if (buf.length === 32) return buf
  } catch {}
  return null
}

export function isHyperUrl (input) {
  const s = String(input || '').trim()
  if (s.startsWith('hyper://')) return true
  // bare key with optional path, no other scheme
  if (/^[0-9a-fA-F]{64}(\/|$)/.test(s)) return true
  if (/^[a-z2-7]{52}(\/|$)/.test(s)) return true
  return false
}
