import { app } from 'electron'
import HyperdriveDaemon from 'hyperdrive-daemon'
import * as HyperdriveDaemonManager from 'hyperdrive-daemon/manager'
import { createMetadata } from 'hyperdrive-daemon/lib/metadata'
import constants from 'hyperdrive-daemon-client/lib/constants'
import { HyperdriveClient } from 'hyperdrive-daemon-client'
import datEncoding from 'dat-encoding'
import * as pda from 'pauls-dat-api2'
import pm2 from 'pm2'
import EventEmitter from 'events'
import { getEnvVar } from '../lib/env'

const SETUP_RETRIES = 100
const CHECK_DAEMON_INTERVAL = 5e3
const GARBAGE_COLLECT_SESSIONS_INTERVAL = 30e3
const MAX_SESSION_AGE = 300e3 // 5min

// typedefs
// =

/**
* @typedef {Object} DaemonHyperdrive
* @prop {number} sessionId
* @prop {Buffer} key
* @prop {string} url
* @prop {string} domain
* @prop {boolean} writable
* @prop {Boolean} persistSession
* @prop {Object} session
* @prop {Object} session.drive
* @prop {function(): Promise<void>} session.close
* @prop {function(Object): Promise<void>} session.configureNetwork
* @prop {function(): Promise<Object>} getInfo
* @prop {DaemonHyperdrivePDA} pda
*
* @typedef {Object} DaemonHyperdrivePDA
* @prop {Number} lastCallTime
* @prop {Number} numActiveStreams
* @prop {function(string): Promise<Object>} stat
* @prop {function(string, Object=): Promise<any>} readFile
* @prop {function(string, Object=): Promise<Array<Object>>} readdir
* @prop {function(string): Promise<number>} readSize
* @prop {function(number, string?): Promise<Array<Object>>} diff
* @prop {function(string, any, Object=): Promise<void>} writeFile
* @prop {function(string): Promise<void>} mkdir
* @prop {function(string, string): Promise<void>} copy
* @prop {function(string, string): Promise<void>} rename
* @prop {function(string, Object): Promise<void>} updateMetadata
* @prop {function(string, string|string[]): Promise<void>} deleteMetadata
* @prop {function(string): Promise<void>} unlink
* @prop {function(string, Object=): Promise<void>} rmdir
* @prop {function(string, string|Buffer): Promise<void>} mount
* @prop {function(string): Promise<void>} unmount
* @prop {function(string=): NodeJS.ReadableStream} watch
* @prop {function(): NodeJS.ReadableStream} createNetworkActivityStream
* @prop {function(): Promise<Object>} readManifest
* @prop {function(Object): Promise<void>} writeManifest
* @prop {function(Object): Promise<void>} updateManifest
*/

// globals
// =

var client // client object created by hyperdrive-daemon-client
var isSettingUp = true
var isDaemonActive = false
var isFirstConnect = true
var sessions = {} // map of keyStr => DaemonHyperdrive
var events = new EventEmitter()

// exported apis
// =

export const on = events.on.bind(events)

export function isActive () {
  if (isFirstConnect) {
    // the "inactive daemon" indicator during setup
    return true
  }
  return isDaemonActive
}

export async function setup () {
  if (isSettingUp) {
    isSettingUp = false

    // watch for the daemon process to die/revive
    let interval = setInterval(() => {
      pm2.list((err, processes) => {
        var processExists = !!processes.find(p => p.name === 'hyperdrive' && p.pm2_env.status === 'online')
        if (processExists && !isDaemonActive) {
          isDaemonActive = true
          isFirstConnect = false
          events.emit('daemon-restored')
        } else if (!processExists && isDaemonActive) {
          isDaemonActive = false
          events.emit('daemon-stopped')
        }
      })
    }, CHECK_DAEMON_INTERVAL)
    interval.unref()

    events.on('daemon-restored', async () => {
      console.log('Hyperdrive daemon has been restored')
    })
    events.on('daemon-stopped', async () => {
      console.log('Hyperdrive daemon has been lost')
    })

    // periodically close sessions
    let interval2 = setInterval(() => {
      let now = Date.now()
      for (let key in sessions) {
        if (sessions[key].persistSession) continue
        if (sessions[key].pda.numActiveStreams > 0) continue
        if (now - sessions[key].pda.lastCallTime < MAX_SESSION_AGE) continue
        closeHyperdriveSession(key)
      }
    }, GARBAGE_COLLECT_SESSIONS_INTERVAL)
    interval2.unref()
  }

  try {
    client = new HyperdriveClient()
    await client.ready()
    console.log('Connected to an external daemon.')
    reconnectAllDriveSessions()
    return
  } catch (err) {
    console.log('Failed to connect to an external daemon. Launching the daemon...')
    client = false
  }

  if (getEnvVar('EMBED_HYPERDRIVE_DAEMON')) {
    await createMetadata(`localhost:${constants.port}`)
    var daemon = new HyperdriveDaemon()
    await daemon.start()
    process.on('exit', () => daemon.stop())
  } else {
    await HyperdriveDaemonManager.start({
      interpreter: app.getPath('exe'),
      env: Object.assign({}, process.env, {ELECTRON_RUN_AS_NODE: 1}),
      memoryOnly: false,
      heapSize: 4096, // 4GB heap
      storage: constants.root
    })
  }

  await attemptConnect()
  reconnectAllDriveSessions()
}

/**
 * Gets a hyperdrives interface to the daemon for the given key
 *
 * @param {Object|string} opts
 * @param {Buffer} [opts.key]
 * @param {number} [opts.version]
 * @param {Buffer} [opts.hash]
 * @param {boolean} [opts.writable]
 * @returns {DaemonHyperdrive}
 */
export function getHyperdriveSession (opts) {
  return sessions[createSessionKey(opts)]
}

/**
 * Creates a hyperdrives interface to the daemon for the given key
 *
 * @param {Object} opts
 * @param {Buffer} [opts.key]
 * @param {number} [opts.version]
 * @param {Buffer} [opts.hash]
 * @param {boolean} [opts.writable]
 * @returns {Promise<DaemonHyperdrive>}
 */
export async function createHyperdriveSession (opts) {
  if (opts.key) {
    let sessionKey = createSessionKey(opts)
    if (sessions[sessionKey]) return sessions[sessionKey]
  }

  const drive = await client.drive.get(opts)
  const key = opts.key = datEncoding.toStr(drive.key)
  var driveObj = {
    key: datEncoding.toBuf(key),
    url: `hyper://${key}/`,
    writable: drive.writable,
    domain: undefined,
    persistSession: false,

    session: {
      drive,
      opts,
      async close () {
        delete sessions[key]
        return this.drive.close()
      }
    },

    async getInfo () {
      var [version, stats] = await Promise.all([
        this.session.drive.version(),
        this.session.drive.stats({networkingOnly: true})
      ])
      return {
        version,
        peers: stats.stats[0].metadata.peers
      }
    },

    pda: createHyperdriveSessionPDA(drive)
  }
  sessions[createSessionKey(opts)] = driveObj
  return /** @type DaemonHyperdrive */(driveObj)
}

/**
 * Closes a hyperdrives interface to the daemon for the given key
 *
 * @param {Object|string} opts
 * @param {Buffer} [opts.key]
 * @param {number} [opts.version]
 * @param {Buffer} [opts.hash]
 * @param {boolean} [opts.writable]
 * @returns {void}
 */
export function closeHyperdriveSession (opts) {
  var key = createSessionKey(opts)
  if (sessions[key]) {
    sessions[key].session.close()
    delete sessions[key]
  }
}

// internal methods
// =

function createSessionKey (opts) {
  if (typeof opts === 'string') {
    return opts // assume it's already a session key
  }
  var key = opts.key.toString('hex')
  if (opts.version) {
    key += `+${opts.version}`
  }
  if ('writable' in opts) {
    key += `+${opts.writable ? 'w' : 'ro'}`
  }
  return key
}

async function attemptConnect () {
  var connectBackoff = 100
  for (let i = 0; i < SETUP_RETRIES; i++) {
    try {
      client = new HyperdriveClient()
      await client.ready()
    } catch (e) {
      console.log('Failed to connect to daemon, retrying')
      await new Promise(r => setTimeout(r, connectBackoff))
      connectBackoff += 100
    }
  }
}

async function reconnectAllDriveSessions () {
  for (let sessionKey in sessions) {
    await reconnectDriveSession(sessions[sessionKey])
  }
}

async function reconnectDriveSession (driveObj) {
  const drive = await client.drive.get(driveObj.session.opts)
  driveObj.session.drive = drive
  driveObj.pda = createHyperdriveSessionPDA(drive)
}

/**
 * Provides a pauls-dat-api2 object for the given drive
 * @param {Object} drive
 * @returns {DaemonHyperdrivePDA}
 */
function createHyperdriveSessionPDA (drive) {
  var obj = {
    lastCallTime: Date.now(),
    numActiveStreams: 0
  }
  for (let k in pda) {
    if (typeof pda[k] === 'function') {
      obj[k] = async (...args) => {
        obj.lastCallTime = Date.now()
        if (k === 'watch') {
          obj.numActiveStreams++
          let stream = pda.watch.call(pda, drive, ...args)
          stream.on('close', () => {
            obj.numActiveStreams--
          })
          return stream
        }
        return pda[k].call(pda, drive, ...args)
      }
    }
  }
  return obj
}
