import { parseDriveUrl } from '../../../lib/urls';
import b4a from 'b4a';
import * as autobases from '../../hyper/autobases';
import * as archivesDb from '../../dbs/archives';
import * as auditLog from '../../dbs/audit-log';
import * as filesystem from '../../filesystem/index';
import * as spacesDb from '../../dbs/spaces';
import { timer } from '../../../lib/time';
import {
  HYPERDRIVE_HASH_REGEX,
  DEFAULT_DRIVE_API_TIMEOUT,
  DRIVE_VALID_PATH_REGEX,
} from '../../../lib/const';
import {
  PermissionsError,
  ArchiveNotWritableError,
  InvalidURLError,
  InvalidPathError,
  UserDeniedError,
} from 'beaker-error-constants';
import * as modals from '../../ui/subwindows/modals';

const to = (opts) =>
  opts && typeof opts.timeout !== 'undefined' ? opts.timeout : DEFAULT_DRIVE_API_TIMEOUT;

// exported api
// =

const autobaseAPI = {
  // Drive lifecycle
  // =

  async createCollaborativeDrive({ title, description, type, collaborative, prompt }: any = {}) {
    if (prompt !== false) {
      let res;
      try {
        res = await modals.create(this.sender, 'create-drive', {
          title,
          description,
        });
      } catch (e) {
        if (e.name !== 'Error') throw e;
      }
      if (!res || !res.url) throw new UserDeniedError();
      return res.url;
    }

    const meta: any = {};
    if (title) meta.title = title;
    if (description) meta.description = description;
    if (type) meta.type = type;
    // Locked (single-writer) by default; the toggle in the create modal sets this.
    if (typeof collaborative !== 'undefined') meta.collaborative = !!collaborative;
    const sess = await autobases.createCollaborativeDrive(meta);
    // Use configAutobaseDrive instead of configDriveForSpace — the latter calls
    // getOrLoadDrive() which tries to open the URL as a Hyperdrive and hangs.
    await filesystem.configAutobaseDrive(sess.url, { tags: ['collaborative'] });
    // Store title in archivesDb so the library sidebar shows the correct name.
    const key = _keyFromUrl(sess.url);
    await archivesDb.setMeta(key, {
      title: meta.title || '',
      type: 'autobase',
      writable: true,
    } as any);
    return sess.url;
  },

  async isCollaborativeDrive(url) {
    const key = _keyFromUrl(url);
    // Local drive registry (fast path: drives created/added in this profile).
    const cfg = filesystem.getDriveConfig(key);
    if (cfg && cfg.type === 'autobase') return true;
    // Already loaded as a collaborative session — e.g. the protocol handler loaded it
    // when the page was viewed. Covers drives opened by URL that aren't registered in
    // this profile (the reason a forum that worked in dev failed in a fresh packaged
    // profile: getDriveConfig was empty, so the editor read it as a Hyperdrive and hung).
    if (autobases.getCollaborativeDrive(key)) return true;
    // Persisted metadata (set when the drive was created locally).
    try {
      const meta = await archivesDb.getMeta(key);
      if (meta && meta.type === 'autobase') return true;
    } catch {}
    return false;
  },

  async loadDrive(url) {
    if (!url || typeof url !== 'string') throw new InvalidURLError();
    const key = _keyFromUrl(url);
    await autobases.getOrLoadCollaborativeDrive(key);
    return true;
  },

  async getInfo(url, opts: any = {}) {
    return timer(to(opts), async () => {
      const sess = await _lookup(url);
      const manifest = await _readIndexJson(sess);
      return {
        key: b4a.toString(sess.key, 'hex'),
        url: sess.url,
        writable: sess.writable,
        title: manifest.title || '',
        description: manifest.description || '',
        type: manifest.type || '',
        isCollaborative: true, // always an Autobase (backend type)
        collaborative: !!sess.collaborative, // accepts writer-access requests (unlocked)
      };
    });
  },

  // Read methods (delegate to linearized Hyperbee view)
  // =

  async entry(url, opts: any = {}) {
    return timer(to(opts), async () => {
      const { sess, filepath } = await _lookupWithPath(url);
      const record = await autobases.readRecord(sess, filepath);
      if (!record) return null;
      return {
        key: filepath,
        value: {
          blob: { byteLength: autobases.recordByteLength(record) },
          metadata: record.metadata || {},
        },
      };
    });
  },

  async get(url, opts: any = {}) {
    if (typeof opts === 'string') opts = { encoding: opts };
    return timer(to(opts), async () => {
      const { sess, filepath } = await _lookupWithPath(url);
      const buf = await autobases.readContent(sess, filepath);
      if (buf == null) return null;
      if (opts.encoding === 'binary') return buf;
      if (opts.encoding === 'base64') return b4a.toString(buf, 'base64');
      if (opts.encoding === 'hex') return b4a.toString(buf, 'hex');
      if (opts.encoding === 'json') {
        try {
          return JSON.parse(b4a.toString(buf));
        } catch {
          return null;
        }
      }
      return b4a.toString(buf);
    });
  },

  async list(url, opts: any = {}) {
    return timer(to(opts), async () => {
      const { sess, filepath } = await _lookupWithPath(url);
      const prefix = _listPrefix(filepath);
      const results = [];
      for await (const node of sess.drive.createReadStream({ gte: prefix, lt: prefix + '\xff' })) {
        results.push({ key: node.key, value: {} });
      }
      return results;
    });
  },

  async diff(url, other, opts: any = {}) {
    // Hyperbee diff is version-based; simplified to empty for now
    return [];
  },

  async watch(url, pathPattern) {
    const { EventEmitter } = await import('events');
    const emitter: any = new EventEmitter();
    try {
      const { sess } = await _lookupWithPath(url);
      if (typeof sess.drive.watch === 'function') {
        const prefix = _listPrefix(pathPattern || '/');
        (async () => {
          for await (const _ of sess.drive.watch({ gte: prefix, lt: prefix + '\xff' })) {
            emitter.emit('changed', {});
          }
        })().catch(() => {});
      }
    } catch {}
    return emitter;
  },

  // Emits 'changed' whenever a writer-access request arrives over the network for this
  // drive, so an owner's UI can refresh listRequests() live instead of polling.
  async watchRequests(url) {
    const { EventEmitter } = await import('events');
    const emitter: any = new EventEmitter();
    const key = _keyFromUrl(url);
    const onRequest = (req) => {
      if (req && req.key === key) emitter.emit('changed', {});
    };
    autobases.events.on('request', onRequest);
    // pauls-electron-rpc calls close() when the renderer tears down the stream
    emitter.close = () => autobases.events.removeListener('request', onRequest);
    return emitter;
  },

  // Write methods (go through autobase.append for linearization)
  // =

  async put(url, data, opts: any = {}) {
    if (typeof opts === 'string') opts = { encoding: opts };
    return timer(to(opts), async () => {
      const { sess, filepath } = await _lookupWithPath(url);
      assertWritable(sess);
      assertValidFilePath(filepath);

      const buf = _toBuffer(data, opts);
      // File content is stored as a blob (bytes stay out of the oplog).
      await autobases.writeFile(sess, filepath, buf);
    });
  },

  async del(url, opts: any = {}) {
    return timer(to(opts), async () => {
      const { sess, filepath } = await _lookupWithPath(url);
      assertWritable(sess);
      await autobases.deletePath(sess, filepath);
    });
  },

  async mkdir(url, opts: any = {}) {
    // directories are implicit in Hyperbee — no operation needed
    return timer(to(opts), async () => {
      const { sess } = await _lookupWithPath(url);
      assertWritable(sess);
    });
  },

  async rmdir(url, opts: any = {}) {
    return timer(to(opts), async () => {
      const { sess, filepath } = await _lookupWithPath(url);
      assertWritable(sess);
      const prefix = _listPrefix(filepath);
      const paths = [];
      for await (const node of sess.drive.createReadStream({ gte: prefix, lt: prefix + '\xff' })) {
        paths.push(node.key);
      }
      for (const p of paths) {
        await sess.base.append({ op: 'del', path: p });
      }
      await sess.base.update();
    });
  },

  async updateMetadata(url, metadata, opts: any = {}) {
    // Hyperbee-backed view does not store file metadata; no-op
    return timer(to(opts), async () => {
      const { sess } = await _lookupWithPath(url);
      assertWritable(sess);
    });
  },

  async deleteMetadata(url, keys, opts: any = {}) {
    // Hyperbee-backed view does not store file metadata; no-op
    return timer(to(opts), async () => {
      const { sess } = await _lookupWithPath(url);
      assertWritable(sess);
    });
  },

  async copy(srcUrl, dstUrl, opts: any = {}) {
    return timer(to(opts), async () => {
      const { sess: srcSess, filepath: srcPath } = await _lookupWithPath(srcUrl);
      const { sess: dstSess, filepath: dstPath } = await _lookupWithPath(dstUrl);
      assertWritable(dstSess);
      assertValidFilePath(dstPath);
      const buf = await autobases.readContent(srcSess, srcPath);
      if (buf == null) throw new Error('Source not found: ' + srcPath);
      await autobases.writeFile(dstSess, dstPath, buf);
    });
  },

  async rename(srcUrl, dstUrl, opts: any = {}) {
    return timer(to(opts), async () => {
      await autobaseAPI.copy.call(this, srcUrl, dstUrl, opts);
      await autobaseAPI.del.call(this, srcUrl, opts);
    });
  },

  async configure(url, settings, opts: any = {}) {
    return timer(to(opts), async () => {
      const sess = await _lookup(url);
      assertWritable(sess);
      const existing = await _readIndexJson(sess);
      const allowed = ['title', 'description', 'type', 'thumb', 'links', 'collaborative'];
      const updates = {};
      for (const k of allowed) {
        if (k in settings) updates[k] = settings[k];
      }
      const updated = Object.assign({}, existing, updates);
      // index.json is a small control record — inline (readable without a blob core).
      await autobases.putInline(sess, '/index.json', JSON.stringify(updated, null, 2));
      // Lock/unlock: applying `collaborative` opens/closes the writer-request channel live
      // (URL unchanged). This is the "create locked, unlock later" path (ADR-0010).
      if ('collaborative' in settings)
        await autobases.setCollaborative(sess, !!settings.collaborative);
    });
  },

  // v10 compat shims
  async readFile(url, opts) {
    if (typeof opts === 'string') opts = { encoding: opts };
    return autobaseAPI.get.call(this, url, opts || {});
  },
  async writeFile(url, data, opts) {
    if (typeof opts === 'string') opts = { encoding: opts };
    return autobaseAPI.put.call(this, url, data, opts || {});
  },
  async stat(url, opts) {
    const { sess, filepath } = await _lookupWithPath(url);
    const record = await autobases.readRecord(sess, filepath);
    if (record) return _statFromRecord(record);
    const children = await autobaseAPI.list.call(this, url, { recursive: false });
    if (children.length > 0) return _dirStat();
    return null;
  },
  async readdir(url, opts: any = {}) {
    const { sess, filepath } = await _lookupWithPath(url);
    const entries = await autobaseAPI.list.call(this, url, {});
    const normalizedPath = filepath === '/' ? '' : filepath.replace(/\/$/, '');
    // Build a map of shallow child name → isDirectory
    const childMap = new Map();
    for (const e of entries) {
      const suffix = e.key.slice(normalizedPath.length + 1);
      const slashIdx = suffix.indexOf('/');
      if (slashIdx === -1) {
        if (!childMap.has(suffix)) childMap.set(suffix, false);
      } else {
        const dirName = suffix.slice(0, slashIdx);
        childMap.set(dirName, true);
      }
    }
    if (opts.includeStats) {
      const out = [];
      for (const [name, isDir] of childMap) {
        if (isDir) {
          out.push({ name, stat: _dirStat() });
          continue;
        }
        const record = await autobases.readRecord(sess, `${normalizedPath}/${name}`);
        out.push({ name, stat: record ? _statFromRecord(record) : _dirStat() });
      }
      return out;
    }
    return Array.from(childMap.keys());
  },
  async unlink(url, opts) {
    return autobaseAPI.del.call(this, url, opts || {});
  },
  async symlink() {},
  async mount() {},
  async unmount() {},

  // Writer management
  // =

  async createInvite(url, { multiUse = false }: any = {}) {
    const sess = await _lookup(url);
    assertOwner(sess);
    // Inviting a writer is the owner opting into collaboration — unlock the drive so incoming
    // access requests are accepted (same URL). A locked drive otherwise never opens the channel.
    await autobases.setCollaborative(sess, true).catch(() => {});
    const token = autobases.createInvite(sess.keyStr, { multiUse });
    return `${sess.url}?invite=${token}`;
  },

  async claimInvite(inviteUrl, { profileUrl }: any = {}) {
    const urlp = new URL(inviteUrl);
    const token = urlp.searchParams.get('invite');
    if (!token) throw new Error('Invalid invite URL: missing invite token');

    const key = urlp.hostname;
    const sess = await autobases.getOrLoadCollaborativeDrive(key);
    if (!sess) throw new Error('Could not connect to collaborative drive');

    const invite = autobases.getInvite(token);
    if (!invite) throw new Error('Invite token not found or already used');

    const writerKey = b4a.toString(sess.base.local.key, 'hex');
    autobases.requestWriterAccess(key, { writerKey, profileUrl });
    autobases.consumeInvite(token);
    return { writerKey };
  },

  async requestAccess(url, { profileUrl }: any = {}) {
    const key = _keyFromUrl(url);
    const sess = await autobases.getOrLoadCollaborativeDrive(key);
    if (!sess) throw new Error('Could not connect to collaborative drive');
    const writerKey = b4a.toString(sess.base.local.key, 'hex');
    autobases.requestWriterAccess(key, { writerKey, profileUrl });
    return { writerKey };
  },

  async listRequests(url) {
    const key = _keyFromUrl(url);
    return autobases.listPendingRequests(key);
  },

  async approveRequest(url, writerKey, { profileUrl }: any = {}) {
    const sess = await _lookup(url);
    assertOwner(sess);
    if (!profileUrl) {
      const req = autobases.listPendingRequests(sess.keyStr).find((r) => r.writerKey === writerKey);
      profileUrl = req?.profileUrl || null;
    }
    await sess.base.append({ addWriter: writerKey, profileUrl });
    await sess.base.update();
    // Approving a writer makes the drive genuinely multi-writer — keep the flag consistent.
    await autobases.setCollaborative(sess, true).catch(() => {});
    autobases.removePendingRequest(sess.keyStr, writerKey);
  },

  async denyRequest(url, writerKey) {
    const sess = await _lookup(url);
    assertOwner(sess);
    autobases.removePendingRequest(sess.keyStr, writerKey);
  },

  async removeWriter(url, writerKey) {
    const sess = await _lookup(url);
    assertOwner(sess);
    await sess.base.append({ removeWriter: writerKey });
    await sess.base.update();
  },

  async listWriters(url) {
    const sess = await _lookup(url);
    await sess.base.update();
    const results = [];
    const prefix = '/.data/walled.garden/writers/';
    for await (const node of sess.drive.createReadStream({ gte: prefix, lt: prefix + '\xff' })) {
      // Writer-records are inline records: { metadata, blob:null, value: base64(JSON) }.
      const rec = node.value;
      if (!rec || rec.value == null) continue;
      try {
        results.push(JSON.parse(b4a.toString(b4a.from(rec.value, 'base64'))));
      } catch {}
    }
    return results;
  },
};

export default autobaseAPI;

// internal helpers
// =

async function _lookup(url) {
  const key = _keyFromUrl(url);
  const sess = await autobases.getOrLoadCollaborativeDrive(key);
  if (!sess) throw new InvalidURLError('Could not load collaborative drive');
  sess._lastUsed = Date.now();
  return sess;
}

async function _lookupWithPath(url) {
  const urlp = parseDriveUrl(url);
  const filepath = _normalizeFilepath(urlp.pathname || '/');
  const sess = await _lookup(url);
  return { sess, filepath };
}

function _keyFromUrl(url) {
  if (HYPERDRIVE_HASH_REGEX.test(url)) return url;
  const urlp = parseDriveUrl(url);
  return urlp.hostname;
}

function _normalizeFilepath(str) {
  str = decodeURIComponent(str);
  if (!str.startsWith('/')) str = '/' + str;
  return str;
}

function _listPrefix(filepath) {
  if (filepath === '/') return '/';
  return filepath.endsWith('/') ? filepath : filepath + '/';
}

function assertWritable(sess) {
  if (!sess.writable)
    throw new ArchiveNotWritableError('Not a writer for this collaborative drive');
}

function assertOwner(sess) {
  if (!sess.writable)
    throw new PermissionsError('Only a writer can manage this collaborative drive');
}

function _toBuffer(data, opts: any = {}) {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === 'string') {
    if (opts.encoding === 'base64') return Buffer.from(data, 'base64');
    if (opts.encoding === 'hex') return Buffer.from(data, 'hex');
    if (opts.encoding === 'binary') return Buffer.from(data, 'binary');
    return Buffer.from(data, 'utf8');
  }
  if (typeof data === 'object') return Buffer.from(JSON.stringify(data), 'utf8');
  return Buffer.from(String(data), 'utf8');
}

function assertValidFilePath(filepath) {
  if (filepath.slice(-1) === '/') throw new InvalidPathError('Files cannot have a trailing slash');
  if (!DRIVE_VALID_PATH_REGEX.test(filepath))
    throw new InvalidPathError('Path contains invalid characters');
}

async function _readIndexJson(sess) {
  const obj = await autobases.readJson(sess, '/index.json');
  return obj || {};
}

// Build a Hyperdrive-shaped stat from a v1 view record (real mtime/ctime/size now).
function _statFromRecord(record) {
  const md = record.metadata || {};
  const size = autobases.recordByteLength(record);
  return {
    mode: md.executable ? 33261 : 32768, // 0100755 / 0100644
    size,
    offset: 0,
    blocks: 0,
    downloaded: size,
    mtime: md.mtime || 0,
    ctime: md.ctime || 0,
    metadata: {},
  };
}

function _dirStat() {
  return {
    mode: 16384,
    size: 0,
    offset: 0,
    blocks: 0,
    downloaded: 0,
    mtime: 0,
    ctime: 0,
    metadata: {},
  };
}
