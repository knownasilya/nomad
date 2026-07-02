import b4a from 'b4a'
import z32 from 'z32'

// Parse a hyper:// URL into a 32-byte drive key + in-drive path.
//
// Accepted forms:
//   hyper://<key>/path/to/file
//   hyper://<key>
//   <key>/path           (scheme optional, assumed hyper)
//
// <key> may be a 52-char z-base-32 key or a 64-char hex key.
export function parseHyperUrl (input) {
  let s = String(input || '').trim()
  if (s.startsWith('hyper://')) s = s.slice('hyper://'.length)

  const slash = s.indexOf('/')
  const keyStr = slash === -1 ? s : s.slice(0, slash)
  let path = slash === -1 ? '/' : s.slice(slash)
  if (!path.startsWith('/')) path = '/' + path

  const key = decodeKey(keyStr)
  if (!key) throw new Error(`Invalid hyper key: "${keyStr}"`)

  return { key, keyHex: b4a.toString(key, 'hex'), path }
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
