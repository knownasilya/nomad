// The Peer's packages, resolved from the phone backend's install (mobile/node_modules), so the Peer
// runs the same pinned Autobase, Hyperbee and Corestore as the phone (ADR-0038 §2). Run
// `npm install` in mobile/ once; the Peer needs nothing else.

import { createRequire } from 'module'

const rq = createRequire(new URL('../mobile/package.json', import.meta.url))
const load = (name) => {
  const m = rq(name)
  return m && m.default ? m.default : m
}

export const Corestore = load('corestore')
export const Hyperswarm = load('hyperswarm')
export const Protomux = load('protomux')
export const c = load('compact-encoding')
export const b4a = load('b4a')
