import errors from 'beaker-error-constants'
import { parseDriveUrl } from '../../../lib/urls'
import autobaseManifest from '../manifests/external/autobase'
import { fromEventStream } from './event-target'
import { createStat } from './stat'

const isDriveUrlRe = /^(hyper:\/\/)?[^\/]+/i

export function setup(rpc) {
  const autobaseRPC = rpc.importAPI('autobase', autobaseManifest, { timeout: false, errors })

  function massageUrl(url) {
    if (!url) url = '/'
    if (typeof url !== 'string') {
      if (typeof url.url === 'string') url = url.url
      else if (typeof url.href === 'string') url = url.href
      else throw new Error('Invalid hyper:// URL')
    }
    if (location.protocol === 'hyper:') {
      if (!isDriveUrlRe.test(url)) {
        url = joinPath('hyper://' + location.hostname, url)
      }
    } else if (!url.startsWith('hyper://')) {
      url = 'hyper://' + url
    }
    if (!isDriveUrlRe.test(url)) throw new Error('Invalid URL: must be a hyper:// URL')
    return url
  }

  function joinPath(a = '', b = '') {
    ;[a, b] = [String(a), String(b)]
    const [aSlash, bSlash] = [a.endsWith('/'), b.startsWith('/')]
    if (!aSlash && !bSlash) return a + '/' + b
    if (aSlash && bSlash) return a + b.slice(1)
    return a + b
  }

  function createScopedAPI(url) {
    url = massageUrl(url)
    const urlParsed = parseDriveUrl(url)
    url = 'hyper://' + urlParsed.hostname + '/'

    autobaseRPC.loadDrive(url)

    return {
      get url() { return url },

      async getInfo(opts = {}) { return autobaseRPC.getInfo(url, opts) },
      async configure(info, opts = {}) { return autobaseRPC.configure(url, info, opts) },

      async entry(path, opts = {}) { return autobaseRPC.entry(joinPath(url, path), opts) },
      async get(path, opts = {}) { return autobaseRPC.get(joinPath(url, path), opts) },
      async put(path, data, opts = {}) { return autobaseRPC.put(joinPath(url, path), data, opts) },
      async del(path, opts = {}) { return autobaseRPC.del(joinPath(url, path), opts) },
      async list(path = '/', opts = {}) { return autobaseRPC.list(joinPath(url, path), opts) },
      async mkdir(path, opts = {}) { return autobaseRPC.mkdir(joinPath(url, path), opts) },
      async rmdir(path, opts = {}) { return autobaseRPC.rmdir(joinPath(url, path), opts) },
      async copy(src, dst, opts = {}) {
        return autobaseRPC.copy(joinPath(url, src), joinPath(url, dst), opts)
      },
      async rename(src, dst, opts = {}) {
        return autobaseRPC.rename(joinPath(url, src), joinPath(url, dst), opts)
      },
      async diff(other, opts = {}) { return autobaseRPC.diff(url, other, opts) },
      async updateMetadata(path, metadata, opts = {}) {
        return autobaseRPC.updateMetadata(joinPath(url, path), metadata, opts)
      },
      async deleteMetadata(path, keys, opts = {}) {
        return autobaseRPC.deleteMetadata(joinPath(url, path), keys, opts)
      },

      watch(pathSpec = null, onChanged = null) {
        if (typeof pathSpec === 'function') { onChanged = pathSpec; pathSpec = null }
        const evts = fromEventStream(autobaseRPC.watch(url, pathSpec))
        if (onChanged) evts.addEventListener('changed', onChanged)
        return evts
      },

      // v10 compat
      async stat(path, opts = {}) {
        return createStat(await autobaseRPC.stat(joinPath(url, path), opts))
      },
      async readFile(path, opts = {}) { return autobaseRPC.readFile(joinPath(url, path), opts) },
      async writeFile(path, data, opts = {}) {
        return autobaseRPC.writeFile(joinPath(url, path), data, opts)
      },
      async unlink(path, opts = {}) { return autobaseRPC.unlink(joinPath(url, path), opts) },
      async readdir(path = '/', opts = {}) {
        var names = await autobaseRPC.readdir(joinPath(url, path), opts)
        if (opts.includeStats) {
          names.forEach((name) => { name.stat = createStat(name.stat) })
        }
        return names
      },

      // Writer management (scoped to this drive)
      async createInvite(opts = {}) { return autobaseRPC.createInvite(url, opts) },
      async listRequests() { return autobaseRPC.listRequests(url) },
      async approveRequest(writerKey, opts = {}) {
        return autobaseRPC.approveRequest(url, writerKey, opts)
      },
      async denyRequest(writerKey) { return autobaseRPC.denyRequest(url, writerKey) },
      async removeWriter(writerKey) { return autobaseRPC.removeWriter(url, writerKey) },
      async listWriters() { return autobaseRPC.listWriters(url) },
    }
  }

  return {
    collaborativeDrive(url) {
      return createScopedAPI(url)
    },

    async createCollaborativeDrive(opts = {}) {
      const newUrl = await autobaseRPC.createCollaborativeDrive(opts)
      return createScopedAPI(newUrl)
    },

    // Top-level writer management for use outside a scoped drive
    async claimInvite(inviteUrl, opts = {}) {
      return autobaseRPC.claimInvite(inviteUrl, opts)
    },

    async requestAccess(url, opts = {}) {
      url = massageUrl(url)
      return autobaseRPC.requestAccess(url, opts)
    },

    async listWriters(url) {
      url = massageUrl(url)
      return autobaseRPC.listWriters(url)
    },

    // Top-level read helpers (without a scoped drive instance)
    async getInfo(url, opts = {}) {
      url = massageUrl(url)
      return autobaseRPC.getInfo(url, opts)
    },

    async isCollaborativeDrive(url) {
      url = massageUrl(url)
      return autobaseRPC.isCollaborativeDrive(url)
    },
  }
}
