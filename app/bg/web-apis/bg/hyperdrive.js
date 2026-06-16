// @ts-nocheck
import path from 'path';
import { parseDriveUrl } from '../../../lib/urls';
import b4a from 'b4a';
import { pick } from '../../../lib/async';
import { promises as nodefs } from 'fs';
import EventEmitter from 'events';
import * as modals from '../../ui/subwindows/modals';
import * as permissions from '../../ui/permissions';
import * as hyperDns from '../../hyper/dns';
import * as capabilities from '../../hyper/capabilities';
import * as drives from '../../hyper/drives';
import { gitCloneToTmp } from '../../lib/git';
import * as archivesDb from '../../dbs/archives';
import * as auditLog from '../../dbs/audit-log';
import { timer } from '../../../lib/time';
import * as filesystem from '../../filesystem/index';
import * as spacesDb from '../../dbs/spaces';
import { findTab } from '../../ui/tabs/manager';
import { query } from '../../filesystem/query';
import drivesAPI from './drives';
import {
  DRIVE_MANIFEST_FILENAME,
  DRIVE_CONFIGURABLE_FIELDS,
  HYPERDRIVE_HASH_REGEX,
  DAT_QUOTA_DEFAULT_BYTES_ALLOWED,
  DRIVE_VALID_PATH_REGEX,
  DEFAULT_DRIVE_API_TIMEOUT,
} from '../../../lib/const';
import {
  PermissionsError,
  UserDeniedError,
  QuotaExceededError,
  ArchiveNotWritableError,
  InvalidURLError,
  ProtectedFileNotWritableError,
  InvalidPathError,
} from 'beaker-error-constants';
import * as wcTrust from '../../wc-trust';

// Returns the space ID for the given webContents — works for both tab panes and modal views.
function getSenderSpaceId(sender) {
  return findTab(sender)?.spaceId ?? filesystem.getSpaceIdForWebContents(sender?.id);
}

// exported api
// =

const to = (opts) =>
  opts && typeof opts.timeout !== 'undefined'
    ? opts.timeout
    : DEFAULT_DRIVE_API_TIMEOUT;

const hyperdriveAPI = {
  async createDrive({
    title,
    description,
    tags,
    author,
    visibility,
    fromGitUrl,
    prompt,
  } = {}) {
    var newDriveUrl;

    if (!wcTrust.isWcTrusted(this.sender)) {
      fromGitUrl = undefined;
      visibility = undefined;
      author = undefined;
    }

    if (prompt !== false) {
      let res;
      try {
        res = await modals.create(this.sender, 'create-drive', {
          title,
          description,
          tags,
          author,
          visibility,
        });
        if (res && res.gotoSync) {
          await modals.create(this.sender, 'folder-sync', {
            url: res.url,
            closeAfterSync: true,
          });
        }
      } catch (e) {
        if (e.name !== 'Error') throw e;
      }
      if (!res || !res.url) throw new UserDeniedError();
      newDriveUrl = res.url;
    } else {
      if (tags && typeof tags === 'string') tags = tags.split(' ');
      else if (tags && !Array.isArray(tags)) tags = undefined;
      if (tags) tags = tags.filter((v) => typeof v === 'string');

      await assertCreateDrivePermission(this.sender, { title, tags });

      let importFolder;
      if (fromGitUrl) {
        try {
          importFolder = await gitCloneToTmp(fromGitUrl);
        } catch (e) {
          throw new Error('Failed to clone git repo: ' + e.toString());
        }
      }

      const meta = { title, description };
      const newDrive = await drives.createNewDrive(meta);
      await filesystem.configDriveForSpace(newDrive.url, { tags }, getSenderSpaceId(this.sender));
      newDriveUrl = newDrive.url;

      if (importFolder) {
        await _importFsFolder(newDrive.drive, importFolder, '/', {
          ignore: ['.git', 'index.json'],
        });
      }
    }

    const newDriveKey = await lookupUrlDriveKey(newDriveUrl);
    if (!wcTrust.isWcTrusted(this.sender)) {
      permissions.grantPermission('modifyDrive:' + newDriveKey, this.sender.getURL());
    }
    return newDriveUrl;
  },

  async forkDrive(url, { detached, title, description, tags, label, prompt } = {}) {
    var newDriveUrl;

    if (!wcTrust.isWcTrusted(this.sender)) label = undefined;

    if (prompt !== false) {
      let res;
      const forks = await drivesAPI.getForks(url);
      try {
        res = await modals.create(this.sender, 'fork-drive', {
          url,
          title,
          description,
          tags,
          forks,
          detached,
          label,
        });
      } catch (e) {
        if (e.name !== 'Error') throw e;
      }
      if (!res || !res.url) throw new UserDeniedError();
      newDriveUrl = res.url;
    } else {
      if (tags && typeof tags === 'string') tags = tags.split(' ');
      else if (tags && !Array.isArray(tags)) tags = undefined;
      if (tags) tags = tags.filter((v) => typeof v === 'string');

      await assertCreateDrivePermission(this.sender, { title, tags });

      const key = await lookupUrlDriveKey(url);
      const senderSpaceId = getSenderSpaceId(this.sender);
      if (!filesystem.getDriveConfig(key)) {
        await filesystem.configDriveForSpace(key, {}, senderSpaceId);
      }

      const newDrive = await drives.forkDrive(key, {
        title: detached ? title : undefined,
        description: detached ? description : undefined,
        detached,
      });
      await filesystem.configDriveForSpace(newDrive.url, {
        tags,
        forkOf: detached ? undefined : { key, label },
      }, senderSpaceId);
      newDriveUrl = newDrive.url;
    }

    return newDriveUrl;
  },

  async loadDrive(url) {
    if (!url || typeof url !== 'string') return Promise.reject(new InvalidURLError());
    const urlp = parseDriveUrl(url);
    await lookupDrive(this.sender, urlp.hostname, urlp.version);
    return Promise.resolve(true);
  },

  async getInfo(url, opts = {}) {
    return auditLog.record(this.sender.getURL(), 'getInfo', { url }, undefined, () =>
      timer(to(opts), async (checkin, pause, resume) => {
        const urlp = parseDriveUrl(url);
        const { driveKey, version } = await lookupDrive(
          this.sender, urlp.hostname, urlp.version, true
        );
        const info = await drives.getDriveInfo(driveKey);
        info.tags = filesystem.getDriveConfig(driveKey)?.tags || [];

        if (wcTrust.isWcTrusted(this.sender)) return info;

        pause();
        await assertReadPermission(driveKey, this.sender);
        resume();

        return {
          key: info.key,
          url: info.url,
          writable: info.writable,
          version: info.version,
          peers: info.peers,
          title: info.title,
          description: info.description,
        };
      })
    );
  },

  async configure(url, settings, opts) {
    return auditLog.record(this.sender.getURL(), 'configure', { url, ...settings }, undefined, () =>
      timer(to(opts), async (checkin, pause, resume) => {
        const urlp = parseDriveUrl(url);
        const { drive, checkoutFS, isHistoric } = await lookupDrive(
          this.sender, urlp.hostname, urlp.version
        );
        if (isHistoric) throw new ArchiveNotWritableError('Cannot modify a historic version');
        if (!settings || typeof settings !== 'object') throw new Error('Invalid argument');

        if ('tags' in settings && wcTrust.isWcTrusted(this.sender)) {
          await filesystem.configDriveForSpace(drive.url, { tags: settings.tags }, getSenderSpaceId(this.sender));
        }

        if (!wcTrust.isWcTrusted(this.sender)) {
          delete settings.tags;
          delete settings.author;
        }

        const metaUpdates = pick(settings, DRIVE_CONFIGURABLE_FIELDS);
        if (!drive.writable || Object.keys(metaUpdates).length === 0) return;

        pause();
        const senderOrigin = archivesDb.extractOrigin(this.sender.getURL());
        await assertWritePermission(drive, this.sender);
        await assertQuotaPermission(drive, senderOrigin, Buffer.byteLength(JSON.stringify(settings), 'utf8'));
        resume();

        // Merge into /index.json
        const existing = await _readIndexJson(checkoutFS.drive);
        const updated = Object.assign({}, existing, metaUpdates);
        await checkoutFS.drive.put('/index.json', b4a.from(JSON.stringify(updated, null, 2)));
        await drives.pullLatestDriveMeta(drive, { updateAssets: true });
      })
    );
  },

  // v11 API: entry(url) — replaces stat()
  // Returns {key, value: {blob, metadata}} or null
  async entry(url, opts = {}) {
    const urlp = parseDriveUrl(url);
    const filepath = normalizeFilepath(urlp.pathname || '');
    return auditLog.record(this.sender.getURL(), 'entry', { url, filepath }, undefined, () =>
      timer(to(opts), async (checkin, pause, resume) => {
        const { checkoutFS } = await lookupDrive(this.sender, urlp.hostname, urlp.version);
        pause();
        await assertReadPermission(checkoutFS, this.sender, filepath);
        resume();
        return checkoutFS.drive.entry(filepath);
      })
    );
  },

  // v11 API: get(url, opts) — replaces readFile()
  // Returns Buffer (opts.encoding = 'binary') or string (default utf8)
  async get(url, opts = {}) {
    const urlp = parseDriveUrl(url);
    const filepath = normalizeFilepath(urlp.pathname || '');
    return auditLog.record(this.sender.getURL(), 'get', { url, filepath, opts }, undefined, () =>
      timer(to(opts), async (checkin, pause, resume) => {
        const { checkoutFS } = await lookupDrive(this.sender, urlp.hostname, urlp.version);
        pause();
        await assertReadPermission(checkoutFS, this.sender, filepath);
        resume();
        const buf = await checkoutFS.drive.get(filepath);
        if (!buf) return null;
        if (opts.encoding === 'binary') return buf;
        if (opts.encoding === 'base64') return b4a.toString(buf, 'base64');
        if (opts.encoding === 'hex') return b4a.toString(buf, 'hex');
        return b4a.toString(buf);
      })
    );
  },

  // v11 API: put(url, data, opts) — replaces writeFile()
  async put(url, data, opts = {}) {
    const urlp = parseDriveUrl(url);
    const filepath = normalizeFilepath(urlp.pathname || '');
    if (typeof opts === 'string') opts = { encoding: opts };
    const buf = _toBuffer(data, opts);
    const sourceSize = buf.byteLength;
    return auditLog.record(this.sender.getURL(), 'put', { url, filepath }, sourceSize, () =>
      timer(to(opts), async (checkin, pause, resume) => {
        const { drive, checkoutFS, isHistoric } = await lookupDrive(
          this.sender, urlp.hostname, urlp.version
        );
        if (isHistoric) throw new ArchiveNotWritableError('Cannot modify a historic version');

        pause();
        const senderOrigin = archivesDb.extractOrigin(this.sender.getURL());
        await assertWritePermission(drive, this.sender, filepath);
        await assertQuotaPermission(drive, senderOrigin, sourceSize);
        assertValidFilePath(filepath);
        resume();

        const now = Date.now();
        const existing = await checkoutFS.drive.entry(filepath).catch(() => null);
        const ctime = existing?.value?.metadata?.ctime || now;
        const putOpts = { metadata: { ctime, mtime: now, ...opts.metadata } };
        return checkoutFS.drive.put(filepath, buf, putOpts);
      })
    );
  },

  // v11 API: del(url, opts) — replaces unlink()
  async del(url, opts = {}) {
    const urlp = parseDriveUrl(url);
    const filepath = normalizeFilepath(urlp.pathname || '');
    return auditLog.record(this.sender.getURL(), 'del', { url, filepath }, undefined, () =>
      timer(to(opts), async (checkin, pause, resume) => {
        const { drive, checkoutFS, isHistoric } = await lookupDrive(
          this.sender, urlp.hostname, urlp.version
        );
        if (isHistoric) throw new ArchiveNotWritableError('Cannot modify a historic version');

        pause();
        await assertWritePermission(drive, this.sender, filepath);
        assertUnprotectedFilePath(filepath, this.sender);
        resume();

        return checkoutFS.drive.del(filepath);
      })
    );
  },

  // v11 API: list(url, opts) — replaces readdir()
  // Returns array of {key, value} entry objects. Use opts.recursive = true for deep listing.
  async list(url, opts = {}) {
    const urlp = parseDriveUrl(url);
    const filepath = normalizeFilepath(urlp.pathname || '');
    return auditLog.record(this.sender.getURL(), 'list', { url, filepath, opts }, undefined, () =>
      timer(to(opts), async (checkin, pause, resume) => {
        const { checkoutFS } = await lookupDrive(this.sender, urlp.hostname, urlp.version);
        pause();
        await assertReadPermission(checkoutFS, this.sender, filepath);
        resume();
        const results = [];
        for await (const entry of checkoutFS.drive.list(filepath, { recursive: opts.recursive || false })) {
          results.push(entry);
        }
        return results;
      })
    );
  },

  // mkdir is a no-op in v11 (directories are implicit)
  async mkdir(url, opts) {
    const urlp = parseDriveUrl(url);
    const filepath = normalizeFilepath(urlp.pathname || '');
    return auditLog.record(this.sender.getURL(), 'mkdir', { url, filepath }, undefined, () =>
      timer(to(opts), async (checkin, pause, resume) => {
        const { drive, isHistoric } = await lookupDrive(
          this.sender, urlp.hostname, urlp.version
        );
        if (isHistoric) throw new ArchiveNotWritableError('Cannot modify a historic version');
        pause();
        await assertWritePermission(drive, this.sender);
        assertValidPath(filepath);
        assertUnprotectedFilePath(filepath, this.sender);
        resume();
        // In v11, directories are implicit — nothing to do
      })
    );
  },

  // rmdir deletes all files recursively under the given path
  async rmdir(url, opts = {}) {
    const urlp = parseDriveUrl(url);
    const filepath = normalizeFilepath(urlp.pathname || '');
    return auditLog.record(this.sender.getURL(), 'rmdir', { url, filepath }, undefined, () =>
      timer(to(opts), async (checkin, pause, resume) => {
        const { drive, checkoutFS, isHistoric } = await lookupDrive(
          this.sender, urlp.hostname, urlp.version
        );
        if (isHistoric) throw new ArchiveNotWritableError('Cannot modify a historic version');
        pause();
        await assertWritePermission(drive, this.sender);
        assertUnprotectedFilePath(filepath, this.sender);
        resume();
        for await (const entry of checkoutFS.drive.list(filepath, { recursive: true })) {
          await checkoutFS.drive.del(entry.key);
        }
      })
    );
  },

  async copy(url, dstpath, opts = {}) {
    const urlp = parseDriveUrl(url);
    const srcpath = normalizeFilepath(urlp.pathname || '');
    dstpath = normalizeFilepath(dstpath || '');
    return auditLog.record(this.sender.getURL(), 'copy', { url, srcpath, dstpath }, undefined, () =>
      timer(to(opts), async (checkin, pause, resume) => {
        const src = await lookupDrive(this.sender, urlp.hostname, urlp.version);
        const dstHostname = dstpath.includes('://') ? parseDriveUrl(dstpath).hostname : urlp.hostname;
        const dst = await lookupDrive(this.sender, dstHostname);

        const srcFinal = srcpath.includes('://') ? normalizeFilepath(new URL(srcpath).pathname) : srcpath;
        const dstFinal = dstpath.includes('://') ? normalizeFilepath(new URL(dstpath).pathname) : dstpath;

        pause();
        const senderOrigin = archivesDb.extractOrigin(this.sender.getURL());
        await assertReadPermission(src.drive, this.sender, srcFinal);
        await assertWritePermission(dst.drive, this.sender, dstFinal);
        assertUnprotectedFilePath(dstFinal, this.sender);
        resume();

        const srcEntry = await src.checkoutFS.drive.entry(srcFinal);
        if (!srcEntry) throw new InvalidPathError('Source path does not exist');

        const buf = await src.checkoutFS.drive.get(srcFinal);
        await assertQuotaPermission(dst.drive, senderOrigin, buf ? buf.byteLength : 0);
        return dst.checkoutFS.drive.put(dstFinal, buf || b4a.alloc(0), { metadata: srcEntry.value?.metadata });
      })
    );
  },

  async rename(url, dstpath, opts = {}) {
    const urlp = parseDriveUrl(url);
    const srcpath = normalizeFilepath(urlp.pathname || '');
    dstpath = normalizeFilepath(dstpath || '');
    return auditLog.record(this.sender.getURL(), 'rename', { url, srcpath, dstpath }, undefined, () =>
      timer(to(opts), async (checkin, pause, resume) => {
        const src = await lookupDrive(this.sender, urlp.hostname, urlp.version);
        const dstHostname = dstpath.includes('://') ? parseDriveUrl(dstpath).hostname : urlp.hostname;
        const dst = await lookupDrive(this.sender, dstHostname);

        const srcFinal = srcpath.includes('://') ? normalizeFilepath(new URL(srcpath).pathname) : srcpath;
        const dstFinal = dstpath.includes('://') ? normalizeFilepath(new URL(dstpath).pathname) : dstpath;

        pause();
        await assertWritePermission(src.drive, this.sender, srcFinal);
        await assertWritePermission(dst.drive, this.sender, dstFinal);
        assertValidPath(dstFinal);
        assertUnprotectedFilePath(srcFinal, this.sender);
        assertUnprotectedFilePath(dstFinal, this.sender);
        resume();

        const srcEntry = await src.checkoutFS.drive.entry(srcFinal);
        if (!srcEntry) throw new InvalidPathError('Source path does not exist');
        const buf = await src.checkoutFS.drive.get(srcFinal);
        await dst.checkoutFS.drive.put(dstFinal, buf || b4a.alloc(0), { metadata: srcEntry.value?.metadata });
        await src.checkoutFS.drive.del(srcFinal);
      })
    );
  },

  async updateMetadata(url, metadata, opts = {}) {
    const urlp = parseDriveUrl(url);
    const filepath = normalizeFilepath(urlp.pathname || '');
    return auditLog.record(this.sender.getURL(), 'updateMetadata', { url, filepath, metadata }, undefined, () =>
      timer(to(opts), async (checkin, pause, resume) => {
        const { drive, checkoutFS, isHistoric } = await lookupDrive(
          this.sender, urlp.hostname, urlp.version
        );
        if (isHistoric) throw new ArchiveNotWritableError('Cannot modify a historic version');
        pause();
        await assertWritePermission(drive, this.sender, filepath);
        assertValidPath(filepath);
        resume();

        const entry = await checkoutFS.drive.entry(filepath);
        if (!entry) throw new InvalidPathError('Path does not exist');
        const existingMeta = entry.value?.metadata || {};
        const newMeta = Object.assign({}, existingMeta, metadata);
        const buf = await checkoutFS.drive.get(filepath);
        return checkoutFS.drive.put(filepath, buf || b4a.alloc(0), { metadata: newMeta });
      })
    );
  },

  async deleteMetadata(url, keys, opts = {}) {
    const urlp = parseDriveUrl(url);
    const filepath = normalizeFilepath(urlp.pathname || '');
    return auditLog.record(this.sender.getURL(), 'deleteMetadata', { url, filepath, keys }, undefined, () =>
      timer(to(opts), async (checkin, pause, resume) => {
        const { drive, checkoutFS, isHistoric } = await lookupDrive(
          this.sender, urlp.hostname, urlp.version
        );
        if (isHistoric) throw new ArchiveNotWritableError('Cannot modify a historic version');
        pause();
        await assertWritePermission(drive, this.sender, filepath);
        assertValidPath(filepath);
        resume();

        const entry = await checkoutFS.drive.entry(filepath);
        if (!entry) throw new InvalidPathError('Path does not exist');
        const newMeta = Object.assign({}, entry.value?.metadata || {});
        for (const k of (Array.isArray(keys) ? keys : [keys])) delete newMeta[k];
        const buf = await checkoutFS.drive.get(filepath);
        return checkoutFS.drive.put(filepath, buf || b4a.alloc(0), { metadata: newMeta });
      })
    );
  },

  async diff(url, other, opts = {}) {
    const urlp = parseDriveUrl(url);
    const prefix = urlp.pathname;
    return auditLog.record(this.sender.getURL(), 'diff', { url, other, prefix }, undefined, () =>
      timer(to(opts), async (checkin, pause, resume) => {
        const { checkoutFS } = await lookupDrive(this.sender, urlp.hostname, urlp.version);
        pause();
        await assertReadPermission(checkoutFS, this.sender);
        resume();
        const results = [];
        for await (const entry of checkoutFS.drive.diff(other || 0, prefix || '/')) {
          results.push(entry);
        }
        return results;
      })
    );
  },

  async query(opts) {
    if (!opts.drive) return [];
    if (!Array.isArray(opts.drive)) opts.drive = [opts.drive];
    return auditLog.record(this.sender.getURL(), 'query', opts, undefined, () =>
      timer(to(opts), async (checkin, pause, resume) => {
        const resolvedDrives = [];
        for (let i = 0; i < opts.drive.length; i++) {
          const urlp = parseDriveUrl(opts.drive[i]);
          const looked = await lookupDrive(this.sender, urlp.hostname, urlp.version);
          resolvedDrives.push(looked.checkoutFS);
        }
        pause();
        for (const drive of resolvedDrives) await assertReadPermission(drive, this.sender);
        resume();
        const queryOpts = Object.assign({}, opts, { drive: resolvedDrives });
        const results = await Promise.all(resolvedDrives.map((d) => query(d, queryOpts)));
        return results.flat(Infinity);
      })
    );
  },

  async watch(url, pathPattern) {
    const { drive } = await lookupDrive(this.sender, url);
    await assertReadPermission(drive, this.sender);
    const emitter = new EventEmitter();
    const folder = pathPattern || '/';
    ;(async () => {
      for await (const diff of drive.drive.watch(folder)) {
        emitter.emit('changed', diff);
      }
    })().catch(() => {});
    return emitter;
  },

  // Beaker-internal helpers (shell UI only)

  async beakerDiff(srcUrl, dstUrl, opts) {
    assertBeakerOnly(this.sender);
    if (!srcUrl || typeof srcUrl !== 'string') throw new InvalidURLError('First param must be a hyper URL');
    if (!dstUrl || typeof dstUrl !== 'string') throw new InvalidURLError('Second param must be a hyper URL');
    const [src, dst] = await Promise.all([
      lookupDrive(this.sender, srcUrl),
      lookupDrive(this.sender, dstUrl),
    ]);
    const results = [];
    for await (const entry of src.checkoutFS.drive.diff(0, src.filepath || '/')) {
      results.push(entry);
    }
    return results;
  },

  async beakerMerge(srcUrl, dstUrl, opts) {
    assertBeakerOnly(this.sender);
    if (!srcUrl || typeof srcUrl !== 'string') throw new InvalidURLError('First param must be a hyper URL');
    if (!dstUrl || typeof dstUrl !== 'string') throw new InvalidURLError('Second param must be a hyper URL');
    const [src, dst] = await Promise.all([
      lookupDrive(this.sender, srcUrl),
      lookupDrive(this.sender, dstUrl),
    ]);
    if (!dst.drive.writable) throw new ArchiveNotWritableError('Destination drive is not writable');
    if (dst.isHistoric) throw new ArchiveNotWritableError('Cannot modify a historic version');
    const srcFolder = src.filepath || '/';
    const dstFolder = dst.filepath || '/';
    for await (const entry of src.checkoutFS.drive.list(srcFolder, { recursive: true })) {
      const relPath = entry.key.slice(srcFolder.endsWith('/') ? srcFolder.length : srcFolder.length + 1);
      const dstPath = dstFolder.endsWith('/') ? dstFolder + relPath : dstFolder + '/' + relPath;
      const buf = await src.checkoutFS.drive.get(entry.key);
      if (buf) await dst.checkoutFS.drive.put(dstPath, buf, { metadata: entry.value?.metadata });
    }
  },

  async importFromFilesystem(opts) {
    assertBeakerOnly(this.sender);
    const { checkoutFS, filepath, isHistoric } = await lookupDrive(this.sender, opts.dst);
    if (isHistoric) throw new ArchiveNotWritableError('Cannot modify a historic version');
    return _importFsFolder(checkoutFS.drive, opts.src, filepath || '/', {
      ignore: opts.ignore,
    });
  },

  async exportToFilesystem(opts) {
    assertBeakerOnly(this.sender);
    const { checkoutFS, filepath } = await lookupDrive(this.sender, opts.src);
    return _exportToFs(checkoutFS.drive, filepath || '/', opts.dst, {
      ignore: opts.ignore,
      overwriteExisting: opts.overwriteExisting,
    });
  },

  async exportToDrive(opts) {
    assertBeakerOnly(this.sender);
    const src = await lookupDrive(this.sender, opts.src);
    const dst = await lookupDrive(this.sender, opts.dst);
    if (dst.isHistoric) throw new ArchiveNotWritableError('Cannot modify a historic version');
    const srcFolder = src.filepath || '/';
    const dstFolder = dst.filepath || '/';
    const ignore = new Set(opts.ignore || []);
    for await (const entry of src.checkoutFS.drive.list(srcFolder, { recursive: true })) {
      if (ignore.has(entry.key)) continue;
      const relPath = entry.key.slice(srcFolder.length);
      const dstPath = (dstFolder.endsWith('/') ? dstFolder : dstFolder + '/') + relPath.replace(/^\//, '');
      const buf = await src.checkoutFS.drive.get(entry.key);
      if (buf) await dst.checkoutFS.drive.put(dstPath, buf, { metadata: entry.value?.metadata });
    }
  },

  // v10 compat shims — keep existing userland working without rewrite
  async readFile(url, opts) {
    if (typeof opts === 'string') opts = { encoding: opts };
    return hyperdriveAPI.get.call(this, url, opts || {});
  },
  async writeFile(url, data, opts) {
    if (typeof opts === 'string') opts = { encoding: opts };
    return hyperdriveAPI.put.call(this, url, data, opts || {});
  },
  async stat(url, opts) {
    const urlp = parseDriveUrl(url);
    const filepath = normalizeFilepath(urlp.pathname || '');
    // Root is always a directory in Hyperdrive v11 — no entry exists for '/', and
    // hyperdrive throws "Invalid filename: /" if you try to look it up.
    if (filepath === '/') {
      return { mode: 16384 /* IFDIR */, size: 0, offset: 0, blocks: 0, downloaded: 0, mtime: 0, ctime: 0, metadata: {} };
    }
    const e = await hyperdriveAPI.entry.call(this, url, opts || {});
    if (e) {
      const isFile = !!e.value?.blob;
      const mtime = e.value?.metadata?.mtime || 0;
      const ctime = e.value?.metadata?.ctime || mtime;
      return {
        mode: isFile ? 32768 /* IFREG */ : 16384 /* IFDIR */,
        size: e.value?.blob?.byteLength || 0,
        offset: 0,
        blocks: 0,
        downloaded: 0,
        mtime,
        ctime,
        metadata: e.value?.metadata || {},
      };
    }
    // Hyperdrive v11 directories are implicit (no Hyperbee entry of their own).
    // Check if any children exist under this path — if so, treat it as a directory.
    const children = await hyperdriveAPI.list.call(this, url, { recursive: false });
    if (children.length > 0) {
      return { mode: 16384 /* IFDIR */, size: 0, offset: 0, blocks: 0, downloaded: 0, mtime: 0, ctime: 0, metadata: {} };
    }
    return null;
  },
  async unlink(url, opts) {
    return hyperdriveAPI.del.call(this, url, opts || {});
  },
  async readdir(url, opts = {}) {
    const urlp = parseDriveUrl(url);
    const filepath = normalizeFilepath(urlp.pathname || '');
    const entries = await hyperdriveAPI.list.call(this, url, { recursive: opts.recursive || false });

    // shallowReadStream pushes the raw Hyperbee node even for directory entries,
    // where e.key is the first *file* found inside the subdirectory, not the dir itself.
    // Mirror shallowReadStream's own name computation (std(folder, true) strips trailing slash).
    const normalizedPath = filepath === '/' ? '' : filepath.replace(/\/$/, '');
    const shallowName = (key) => {
      const suffix = key.slice(normalizedPath.length + 1); // e.g. 'history/abc.json' or 'index.html'
      const i = suffix.indexOf('/');
      return i === -1 ? suffix : suffix.slice(0, i);
    };

    if (opts.includeStats) {
      return entries.map((e) => {
        const name = shallowName(e.key);
        const isFile = !e.key.slice(normalizedPath.length + 1).includes('/') && !!e.value?.blob;
        const mtime = isFile ? (e.value?.metadata?.mtime || 0) : 0;
        const ctime = isFile ? (e.value?.metadata?.ctime || mtime) : 0;
        return {
          name,
          stat: {
            // mode encodes file vs directory so fg-side createStat() can reconstruct isFile/isDirectory
            mode: isFile ? 32768 /* IFREG */ : 16384 /* IFDIR */,
            size: isFile ? (e.value?.blob?.byteLength || 0) : 0,
            offset: 0,
            blocks: 0,
            downloaded: 0,
            mtime,
            ctime,
            metadata: isFile ? (e.value?.metadata || {}) : {},
          },
        };
      });
    }
    return entries.map((e) => shallowName(e.key));
  },
  async symlink() { /* no-op: symlinks removed in v11 */ },
  async mount() { /* no-op: mounts removed in v11 */ },
  async unmount() { /* no-op: mounts removed in v11 */ },
  async createNetworkActivityStream() {
    const { EventEmitter } = require('events');
    return new EventEmitter();
  },
};

export default hyperdriveAPI;

// internal helpers
// =

function assertUnprotectedFilePath(filepath, sender) {
  if (wcTrust.isWcTrusted(sender)) return;
  if (filepath === '/' + DRIVE_MANIFEST_FILENAME) throw new ProtectedFileNotWritableError();
}

function assertBeakerOnly(sender) {
  if (!wcTrust.isWcTrusted(sender)) throw new PermissionsError();
}

async function assertCreateDrivePermission(sender, opts) {
  if (wcTrust.isWcTrusted(sender)) return true;
  const allowed = await permissions.requestPermission('createDrive', sender, opts);
  if (!allowed) throw new UserDeniedError();
}

async function assertReadPermission(drive, sender, filepath = undefined) {
  var driveUrl;
  if (typeof drive === 'string') {
    driveUrl = `hyper://${await drives.fromURLToKey(drive, true)}/`;
  } else {
    driveUrl = drive.url;
  }

  const ident = filesystem.getDriveIdent(driveUrl);
  if (ident.system) {
    const origin = archivesDb.extractOrigin(sender.getURL()) + '/';
    const senderUrl = sender.getURL();
    if (wcTrust.isWcTrusted(sender) || filesystem.isRootUrl(origin) || senderUrl.startsWith('hyper://')) return true;
    throw new PermissionsError('Cannot read the hyper://private/ drive');
  }
  return true;
}

async function assertWritePermission(drive, sender, filepath = undefined) {
  const driveKey = b4a.toString(drive.key, 'hex');
  const perm = 'modifyDrive:' + driveKey;

  if (wcTrust.isWcTrusted(sender)) return true;

  const senderDatKey = await lookupUrlDriveKey(sender.getURL());
  if (senderDatKey === driveKey) return true;

  const ident = filesystem.getDriveIdent(`hyper://${driveKey}`);
  if (ident.system) throw new PermissionsError('Cannot write the hyper://private/ drive');

  const allowed = await permissions.queryPermission(perm, sender);
  if (allowed) return true;

  const details = await drives.getDriveInfo(driveKey);
  const userAllowed = await permissions.requestPermission(perm, sender, { title: details.title });
  if (!userAllowed) throw new UserDeniedError();
  return true;
}

async function assertQuotaPermission(drive, senderOrigin, byteLength) {
  if (senderOrigin.startsWith('beaker:')) return;
  const meta = await archivesDb.getMeta(drive.key);
  const bytesAllowed = DAT_QUOTA_DEFAULT_BYTES_ALLOWED;
  const newSize = (meta.size || 0) + byteLength;
  if (newSize > bytesAllowed) throw new QuotaExceededError();
}

function assertValidFilePath(filepath) {
  if (filepath.slice(-1) === '/') throw new InvalidPathError('Files cannot have a trailing slash');
  assertValidPath(filepath);
}

function assertValidPath(fileOrFolderPath) {
  if (!DRIVE_VALID_PATH_REGEX.test(fileOrFolderPath)) throw new InvalidPathError('Path contains invalid characters');
}

function normalizeFilepath(str) {
  str = decodeURIComponent(str);
  if (!str.includes('://') && str.charAt(0) !== '/') str = '/' + str;
  return str;
}

export async function lookupDrive(sender, driveHostname, version, dontGetDrive = false) {
  let driveKey;

  if (driveHostname && driveHostname.endsWith('.cap')) {
    const cap = capabilities.lookupCap(driveHostname);
    if (cap) {
      driveKey = cap.target.key;
      version = cap.target.version;
    } else {
      throw new Error('Capability does not exist');
    }
  }

  if (!driveKey) {
    if (driveHostname === 'private' && sender?.id) {
      const spaceId = filesystem.getSpaceIdForWebContents(sender.id);
      const spaceUrl = spaceId ? filesystem.getSpaceRootDriveUrl(spaceId) : null;
      if (spaceUrl) {
        driveKey = await drives.fromURLToKey(spaceUrl, true);
      }
    }
    if (!driveKey) {
      driveKey = await drives.fromURLToKey(driveHostname, true);
    }
  }

  if (dontGetDrive) return { driveKey, version };

  let drive = drives.getDrive(driveKey);
  if (!drive) drive = await drives.loadDrive(driveKey);
  const { checkoutFS, isHistoric } = await drives.getDriveCheckout(drive, version);
  return { drive, version, isHistoric, checkoutFS };
}

async function lookupUrlDriveKey(url) {
  if (HYPERDRIVE_HASH_REGEX.test(url)) return url;
  if (!url.startsWith('hyper://')) return false;
  const urlp = parseDriveUrl(url);
  try {
    return await hyperDns.resolveName(urlp.hostname);
  } catch (e) {
    return false;
  }
}

async function _readIndexJson(drive) {
  const buf = await drive.get('/index.json');
  if (!buf) return {};
  try { return JSON.parse(b4a.toString(buf)); } catch { return {}; }
}

function _toBuffer(data, opts = {}) {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === 'string') {
    if (opts.encoding === 'base64') return b4a.from(data, 'base64');
    if (opts.encoding === 'hex') return b4a.from(data, 'hex');
    return b4a.from(data);
  }
  return b4a.from(JSON.stringify(data));
}

async function _importFsFolder(drive, srcPath, dstPath, { ignore = [] } = {}) {
  const ignoreSet = new Set(ignore);
  const entries = await nodefs.readdir(srcPath, { withFileTypes: true });
  for (const entry of entries) {
    const relName = entry.name;
    if (ignoreSet.has(relName)) continue;
    const fullSrc = srcPath.endsWith('/') ? srcPath + relName : srcPath + '/' + relName;
    const fullDst = (dstPath.endsWith('/') ? dstPath : dstPath + '/') + relName;
    if (entry.isDirectory()) {
      await _importFsFolder(drive, fullSrc, fullDst, { ignore });
    } else if (entry.isFile()) {
      const buf = await nodefs.readFile(fullSrc);
      await drive.put(fullDst, buf);
    }
  }
}

async function _exportToFs(drive, srcFolder, dstPath, { ignore = [], overwriteExisting = true } = {}) {
  const ignoreSet = new Set(ignore);
  await nodefs.mkdir(dstPath, { recursive: true });
  for await (const entry of drive.list(srcFolder, { recursive: true })) {
    if (ignoreSet.has(entry.key)) continue;
    const relPath = entry.key.slice(srcFolder.length).replace(/^\//, '');
    const dstFile = dstPath.endsWith('/') ? dstPath + relPath : dstPath + '/' + relPath;
    if (!overwriteExisting) {
      try { await nodefs.access(dstFile); continue; } catch {}
    }
    const buf = await drive.get(entry.key);
    if (buf) {
      await nodefs.mkdir(path.dirname(dstFile), { recursive: true });
      await nodefs.writeFile(dstFile, buf);
    }
  }
}
