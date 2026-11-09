// The AI's saveAsset (ADR-0044): put a file in the user's Assets, in the turn's Space. The pure
// parts: what the model may pass, and the file's name. ai.ts executeTool asks the `assetsWrite`
// permission, fetches a URL (after the egress check, egress.mjs) or reads a drive file, and
// bg/web-apis/bg/assets.ts saveForAi writes it.
//
// No Electron imports.

import b4a from 'b4a'
import { cleanName, extOf, mimeOf, MAX_AI_BYTES } from '../../../shared/assets.mjs'

export const ASSETS_PERM = 'assetsWrite'

const EXT_FOR = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
  'application/json': 'json',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'text/html': 'html',
  'text/plain': 'txt',
}

/**
 * What saveAsset was asked to save: exactly one of `text`, `base64` or `url`.
 * @returns {{ from: 'text' | 'base64' | 'url', name: string, mime: string, caption: string, bytes?: Uint8Array, url?: string }}
 */
export function assetRequest(args = {}) {
  const sources = ['text', 'base64', 'url'].filter((k) => args[k] != null && args[k] !== '')
  if (sources.length !== 1) throw new Error('saveAsset needs exactly one of `text`, `base64` or `url`')
  const from = /** @type {'text' | 'base64' | 'url'} */ (sources[0])
  const caption = typeof args.caption === 'string' ? args.caption : ''
  const given = typeof args.mime === 'string' ? args.mime : ''
  if (from === 'url') {
    const url = String(args.url).trim()
    if (!/^(https?|hyper):\/\//i.test(url)) throw new Error('`url` must be an http(s) or hyper:// URL')
    return { from, url, name: typeof args.name === 'string' ? args.name : '', mime: given, caption }
  }
  if (typeof args.name !== 'string' || !args.name.trim()) throw new Error('saveAsset needs a file `name`, like "plan.md"')
  let bytes
  if (from === 'text') {
    if (typeof args.text !== 'string') throw new Error('`text` must be a string')
    bytes = b4a.from(args.text)
  } else {
    const raw = String(args.base64).replace(/^data:[^,]*;base64,/, '').replace(/\s+/g, '')
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new Error('`base64` isn’t base64')
    bytes = b4a.from(raw, 'base64')
  }
  sizeCheck(bytes.length)
  const name = cleanName(args.name)
  return { from, name, mime: mimeOf(name, given || (from === 'text' ? 'text/plain' : '')), caption, bytes }
}

export function sizeCheck(n) {
  if (!n) throw new Error('That file is empty')
  if (n > MAX_AI_BYTES) throw new Error(`That file is too big for Assets (at most ${MAX_AI_BYTES / 1048576} MB)`)
}

// A name for a file fetched from `url`: the one the model gave, else the URL's last part, with an
// extension that fits its type.
export function nameForUrl(url, contentType = '', given = '') {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase()
  let name = String(given || '').trim()
  let fromHost = false
  if (!name) {
    try {
      const u = new URL(url)
      const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '')
      name = last || u.hostname
      fromHost = !last
    } catch {
      name = 'Download'
    }
  }
  name = cleanName(name, 'Download')
  const ext = EXT_FOR[type]
  if (ext && (fromHost || !extOf(name))) name += '.' + ext
  return name
}
