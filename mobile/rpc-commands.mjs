// Shared RPC command IDs for UI <-> Bare backend communication.
// Both `app/index.tsx` (React Native side) and `backend/backend.mjs`
// (Bare worklet side) import this file so the two ends agree on the wire
// protocol. Every payload is JSON, encoded/decoded with b4a.

// UI -> backend
export const RPC_OPEN = 1 // { tabId, url, driveType, ns? } navigate a tab to a hyper:// url
export const RPC_CLOSE = 2 // { tabId } tab closed, release its drive
export const RPC_STOP = 3 // { tabId } cancel an in-flight load
export const RPC_CREATE = 4 // { reqId, type, title, description } create a new writable drive
export const RPC_PAIR_SUBMIT = 5 // { reqId, code, name } join an identity's Vault via invite code
export const RPC_VAULT_STATUS = 6 // { reqId } request current Vault status (devices + spaces)
export const RPC_RENAME_DEVICE = 7 // { reqId, deviceKey, name } rename a device in the Vault
export const RPC_VAULT_ADD_SPACE = 8 // { reqId, rootDriveKey, name, icon, color } register a space in the Vault
export const RPC_SPACE_DRIVES = 9 // { reqId, rootDriveKey, ns? } read a space's drive registry (/drives.json)
export const RPC_REMOVE_DEVICE = 16 // { reqId, deviceKey, self } removeWriter + drop record; self => also forget the Vault on this device
export const RPC_SPACE_ADD_DRIVE = 17 // { reqId, rootDriveKey, ns?, key, type? } add a drive to a space's /drives.json registry
export const RPC_HOSTING = 18 // { reqId, action:'get'|'set', driveType, key, on? } query/toggle hosting (seeding) a drive
export const RPC_BOOKMARKS = 26 // { reqId, action:'list'|'add'|'remove', rootDriveKey, ns?, href?, title? }
export const RPC_NOMAD = 40 // { reqId, api, method, url?, args } an in-page nomad.* call from a drive WebView

// UI -> backend: AI chat is STREAMING (nomad.ai.chat is a readable), so unlike RPC_NOMAD it can't
// use the single-reply RPC_*_RESULT pattern. One RPC_AI_CHAT fans out many RPC_AI_EVENT frames
// (chunk/tool/prompt/done/error) keyed by reqId until a terminal done|error. The turn runs on a
// remote AI Provider over the AI Bridge (ADR-0013); this device is the AI Client.
export const RPC_AI_CHAT = 42 // { reqId, messages, opts } start a remote chat turn
export const RPC_AI_CANCEL = 43 // { reqId } abort an in-flight turn (-> CANCEL frame on the Bridge)
export const RPC_AI_PROMPT_RESULT = 44 // { reqId, allow } answer a relayed modifyDrive consent prompt

// UI -> backend: file-system ops on a writable drive you own (identified by ns).
// `key` is the drive key hex; `path` is a drive-absolute path ('/a/b.txt').
export const RPC_FS_LIST = 20 // { reqId, driveType, key, ns, path } list a folder's children
export const RPC_FS_READ = 21 // { reqId, driveType, key, ns, path } read raw file bytes
export const RPC_FS_WRITE = 22 // { reqId, driveType, key, ns, path, base64 } write/replace a file
export const RPC_FS_DELETE = 23 // { reqId, driveType, key, ns, path, isDir } delete a file/folder
export const RPC_FS_RENAME = 24 // { reqId, driveType, key, ns, from, to, isDir } move a file/folder
export const RPC_FS_MKDIR = 25 // { reqId, driveType, key, ns, path } create an empty folder

// backend -> UI
export const RPC_STATUS = 10 // { tabId, phase, message, peers } progress updates
export const RPC_CONTENT = 11 // { tabId, url, ok, mime, isDir, entries?, bodyBase64?, key }
export const RPC_ERROR = 12 // { tabId, url, message }
export const RPC_CREATED = 13 // { reqId, ok, url, key, type, ns, title, message? }
export const RPC_PAIRED = 14 // { reqId, ok, vaultKey?, deviceKey?, writable?, message? }
export const RPC_VAULT = 15 // { reqId, hasVault, vaultKey?, devices?, spaces?, writable? }
export const RPC_FS_RESULT = 30 // { reqId, ok, entries?, writable?, base64?, mime?, exists?, message? } reply to any RPC_FS_*
export const RPC_SPACE_DRIVES_RESULT = 31 // { reqId, ok, drives?, message? } reply to RPC_SPACE_DRIVES
export const RPC_BOOKMARKS_RESULT = 32 // { reqId, ok, bookmarks?, message? } reply to RPC_BOOKMARKS
export const RPC_HOSTING_RESULT = 33 // { reqId, ok, hosted?, message? } reply to RPC_HOSTING
export const RPC_NOMAD_RESULT = 41 // { reqId, ok, value?, error? } reply to RPC_NOMAD
export const RPC_AI_EVENT = 45 // { reqId, kind:'chunk'|'tool'|'prompt'|'done'|'error', text?, event?, permission?, message? } one streamed AI frame

// Drive types understood by the backend resolver.
export const DRIVE_HYPERDRIVE = 'hyperdrive'
export const DRIVE_AUTOBASE = 'autobase'
