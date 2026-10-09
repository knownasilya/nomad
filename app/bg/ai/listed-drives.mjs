// Drives listed for public search, for the AI's search tool (the drive domain in
// search-execute.mjs). Asks the browser's own search crawler — the one nomad://search uses
// (bg/hyper/crawler-host.js) — over its loopback HTTP API.
//
// No Electron imports. Node http, not global fetch: in the Electron main process global fetch goes
// through Chromium's network stack and is unreliable on loopback (see bg/hyper/ai-bridge.js).

import http from 'http'

// bg/hyper/crawler-host.js CRAWLER_PORT; the crawler serves 127.0.0.1 only.
export const CRAWLER_URL = 'http://127.0.0.1:8787'

const TIMEOUT_MS = 2000
const LIMIT = 20

// Listed drives matching `query` ('' lists them all), best first. Resolves to [] when the crawler
// is off or doesn't answer in time: a search should never fail just because discovery is down.
export function searchListedDrives(query = '', { topic = '', endpoint = CRAWLER_URL } = {}) {
  const url = `${endpoint}/search?q=${encodeURIComponent(query)}&topic=${encodeURIComponent(topic)}`
  return new Promise((resolve) => {
    let req
    try {
      req = http.get(url, { headers: { accept: 'application/json' } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          return resolve([])
        }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          try {
            const data = JSON.parse(body)
            resolve(Array.isArray(data.results) ? data.results.slice(0, LIMIT) : [])
          } catch {
            resolve([])
          }
        })
        res.on('error', () => resolve([]))
      })
    } catch {
      return resolve([])
    }
    req.on('error', () => resolve([]))
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy()
      resolve([])
    })
  })
}
