import errors from 'beaker-error-constants';
import { parseDriveUrl } from '../../../lib/urls';
import fsManifest from '../manifests/external/fs';
import { fromEventStream } from './event-target';
import { createStat } from './stat';

// beaker.fs — the unified, backend-agnostic filesystem API (ADR-0010 Phase 2). Mirrors the
// beaker.hyperdrive / beaker.autobase fg shape: `beaker.fs.drive(url)` returns a scoped handle,
// and top-level helpers take a full hyper:// URL. The bg facade routes each call to the right
// backend, so userland writes one code path for both Hyperdrives and collaborative drives.

const isDriveUrlRe = /^(hyper:\/\/)?[^\/]+/i;

export function setup(rpc) {
  const fsRPC = rpc.importAPI('fs', fsManifest, { timeout: false, errors });

  function massageUrl(url) {
    if (!url) url = '/';
    if (typeof url !== 'string') {
      if (typeof url.url === 'string') url = url.url;
      else if (typeof url.href === 'string') url = url.href;
      else throw new Error('Invalid hyper:// URL');
    }
    if (location.protocol === 'hyper:') {
      if (!isDriveUrlRe.test(url)) url = joinPath('hyper://' + location.hostname, url);
    } else if (!url.startsWith('hyper://')) {
      url = 'hyper://' + url;
    }
    if (!isDriveUrlRe.test(url)) throw new Error('Invalid URL: must be a hyper:// URL');
    return url;
  }

  function joinPath(a = '', b = '') {
    [a, b] = [String(a), String(b)];
    const [aSlash, bSlash] = [a.endsWith('/'), b.startsWith('/')];
    if (!aSlash && !bSlash) return a + '/' + b;
    if (aSlash && bSlash) return a + b.slice(1);
    return a + b;
  }

  function createScopedAPI(url) {
    url = massageUrl(url);
    const urlParsed = parseDriveUrl(url);
    url = 'hyper://' + urlParsed.hostname + '/';

    return {
      get url() {
        return url;
      },

      async getInfo(opts = {}) {
        return fsRPC.getInfo(url, opts);
      },

      async entry(path, opts = {}) {
        return fsRPC.entry(joinPath(url, path), opts);
      },
      async stat(path, opts = {}) {
        return createStat(await fsRPC.stat(joinPath(url, path), opts));
      },
      async get(path, opts = {}) {
        return fsRPC.get(joinPath(url, path), opts);
      },
      async readFile(path, opts = {}) {
        return fsRPC.readFile(joinPath(url, path), opts);
      },
      async list(path = '/', opts = {}) {
        return fsRPC.list(joinPath(url, path), opts);
      },
      async readdir(path = '/', opts: any = {}) {
        const names = await fsRPC.readdir(joinPath(url, path), opts);
        if (opts.includeStats)
          names.forEach((n) => {
            n.stat = createStat(n.stat);
          });
        return names;
      },
      async query(path = '/', opts = {}) {
        return fsRPC.query(joinPath(url, path), opts);
      },
      async diff(other, opts = {}) {
        return fsRPC.diff(url, other, opts);
      },

      async put(path, data, opts = {}) {
        return fsRPC.put(joinPath(url, path), data, opts);
      },
      async writeFile(path, data, opts = {}) {
        return fsRPC.writeFile(joinPath(url, path), data, opts);
      },
      async del(path, opts = {}) {
        return fsRPC.del(joinPath(url, path), opts);
      },
      async unlink(path, opts = {}) {
        return fsRPC.unlink(joinPath(url, path), opts);
      },
      async mkdir(path, opts = {}) {
        return fsRPC.mkdir(joinPath(url, path), opts);
      },
      async rmdir(path, opts = {}) {
        return fsRPC.rmdir(joinPath(url, path), opts);
      },
      async copy(src, dst, opts = {}) {
        return fsRPC.copy(joinPath(url, src), joinPath(url, dst), opts);
      },
      async rename(src, dst, opts = {}) {
        return fsRPC.rename(joinPath(url, src), joinPath(url, dst), opts);
      },
      async updateMetadata(path, metadata, opts = {}) {
        return fsRPC.updateMetadata(joinPath(url, path), metadata, opts);
      },
      async deleteMetadata(path, keys, opts = {}) {
        return fsRPC.deleteMetadata(joinPath(url, path), keys, opts);
      },
      async mount(path, key, opts = {}) {
        return fsRPC.mount(joinPath(url, path), key, opts);
      },
      async unmount(path, opts = {}) {
        return fsRPC.unmount(joinPath(url, path), opts);
      },
      async symlink(target, linkname, opts = {}) {
        return fsRPC.symlink(joinPath(url, linkname), target, opts);
      },

      watch(pathSpec = null, onChanged = null) {
        if (typeof pathSpec === 'function') {
          onChanged = pathSpec;
          pathSpec = null;
        }
        const evts = fromEventStream(fsRPC.watch(url, pathSpec));
        if (onChanged) evts.addEventListener('changed', onChanged);
        return evts;
      },

      async configure(info, opts = {}) {
        return fsRPC.configure(url, info, opts);
      },
      async forkDrive(opts = {}) {
        return createScopedAPI(await fsRPC.forkDrive(url, opts));
      },

      // Collaborative-drive writer management (scoped to this drive)
      async createInvite(opts = {}) {
        return fsRPC.createInvite(url, opts);
      },
      async listRequests() {
        return fsRPC.listRequests(url);
      },
      watchRequests(onRequest = null) {
        const evts = fromEventStream(fsRPC.watchRequests(url));
        if (onRequest) evts.addEventListener('changed', onRequest);
        return evts;
      },
      async approveRequest(writerKey, opts = {}) {
        return fsRPC.approveRequest(url, writerKey, opts);
      },
      async denyRequest(writerKey) {
        return fsRPC.denyRequest(url, writerKey);
      },
      async removeWriter(writerKey) {
        return fsRPC.removeWriter(url, writerKey);
      },
      async listWriters() {
        return fsRPC.listWriters(url);
      },
    };
  }

  // A PLAIN OBJECT (not a callable function): Electron's contextBridge exposes a function as
  // callable but drops its attached properties, which would make beaker.fs.createDrive/drive/etc.
  // vanish in userland. Plain object → every method survives the bridge (like beaker.hyperdrive did).
  const api: any = {};
  // `beaker.fs.drive(url)` — scoped handle (parallels the old beaker.hyperdrive.drive).
  api.drive = (url) => createScopedAPI(url);

  // Top-level helpers that take a full hyper:// URL (no scoped instance needed).
  api.getInfo = async (url, opts = {}) => fsRPC.getInfo(massageUrl(url), opts);
  api.entry = async (url, opts = {}) => fsRPC.entry(massageUrl(url), opts);
  api.stat = async (url, opts = {}) => createStat(await fsRPC.stat(massageUrl(url), opts));
  api.get = async (url, opts = {}) => fsRPC.get(massageUrl(url), opts);
  api.readFile = async (url, opts = {}) => fsRPC.readFile(massageUrl(url), opts);
  api.list = async (url, opts = {}) => fsRPC.list(massageUrl(url), opts);
  api.readdir = async (url, opts: any = {}) => {
    const names = await fsRPC.readdir(massageUrl(url), opts);
    if (opts.includeStats)
      names.forEach((n) => {
        n.stat = createStat(n.stat);
      });
    return names;
  };
  api.query = async (urlOrOpts, opts = {}) =>
    urlOrOpts && typeof urlOrOpts === 'object'
      ? fsRPC.query(urlOrOpts)
      : fsRPC.query(massageUrl(urlOrOpts), opts);
  api.diff = async (url, other, opts = {}) => fsRPC.diff(massageUrl(url), other, opts);
  api.put = async (url, data, opts = {}) => fsRPC.put(massageUrl(url), data, opts);
  api.writeFile = async (url, data, opts = {}) => fsRPC.writeFile(massageUrl(url), data, opts);
  api.del = async (url, opts = {}) => fsRPC.del(massageUrl(url), opts);
  api.unlink = async (url, opts = {}) => fsRPC.unlink(massageUrl(url), opts);
  api.mkdir = async (url, opts = {}) => fsRPC.mkdir(massageUrl(url), opts);
  api.rmdir = async (url, opts = {}) => fsRPC.rmdir(massageUrl(url), opts);
  api.copy = async (src, dst, opts = {}) => fsRPC.copy(massageUrl(src), massageUrl(dst), opts);
  api.rename = async (src, dst, opts = {}) => fsRPC.rename(massageUrl(src), massageUrl(dst), opts);
  api.watch = (url, pathSpec = null, onChanged = null) => {
    if (typeof pathSpec === 'function') {
      onChanged = pathSpec;
      pathSpec = null;
    }
    const evts = fromEventStream(fsRPC.watch(massageUrl(url), pathSpec));
    if (onChanged) evts.addEventListener('changed', onChanged);
    return evts;
  };

  // Drive lifecycle (new drives are Autobase-from-birth). createDrive/forkDrive return a scoped handle.
  api.createDrive = async (opts = {}) => createScopedAPI(await fsRPC.createDrive(opts));
  api.createCollaborativeDrive = async (opts = {}) =>
    createScopedAPI(await fsRPC.createCollaborativeDrive(opts));
  api.forkDrive = async (url, opts = {}) =>
    createScopedAPI(await fsRPC.forkDrive(massageUrl(url), opts));
  api.loadDrive = async (url) => fsRPC.loadDrive(massageUrl(url));
  api.configure = async (url, info, opts = {}) => fsRPC.configure(massageUrl(url), info, opts);
  api.isCollaborativeDrive = async (url) => fsRPC.isCollaborativeDrive(massageUrl(url));

  // Collaborative-drive writer management (top-level, url-first)
  api.createInvite = async (url, opts = {}) => fsRPC.createInvite(massageUrl(url), opts);
  api.claimInvite = async (inviteUrl, opts = {}) => fsRPC.claimInvite(inviteUrl, opts);
  api.requestAccess = async (url, opts = {}) => fsRPC.requestAccess(massageUrl(url), opts);
  api.listRequests = async (url) => fsRPC.listRequests(massageUrl(url));
  api.watchRequests = (url, onRequest = null) => {
    const evts = fromEventStream(fsRPC.watchRequests(massageUrl(url)));
    if (onRequest) evts.addEventListener('changed', onRequest);
    return evts;
  };
  api.approveRequest = async (url, writerKey, opts = {}) =>
    fsRPC.approveRequest(massageUrl(url), writerKey, opts);
  api.denyRequest = async (url, writerKey) => fsRPC.denyRequest(massageUrl(url), writerKey);
  api.removeWriter = async (url, writerKey) => fsRPC.removeWriter(massageUrl(url), writerKey);
  api.listWriters = async (url) => fsRPC.listWriters(massageUrl(url));

  // Bulk filesystem import/export
  api.importFromFilesystem = async (opts = {}) => fsRPC.importFromFilesystem(opts);
  api.exportToFilesystem = async (opts = {}) => fsRPC.exportToFilesystem(opts);
  api.exportToDrive = async (opts = {}) => fsRPC.exportToDrive(opts);

  return api;
}
