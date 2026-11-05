// `node:crypto` for the Bare worklet, which has none. Yjs's lib0 (lib0/webcrypto, its "node"
// export) imports `webcrypto` from it for random Yjs client ids; tools/bare-imports.cjs points the
// bundle here (npm run bundle). Only getRandomValues is used, from sodium like the rest of the
// backend's randomness. Live Notes, ADR-0041.
import sodium from 'sodium-universal'

function getRandomValues (arr) {
  sodium.randombytes_buf(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength))
  return arr
}

export const webcrypto = { getRandomValues, subtle: undefined }
export default { webcrypto }
