// Ambient module declarations for plain-JS deps and generated bundles that
// ship without TypeScript types.

declare module 'bare-rpc' {
  export default class RPC {
    constructor (ipc: any, onrequest?: (req: any, error?: any) => void)
    request (command: number): { send: (data: any) => void }
  }
}

// The bundled Bare backend, produced by `bare-pack`.
declare module '*/app.bundle.mjs' {
  const bundle: string
  export default bundle
}

// Shared RPC command constants (plain .mjs, imported by both ends).
declare module '*/rpc-commands.mjs' {
  export const RPC_OPEN: number
  export const RPC_CLOSE: number
  export const RPC_STOP: number
  export const RPC_STATUS: number
  export const RPC_CONTENT: number
  export const RPC_ERROR: number
  export const DRIVE_HYPERDRIVE: 'hyperdrive'
  export const DRIVE_AUTOBASE: 'autobase'
}
