// The terminal's built-in commands (manifest.js lists them for help and Tab). Each is called with
// `this` set to the terminal's context (env, term, page, out, prompt) and (opts, ...args), and
// returns what to show: text, a lit template, or an object with toHTML() (and toText() for
// `cmd > file`).

import { html } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';
import { resolveParse, parseLocation, joinPath } from './util.js';
import { formatBytes, formatWhen, globToRegExp, grepLines, grepPattern, isTextPath, looksBinary } from '../lib/format.js';
import { diffLines, hunks, stats, unified } from '../lib/diff.js';
import * as termModule from './term.js';
export { ai } from './ai.js';

export const term = termModule;

const icon = (name, regular = false) =>
  html`<span class="${regular ? 'far' : 'fas'} fa-${name}" aria-hidden="true"></span>`;

const notice = (text, ic = 'check') => ({
  toText: () => '',
  toHTML: () => html`<div class="notice"><span class="icon">${icon(ic)}</span><span>${text}</span></div>`,
});

const DISPLAY_LINES = 2000;
const WALK_MAX = 5000;

const sortEntries = (a, b) => {
  const ad = a.stat.isDirectory();
  const bd = b.stat.isDirectory();
  if (ad !== bd) return ad ? -1 : 1;
  return a.name.localeCompare(b.name);
};

const shortPath = (p) => decodeURIComponent(p || '/');

async function statOrNull(drive, pathname, opts) {
  try {
    return await drive.stat(pathname, opts);
  } catch (e) {
    return null;
  }
}

async function mustStat(p, as) {
  const st = await statOrNull(p.drive, p.pathname);
  if (!st) throw new Error(`No such file or folder: ${as}`);
  return st;
}

// Reads a file as text; a binary file or a folder is an error with a tip.
async function readText(p, as) {
  const st = await mustStat(p, as);
  if (st.isDirectory()) {
    const err = new Error(`${as} is a folder`);
    err.tip = html`<a class="link" data-run=${'ls ' + as}>ls ${as}</a> lists it`;
    throw err;
  }
  const text = await p.drive.readFile(p.pathname, 'utf8');
  if (looksBinary(text)) throw new Error(`${as} isn't text (${formatBytes(st.size)})`);
  return text;
}

// Every entry under a folder, depth first: [{ path, name, stat, depth }] (at most WALK_MAX).
async function walk(drive, root, { hidden = false, maxDepth = Infinity, signal } = {}) {
  const out = [];
  const visit = async (dir, depth) => {
    if (out.length >= WALK_MAX || depth > maxDepth || (signal && signal.aborted)) return;
    const entries = await drive.readdir(dir, { includeStats: true }).catch(() => []);
    entries.sort(sortEntries);
    for (const e of entries) {
      if (!hidden && e.name.startsWith('.')) continue;
      if (out.length >= WALK_MAX) return;
      const path = joinPath(dir, e.name);
      out.push({ path, name: e.name, stat: e.stat, depth });
      if (e.stat.isDirectory()) await visit(path, depth + 1);
    }
  };
  await visit(root, 0);
  return out;
}

const relTo = (root, path) => {
  const r = root.endsWith('/') ? root : root + '/';
  return path.startsWith(r) ? path.slice(r.length) : path;
};

// A folder made with mkdir this session that has nothing in it yet (see madeDirs in main.js).
const dirKey = (p) => p.origin + (p.pathname.replace(/\/+$/, '') || '/');
const isMadeDir = (ctx, p) => !!(ctx.term && ctx.term.madeDirs && ctx.term.madeDirs.has(dirKey(p)));
const EMPTY_DIR = { isDirectory: () => true, isFile: () => false, size: 0, mtime: 0, metadata: {} };

// Where to look for a drive's version history: the drive's own URL.
const driveOf = (p) => p.origin + '/';

// current working directory methods
// =

export async function ls(opts = {}, ...locations) {
  if (!locations.length) locations = [''];
  const parts = [];
  for (const location of locations) {
    const target = this.env.resolve(location);
    const p = parseLocation(target);
    let st = await p.drive.stat(p.pathname).catch(() => null);
    if (st && st.isUnsupportedProtocol) throw new Error(`ls doesn't work on ${p.protocol} addresses`);
    if (!st && isMadeDir(this, p)) st = EMPTY_DIR;
    if (!st) throw new Error(`No such file or folder: ${location || '.'}`);
    if (st.isFile()) {
      parts.push({ file: true, location, st, url: target });
      continue;
    }
    let listing = st === EMPTY_DIR ? [] : await p.drive.readdir(p.pathname, { includeStats: true });
    const hidden = listing.filter((e) => e.name.startsWith('.')).length;
    if (!opts.all) listing = listing.filter((e) => !e.name.startsWith('.'));
    listing.sort(sortEntries);
    parts.push({ location, listing, hidden: opts.all ? 0 : hidden, base: joinPath(p.origin, p.pathname) });
  }
  const many = parts.length > 1;
  const nameOf = (e) => e.name + (e.stat.isDirectory() ? '/' : '');
  const linkFor = (part, e) => {
    const url = joinPath(part.base, e.name);
    const cls = e.stat.isDirectory() ? 'dir' : e.name.startsWith('.') ? 'hidden-file' : '';
    const rel = (part.location ? part.location.replace(/\/?$/, '/') : '') + e.name;
    return e.stat.isDirectory()
      ? html`<a class=${cls} data-run=${'ls ' + escapeArg(rel)} title=${'List ' + rel}>${nameOf(e)}</a>`
      : html`<a class=${cls} href=${url} title=${'Open ' + rel}>${e.name}</a>${e.stat.linkname
            ? html` <span class="faint">→ ${e.stat.linkname}</span>`
            : ''}`;
  };
  return {
    listing: parts.flatMap((p) => p.listing || []),
    toText: () =>
      parts
        .map((p) =>
          p.file
            ? p.location
            : (many ? `${p.location || '.'}:\n` : '') +
              p.listing.map((e) => (opts.long ? `${String(e.stat.size || 0).padStart(9)}  ${new Date(e.stat.mtime).toISOString()}  ` : '') + nameOf(e)).join('\n')
        )
        .join('\n\n'),
    toHTML: () => html`${parts.map(
      (p) => html`
        ${many ? html`<div class="muted">${p.location || '.'}:</div>` : ''}
        ${p.file
          ? html`<div><a href=${p.url}>${p.location}</a> <span class="faint">${formatBytes(p.st.size)} · ${formatWhen(p.st.mtime)}</span></div>`
          : !p.listing.length
            ? html`<div class="faint">Empty folder${p.hidden ? ` (${p.hidden} hidden: ls -a)` : ''}</div>`
            : opts.long
              ? html`<table class="rows">
                  ${p.listing.map(
                    (e) => html`<tr>
                      <td class="r num">${e.stat.isDirectory() ? '' : formatBytes(e.stat.size)}</td>
                      <td class="faint">${formatWhen(e.stat.mtime)}</td>
                      <td>${linkFor(p, e)}</td>
                    </tr>`
                  )}
                </table>`
              : html`<div class="ls-grid" style="--col: ${colWidth(p.listing.map(nameOf))}">
                  ${p.listing.map((e) => html`<span>${linkFor(p, e)}</span>`)}
                </div>`}
        ${p.hidden && p.listing.length ? html`<div class="faint">${p.hidden} hidden · <a class="link" data-run=${'ls -a ' + (p.location || '')}>ls -a</a></div>` : ''}
      `
    )}`,
  };
}

const colWidth = (names) => `${Math.min(Math.max(...names.map((n) => n.length), 8) + 2, 40)}ch`;
const escapeArg = (s) => String(s).replace(/([ "'\\])/g, '\\$1');

export async function tree(opts = {}, location = '') {
  const p = resolveParse(this.env, location);
  const st = await mustStat(p, location || '.');
  if (!st.isDirectory()) throw new Error(`${location} is a file`);
  const depth = Math.max(0, Number(opts.depth) || 3) - 1;
  const entries = await walk(p.drive, p.pathname, { hidden: !!opts.all, maxDepth: depth, signal: this.term.signal });
  // The branch drawing: for each entry, whether each level above it has more after it.
  const lines = [];
  const lastAt = [];
  entries.forEach((e, i) => {
    let last = true;
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[j].depth < e.depth) break;
      if (entries[j].depth === e.depth) {
        last = false;
        break;
      }
    }
    lastAt[e.depth] = last;
    let prefix = '';
    for (let d = 0; d < e.depth; d++) prefix += lastAt[d] ? '    ' : '│   ';
    prefix += last ? '└── ' : '├── ';
    lines.push({ prefix, e });
  });
  const dirs = entries.filter((e) => e.stat.isDirectory()).length;
  const files = entries.length - dirs;
  const root = shortPath(p.pathname);
  const summary = `${dirs} folder${dirs === 1 ? '' : 's'}, ${files} file${files === 1 ? '' : 's'}${entries.length >= WALK_MAX ? ' (stopped there)' : ''}`;
  return {
    toText: () => [root, ...lines.map((l) => l.prefix + l.e.name + (l.e.stat.isDirectory() ? '/' : '')), '', summary].join('\n'),
    toHTML: () => html`<div class="tree">
      <div class="dir">${root}</div>
      ${lines.map(
        (l) => html`<div>
          <span class="branch">${l.prefix}</span>${l.e.stat.isDirectory()
            ? html`<a class="dir" data-run=${'cd ' + escapeArg(relTo(p.pathname, l.e.path))}>${l.e.name}/</a>`
            : html`<a href=${p.origin + l.e.path}>${l.e.name}</a>`}
        </div>`
      )}
      <div class="faint" style="margin-top: 2px">${summary}</div>
    </div>`,
  };
}

export async function cd(opts = {}, location = '') {
  if (!location || location === '~') location = this.env.home();
  if (location === '-') {
    location = this.env.previous();
    if (!location) throw new Error('No folder to go back to yet');
  }
  var cwd = this.env.resolve(location);
  if (cwd.startsWith('hyper://')) {
    let urlp = new URL(cwd);
    let drive = nomad.fs.drive(urlp.origin);
    let st;
    try {
      st = await drive.stat(urlp.pathname);
    } catch (e) {
      st = null;
    }
    if (!st && isMadeDir(this, urlp)) st = EMPTY_DIR;
    if (!st) {
      const err = new Error(`No such folder: ${location}`);
      err.tip = html`<a class="link" data-run=${'mkdir ' + location}>mkdir ${location}</a> makes it`;
      throw err;
    }
    if (!st.isDirectory()) {
      const err = new Error(`${location} is a file, not a folder`);
      err.tip = html`<a class="link" data-run=${'cat ' + location}>cat ${location}</a> shows it`;
      throw err;
    }
    if (!urlp.pathname.endsWith('/')) urlp.pathname += '/';
    cwd = urlp.toString();
  }
  this.env.goto(cwd);
}

export function pwd(opts = {}) {
  let cwd = this.env.get('cwd');
  return { cwd, toText: () => cwd, toHTML: () => html`<a href=${cwd}>${cwd}</a>` };
}

export async function cat(opts = {}, ...locations) {
  if (!locations.length) throw new Error('Which file? cat {path}');
  const shown = [];
  let text = '';
  for (const location of locations) {
    var p = resolveParse(this.env, location);
    const url = p.origin + p.pathname;
    if (/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i.test(p.pathname)) {
      await mustStat(p, location);
      shown.push(html`<img src=${url} alt=${location} />`);
      continue;
    }
    if (/\.(mp4|webm|mov|m4v)$/i.test(p.pathname)) {
      shown.push(html`<video controls src=${url}></video>`);
      continue;
    }
    if (/\.(mp3|ogg|wav|m4a|flac|opus)$/i.test(p.pathname)) {
      shown.push(html`<audio controls src=${url}></audio>`);
      continue;
    }
    const content = await readText(p, location);
    text += content;
    shown.push(codeBlock(content, { numbers: !!opts.number, title: locations.length > 1 ? location : '' }));
  }
  return { toText: () => text, toHTML: () => html`${shown}` };
}

function codeBlock(content, { numbers = false, title = '', from = 1 } = {}) {
  let lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const more = lines.length - DISPLAY_LINES;
  if (more > 0) lines = lines.slice(0, DISPLAY_LINES);
  return html`${title ? html`<div class="muted">${title}</div>` : ''}${numbers
      ? html`<div class="code">
          ${lines.map((l, i) => html`<span class="n">${from + i}</span><pre>${l}</pre>`)}
        </div>`
      : html`<pre>${lines.join('\n')}</pre>`}${more > 0
      ? html`<div class="faint">… ${more} more lines (head, tail, or edit to see them)</div>`
      : ''}`;
}

export async function head(opts = {}, location = '') {
  if (!location) throw new Error('Which file? head {path}');
  const n = Math.max(1, Number(opts.lines) || 10);
  const lines = (await readText(resolveParse(this.env, location), location)).split('\n');
  const part = lines.slice(0, n).join('\n');
  return { toText: () => part, toHTML: () => codeBlock(part, { numbers: true }) };
}

export async function tail(opts = {}, location = '') {
  if (!location) throw new Error('Which file? tail {path}');
  const n = Math.max(1, Number(opts.lines) || 10);
  let lines = (await readText(resolveParse(this.env, location), location)).split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const from = Math.max(0, lines.length - n);
  const part = lines.slice(from).join('\n');
  return { toText: () => part, toHTML: () => codeBlock(part, { numbers: true, from: from + 1 }) };
}

export async function stat(opts = {}, location = '') {
  const p = resolveParse(this.env, location);
  const st = await mustStat(p, location || '.');
  const rows = [
    ['type', st.isDirectory() ? 'folder' : 'file'],
    ['size', st.isDirectory() ? '' : `${formatBytes(st.size)} (${st.size} bytes)`],
    ['modified', st.mtime ? `${new Date(st.mtime).toLocaleString()} (${formatWhen(st.mtime)})` : ''],
    ['created', st.ctime ? new Date(st.ctime).toLocaleString() : ''],
    ['link to', st.linkname || ''],
    ['address', p.origin + p.pathname],
    ...Object.entries(st.metadata || {}).map(([k, v]) => [`meta ${k}`, String(v)]),
  ].filter(([, v]) => v);
  return {
    toText: () => rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
    toHTML: () => html`<table class="rows">
      ${rows.map(([k, v]) => html`<tr><td class="muted">${k}</td><td class="wrap">${v}</td></tr>`)}
    </table>`,
  };
}

export async function wc(opts = {}, ...locations) {
  if (!locations.length) throw new Error('Which file? wc {path}');
  const rows = [];
  for (const location of locations) {
    const text = await readText(resolveParse(this.env, location), location);
    const lines = text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0;
    const words = (text.match(/\S+/g) || []).length;
    rows.push([lines, words, new TextEncoder().encode(text).length, location]);
  }
  return {
    toText: () => rows.map((r) => r.join('\t')).join('\n'),
    toHTML: () => html`<table class="rows">
      <tr><th>lines</th><th>words</th><th>bytes</th><th></th></tr>
      ${rows.map((r) => html`<tr><td class="r num">${r[0]}</td><td class="r num">${r[1]}</td><td class="r num">${r[2]}</td><td>${r[3]}</td></tr>`)}
    </table>`,
  };
}

// folder manipulation
// =

export async function mkdir(opts = {}, ...dsts) {
  if (!dsts.length) throw new Error('Which folder? mkdir {path}');
  const empty = [];
  for (const dst of dsts) {
    var { drive, pathname } = resolveParse(this.env, dst);
    if (opts.parents) {
      let at = '';
      for (const part of pathname.split('/').filter(Boolean)) {
        at += '/' + part;
        const st = await statOrNull(drive, at);
        if (st && !st.isDirectory()) throw new Error(`${at} is a file`);
        if (!st) await drive.mkdir(at);
      }
    } else {
      const st = await statOrNull(drive, pathname);
      if (st) throw new Error(`${dst} is already there`);
      await drive.mkdir(pathname);
    }
    const p = resolveParse(this.env, dst);
    if (!(await statOrNull(p.drive, p.pathname))) {
      // A newer drive keeps a folder while a file is in it.
      for (let at = dirKey(p); at.length > p.origin.length + 1; at = at.slice(0, at.lastIndexOf('/'))) {
        this.term.madeDirs.add(at);
      }
      empty.push(dst);
    }
  }
  if (empty.length) {
    return {
      toText: () => '',
      toHTML: () => html`<div class="faint">
        ${empty.join(', ')} will be kept once a file is in it (cd ${empty[0]} works now)
      </div>`,
    };
  }
}

// file & folder manipulation
// =

export async function mv(opts, src, dst) {
  if (!src || !dst) throw new Error('mv {from} {to}');
  var srcp = resolveParse(this.env, src);
  var dstp = resolveParse(this.env, dst);
  await mustStat(srcp, src);
  let st = await statOrNull(dstp.drive, dstp.pathname);
  if (st && st.isDirectory()) dstp.pathname = joinPath(dstp.pathname, srcp.pathname.split('/').filter(Boolean).pop());
  await srcp.drive.rename(srcp.pathname, dstp.toString());
  return notice(html`Moved ${shortPath(srcp.pathname)} to ${shortPath(dstp.pathname)}`);
}

export async function cp(opts, src, dst) {
  if (!src || !dst) throw new Error('cp {from} {to}');
  var srcp = resolveParse(this.env, src);
  var dstp = resolveParse(this.env, dst);
  await mustStat(srcp, src);
  let st = await statOrNull(dstp.drive, dstp.pathname);
  if (st && st.isDirectory()) dstp.pathname = joinPath(dstp.pathname, srcp.pathname.split('/').filter(Boolean).pop());
  await srcp.drive.copy(srcp.pathname, dstp.toString());
  return notice(html`Copied ${shortPath(srcp.pathname)} to ${shortPath(dstp.pathname)}`);
}

export async function rm(opts = {}, ...dsts) {
  if (!dsts.length) throw new Error('Which file? rm {path}');
  const done = [];
  for (const dst of dsts) {
    var p = resolveParse(this.env, dst);
    var st = await mustStat(p, dst);
    if (st.isDirectory()) {
      if (!opts.recursive) {
        const err = new Error(`${dst} is a folder`);
        err.tip = html`<a class="link" data-fill=${'rm -r ' + dst}>rm -r ${dst}</a> removes it and everything in it`;
        throw err;
      }
      if (!opts.force) {
        const inside = await walk(p.drive, p.pathname, { hidden: true });
        const files = inside.filter((e) => !e.stat.isDirectory()).length;
        const yes = await this.term.confirm(`Remove ${shortPath(p.pathname)} and the ${files} file${files === 1 ? '' : 's'} in it?`);
        if (!yes) return notice('Kept it', 'times');
      }
      await p.drive.rmdir(p.pathname, { recursive: true });
      done.push({ path: shortPath(p.pathname), dir: true, p });
    } else {
      await p.drive.unlink(p.pathname);
      done.push({ path: shortPath(p.pathname), dir: false, p });
    }
  }
  // How to put it back, when the drive keeps its history.
  const undo = [];
  for (const d of done) {
    if (d.dir) continue;
    const h = await nomad.drives.history(driveOf(d.p), { path: d.p.pathname, limit: 1 }).catch(() => null);
    const row = h && h.rows && h.rows[0];
    if (row && row.kind === 'deleted') undo.push(`restore ${escapeArg(d.path)} ${row.restore}`);
  }
  return {
    toText: () => '',
    toHTML: () => html`<div class="notice">
        <span class="icon">${icon('check')}</span><span>Removed ${done.map((d) => d.path + (d.dir ? '/' : '')).join(', ')}</span>
      </div>
      ${undo.length
        ? html`<div class="faint">Undo: ${undo.map((u, i) => html`${i ? ' · ' : ''}<a class="link" data-fill=${u}>${u}</a>`)}</div>`
        : done.some((d) => d.dir)
          ? html`<div class="faint"><a class="link" data-run="versions">versions</a> shows how to put it back</div>`
          : ''}`,
  };
}

export async function ln(opts, target, linkname) {
  if (!target || !linkname) throw new Error('ln {target} {linkname}');
  var targetp = resolveParse(this.env, target);
  var linknamep = resolveParse(this.env, linkname);
  if (targetp.hostname !== linknamep.hostname) throw new Error('The target and the link must be on the same drive');
  await mustStat(targetp, target);
  await targetp.drive.symlink(targetp.pathname, linknamep.pathname);
}

export async function readlink(opts, target) {
  if (!target) throw new Error('readlink {path}');
  var targetp = resolveParse(this.env, target);
  let st = await statOrNull(targetp.drive, targetp.pathname, { lstat: true });
  if (!st) throw new Error(`No such file or folder: ${target}`);
  if (!st.linkname) throw new Error(`${target} isn't a symlink`);
  return st.linkname;
}

export async function write(opts = {}, location = '', ...words) {
  if (!location) throw new Error('write {path} {text...}');
  const p = resolveParse(this.env, location);
  const st = await statOrNull(p.drive, p.pathname);
  if (st && st.isDirectory()) throw new Error(`${location} is a folder`);
  let text = words.join(' ').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  if (text && !text.endsWith('\n')) text += '\n';
  if (opts.append && st) {
    const before = await p.drive.readFile(p.pathname, 'utf8').catch(() => '');
    text = (before || '') + (before && !before.endsWith('\n') ? '\n' : '') + text;
  }
  await p.drive.writeFile(p.pathname, text, 'utf8');
  return notice(
    html`${st ? (opts.append ? 'Added to' : 'Replaced') : 'Made'} <a href=${p.origin + p.pathname}>${shortPath(p.pathname)}</a>
      <span class="faint">(${formatBytes(new TextEncoder().encode(text).length)})</span>`
  );
}

export async function touch(opts = {}, ...locations) {
  if (!locations.length) throw new Error('Which file? touch {path}');
  for (const location of locations) {
    const p = resolveParse(this.env, location);
    const st = await statOrNull(p.drive, p.pathname);
    if (!st) await p.drive.writeFile(p.pathname, '', 'utf8');
    else if (st.isFile() && st.size < 1024 * 1024) {
      await p.drive.writeFile(p.pathname, await p.drive.readFile(p.pathname, 'binary'), 'binary');
    }
  }
}

export async function query(opts = {}, ...paths) {
  var queriesMap = {};
  for (let path of paths.length ? paths : ['.']) {
    let p = resolveParse(this.env, path);
    if (p.origin in queriesMap) {
      queriesMap[p.origin].opts.path.push(p.pathname);
    } else {
      queriesMap[p.origin] = { drive: p.drive, opts: Object.assign({}, opts, { path: [p.pathname] }) };
    }
  }
  var allResults = [];
  for (let q of Object.values(queriesMap)) {
    allResults = allResults.concat(await q.drive.query(q.opts));
  }
  allResults.toText = () => allResults.map((r) => r.url).join('\n');
  allResults.toHTML = () => html`${allResults.map((r) => html`<a href=${r.url}>${r.path}</a><br />`)}`;
  return allResults;
}

export async function meta(opts, location, key = undefined, ...value) {
  if (!location) throw new Error('meta {path} [key] [value]');
  var { drive, pathname } = resolveParse(this.env, location);
  if (value.length) {
    await drive.updateMetadata(pathname, { [key]: value.join(' ') });
  } else if (opts.delete) {
    await drive.deleteMetadata(pathname, key);
  } else {
    var st = await drive.stat(pathname);
    if (key) return st.metadata[key];
    var m = st.metadata || {};
    const entries = Object.entries(m);
    return {
      toText: () => JSON.stringify(m, null, 2),
      toHTML: () =>
        entries.length
          ? html`<table class="rows">
              ${entries.map(([k, v]) => html`<tr><td class="k">${k}</td><td class="wrap">${String(v)}</td></tr>`)}
            </table>`
          : html`<span class="faint">No metadata</span>`,
    };
  }
}

// find
// =

export async function find(opts = {}, pattern = '', location = '') {
  // `find posts/` is a folder, not a pattern.
  if (pattern && !location && /\/$/.test(pattern)) {
    location = pattern;
    pattern = '';
  }
  const p = resolveParse(this.env, location);
  const st = await mustStat(p, location || '.');
  if (!st.isDirectory()) throw new Error(`${location} is a file`);
  const re = pattern ? globToRegExp(pattern) : null;
  const type = String(opts.type || '').slice(0, 1);
  const all = await walk(p.drive, p.pathname, { hidden: pattern.startsWith('.'), signal: this.term.signal });
  const hits = all.filter((e) => {
    if (type === 'f' && e.stat.isDirectory()) return false;
    if (type === 'd' && !e.stat.isDirectory()) return false;
    return !re || re.test(e.name);
  });
  const base = location ? location.replace(/\/?$/, '/') : '';
  const rel = (e) => base + relTo(p.pathname, e.path) + (e.stat.isDirectory() ? '/' : '');
  return {
    toText: () => hits.map(rel).join('\n'),
    toHTML: () =>
      hits.length
        ? html`${hits.slice(0, 500).map(
            (e) => html`<div>
              ${e.stat.isDirectory()
                ? html`<a class="dir" data-run=${'cd ' + escapeArg(rel(e))}>${rel(e)}</a>`
                : html`<a href=${p.origin + e.path}>${rel(e)}</a>`}
            </div>`
          )}
          <div class="faint">${hits.length} found${hits.length > 500 ? ', the first 500 shown' : ''}</div>`
        : html`<span class="faint">Nothing matches ${pattern}</span>`,
  };
}

export async function grep(opts = {}, pattern, location = '') {
  if (!pattern) throw new Error('What to look for? grep {text} [path]');
  const re = grepPattern(pattern, { ignoreCase: !!opts['ignore-case'] });
  const p = resolveParse(this.env, location);
  const st = await mustStat(p, location || '.');
  let files;
  if (st.isDirectory()) {
    files = (await walk(p.drive, p.pathname, { signal: this.term.signal })).filter(
      (e) => !e.stat.isDirectory() && isTextPath(e.path) && e.stat.size < 512 * 1024
    );
  } else {
    files = [{ path: p.pathname, stat: st }];
  }
  const found = [];
  let total = 0;
  for (const f of files.slice(0, 600)) {
    if (this.term.signal && this.term.signal.aborted) break;
    const text = await p.drive.readFile(f.path, 'utf8').catch(() => '');
    if (!text || looksBinary(text)) continue;
    const lines = grepLines(text, re, { max: opts.files ? 1 : 100 });
    if (lines.length) {
      found.push({ path: f.path, lines });
      total += lines.length;
    }
    if (total >= 500) break;
  }
  const relName = (path) => (st.isDirectory() ? relTo(p.pathname, path) : location);
  return {
    toText: () =>
      opts.files
        ? found.map((f) => relName(f.path)).join('\n')
        : found.flatMap((f) => f.lines.map((l) => `${relName(f.path)}:${l.n}:${l.line}`)).join('\n'),
    toHTML: () =>
      !found.length
        ? html`<span class="faint">No matches for ${pattern}</span>`
        : html`${found.map(
              (f) => html`<div style="margin-top: 4px">
                <a class="link" href=${p.origin + f.path}>${relName(f.path)}</a>
                ${opts.files
                  ? ''
                  : f.lines.map(
                      (l) => html`<div style="display: flex; gap: 10px">
                        <a class="num" data-fill=${`head ${escapeArg(relName(f.path))} -n ${l.n + 5}`} title="Show the lines up to here">${l.n}</a>
                        <pre>${l.parts.map((part, i) => (i % 2 ? html`<mark>${part}</mark>` : part))}</pre>
                      </div>`
                    )}
              </div>`
            )}
            <div class="faint" style="margin-top: 4px">${total} match${total === 1 ? '' : 'es'} in ${found.length} file${found.length === 1 ? '' : 's'}</div>`,
  };
}

export async function search(opts = {}, ...words) {
  const q = words.join(' ').trim();
  if (!q) throw new Error('Search for what? search {words}');
  const cwd = new URL(this.env.get('cwd'));
  if (!opts.all && cwd.protocol !== 'hyper:') throw new Error('search works in a Nomad drive');
  const res = await nomad.drives.searchFiles(q, opts.all ? { limit: 50 } : { drive: cwd.origin + '/', limit: 50 });
  const results = (res && res.results) || [];
  return {
    results,
    toText: () => results.map((r) => r.url).join('\n'),
    toHTML: () =>
      results.length
        ? html`${results.map(
              (r) => html`<div style="margin-bottom: 4px">
                <a class="link" href=${r.url}><strong>${r.title || r.path}</strong></a>
                <span class="faint">${opts.all ? `${r.driveTitle || r.driveKey.slice(0, 6)} · ` : ''}${r.path}</span>
                ${r.snippet ? html`<div class="muted">${r.snippet}</div>` : ''}
              </div>`
            )}
            <div class="faint">${results.length} result${results.length === 1 ? '' : 's'}${res.partial ? ' (some files weren’t here in time)' : ''}${
              opts.all ? ` in ${res.searched} drive${res.searched === 1 ? '' : 's'}` : ''
            }</div>`
        : html`<span class="faint"
            >Nothing found for “${q}”${opts.all
              ? ''
              : html` in this drive · <a class="link" data-run=${'search -a ' + q}>search -a ${q}</a> looks in all your drives`}</span
          >`,
  };
}

// versions
// =

const KIND = { added: 'ok', changed: 'k', deleted: 'bad' };


async function historyOf(p, opts) {
  const h = await nomad.drives.history(driveOf(p), opts);
  if (!h) {
    const err = new Error('This drive has no version history');
    err.tip = 'Only drives made with Nomad’s newer kind of drive keep every change. mkdrive makes one.';
    throw err;
  }
  return h;
}

export async function versions(opts = {}, location = '') {
  const p = resolveParse(this.env, location || '/');
  const path = location ? p.pathname.replace(/\/$/, '') || '/' : null;
  if (opts.open) {
    const url = `nomad://versions/?drive=${encodeURIComponent(driveOf(p))}${path && path !== '/' ? `&path=${encodeURIComponent(path)}` : ''}`;
    this.page.goto(url, { newTab: true });
    return notice('Opened the version history');
  }
  const count = Math.min(Math.max(Number(opts.count) || 20, 1), 200);
  const h = await historyOf(p, { path: path && path !== '/' ? path : null, limit: count });
  const rows = h.rows || [];
  const name = (r) => escapeArg(r.path);
  // Each change made the drive's next version (seq + 1). `restore {file} {v}` puts a file back as
  // it was at version v, so a deleted file comes back from the version before its delete.
  const back = (r) => (r.kind === 'deleted' ? r.restore : r.seq + 1);
  return {
    rows,
    toText: () => rows.map((r) => `${r.seq + 1}\t${new Date(r.at || 0).toISOString()}\t${r.kind}\t${r.path}`).join('\n'),
    toHTML: () => html`
      <div class="muted" style="margin-bottom: 2px">
        ${h.title || 'This drive'} is at version <span class="num">${h.version}</span>${h.writable ? '' : ' · read only for you'}
      </div>
      ${rows.length
        ? html`<table class="rows">
            <tr><th>version</th><th>when</th><th>change</th><th>file</th><th></th><th></th></tr>
            ${rows.map(
              (r) => html`<tr>
                <td class="r num">${r.seq + 1}</td>
                <td class="faint">${r.approx ? '~' : ''}${formatWhen(r.at)}</td>
                <td class=${KIND[r.kind]}>${r.kind}</td>
                <td><a href=${p.origin + r.path}>${r.path}</a></td>
                <td class="r faint">${r.kind === 'deleted' ? '' : formatBytes(r.size)}</td>
                <td>
                  <a class="link" data-fill=${`diff ${name(r)} ${back(r)}`} title="Compare it with now">diff</a>
                  · <a class="link" data-fill=${`restore ${name(r)} ${back(r)}`} title=${r.kind === 'deleted' ? 'Put it back' : 'Put it back as it was here'}>${r.kind === 'deleted' ? 'undelete' : 'restore'}</a>
                </td>
              </tr>`
            )}
          </table>`
        : html`<div class="faint">No changes yet</div>`}
      <div class="faint" style="margin-top: 4px">
        <code>restore {file} {version}</code> puts a file back as it was at that version ·
        <a class="link" data-run=${'versions --open' + (location ? ' ' + location : '')}>versions --open</a> shows it all
      </div>
    `,
  };
}

export async function diff(opts = {}, a = '', b = '') {
  if (!a) throw new Error('diff {path} [version|other-path]');
  const pa = resolveParse(this.env, a);
  let oldText;
  let newText;
  let from;
  let to;
  if (b && !/^\d+$/.test(b)) {
    // Two files, as they are now.
    oldText = await readText(pa, a);
    newText = await readText(resolveParse(this.env, b), b);
    from = a;
    to = b;
  } else {
    let version = b ? Number(b) : null;
    const st = await statOrNull(pa.drive, pa.pathname);
    if (st && st.isDirectory()) throw new Error(`${a} is a folder: diff compares files`);
    if (version == null) {
      // Since its last change: the file just before that change.
      const h = await historyOf(pa, { path: pa.pathname, limit: 1 });
      const last = h.rows && h.rows[0];
      if (!last) throw new Error(`${a} has no changes in the history`);
      version = last.seq;
    }
    const then = await nomad.drives.fileAt(driveOf(pa), pa.pathname, version);
    if (then.exists && then.text == null) throw new Error(`${a} isn't text (or is too big to compare)`);
    oldText = then.exists ? then.text : '';
    newText = st ? await readText(pa, a) : '';
    from = `${shortPath(pa.pathname)} @ ${version}${then.exists ? '' : ' (not there yet)'}`;
    to = `${shortPath(pa.pathname)} now${st ? '' : ' (removed)'}`;
  }
  const ops = diffLines(oldText, newText);
  const hs = hunks(ops, 3);
  const { added, removed } = stats(ops);
  return {
    toText: () => unified(ops, { from, to }),
    toHTML: () =>
      !hs.length
        ? html`<span class="faint">No changes: ${from} and ${to} are the same</span>`
        : html`<div class="diff">
            <div class="file"><span>${from} → ${to}</span><span class="ok">+${added}</span><span class="bad">−${removed}</span></div>
            ${hs.map(
              (h) => html`<div class="h">${h.header}</div>
                ${h.lines.map(
                  (o) => html`<div class="l ${o.op === '+' ? 'add' : o.op === '-' ? 'del' : ''}">
                    <span class="n">${o.a || ''}</span><span class="n">${o.b || ''}</span><span class="op">${o.op === ' ' ? '' : o.op === '-' ? '−' : '+'}</span><span class="t">${o.text}</span>
                  </div>`
                )}`
            )}
          </div>`,
  };
}

export async function restore(opts = {}, a = '', b = '') {
  if (opts.drive) {
    const version = Number(a || b);
    if (!version) throw new Error('Which version? restore -d {version} (versions lists them)');
    const p = resolveParse(this.env, '/');
    const s = await nomad.drives.restorePreview(driveOf(p), version);
    if (!s.total) return notice(`The drive is already as it was at version ${version}`);
    const parts = [s.changed && `${s.changed} changed back`, s.back && `${s.back} put back`, s.removed && `${s.removed} removed`].filter(Boolean);
    this.out(html`<div class="muted">Restoring the drive to version ${version}: ${parts.join(', ')}</div>
      <div class="faint">${s.paths.join(' · ')}${s.total > s.paths.length ? ` · and ${s.total - s.paths.length} more` : ''}</div>`);
    const yes = await this.term.confirm('Restore the whole drive?');
    if (!yes) return notice('Left it as it is', 'times');
    await nomad.drives.restoreDrive(driveOf(p), version);
    return notice(html`Restored the drive to version ${version}. It's one more change, so <a class="link" data-run="versions">versions</a> can undo it.`);
  }
  if (!a || !b || !/^\d+$/.test(b)) {
    const err = new Error('restore {path} {version}');
    err.tip = html`<a class="link" data-run=${'versions ' + (a || '')}>versions ${a}</a> lists the versions`;
    throw err;
  }
  const p = resolveParse(this.env, a);
  const version = Number(b);
  const before = await historyOf(p, { path: p.pathname, limit: 1 });
  const res = await nomad.drives.restoreFile(driveOf(p), p.pathname, version);
  if (!res || !res.changed) return notice(`${shortPath(p.pathname)} is already as it was at version ${version}`);
  const prev = before.rows && before.rows[0];
  const undo = prev ? `restore ${escapeArg(a)} ${prev.seq + 1}` : '';
  return {
    toText: () => '',
    toHTML: () => html`<div class="notice"><span class="icon">${icon('undo')}</span><span>Restored ${shortPath(p.pathname)} as it was at version ${version}</span></div>
      ${undo ? html`<div class="faint">Undo: <a class="link" data-fill=${undo}>${undo}</a></div>` : ''}`,
  };
}

// drives
// =

export async function info(opts = {}, location = '') {
  const p = resolveParse(this.env, location || '/');
  if (p.protocol !== 'hyper:') throw new Error('info works on Nomad drives (hyper://)');
  const i = await nomad.fs.getInfo(p.origin);
  const h = await nomad.drives.history(driveOf(p), { limit: 1 }).catch(() => null);
  const rows = [
    ['title', i.title || '(untitled)'],
    ['description', i.description || ''],
    ['address', html`<a class="link" href=${i.url}>${i.url}</a>`],
    ['you', i.writable ? html`<span class="ok">can change it</span>` : html`<span class="warn">can only read it</span>`],
    ['kind', [i.type, h ? 'keeps every version' : 'older drive, no version history', i.collaborative ? 'others can ask to edit' : ''].filter(Boolean).join(' · ')],
    ['version', h ? html`<span class="num">${h.version}</span>` : i.version != null ? String(i.version) : ''],
    ['tags', (i.tags || []).join(', ')],
  ].filter(([, v]) => v);
  return {
    info: i,
    toText: () => JSON.stringify({ title: i.title, url: i.url, writable: i.writable, type: i.type }, null, 2),
    toHTML: () => html`<table class="rows">
      ${rows.map(([k, v]) => html`<tr><td class="muted">${k}</td><td class="wrap">${v}</td></tr>`)}
    </table>`,
  };
}

export async function mkdrive(opts = {}) {
  var drive = await nomad.fs.createDrive({ title: opts.title, description: opts.desc, prompt: false });
  const url = typeof drive === 'string' ? drive : drive.url;
  return {
    toText: () => url,
    toHTML: () => html`<div class="notice"><span class="icon">${icon('check')}</span><span>Made <a class="link" href=${url}>${opts.title || url}</a></span></div>
      <div class="faint"><a class="link" data-run=${'cd ' + url}>cd ${url}</a></div>`,
  };
}

export async function mkgoto(opts, location, href) {
  if (!location || !href) throw new Error('mkgoto {path} {href}');
  var { drive, pathname } = resolveParse(this.env, location);
  if (!pathname.endsWith('.goto')) pathname += '.goto';
  await drive.writeFile(pathname, '', { metadata: { href, title: opts.title } });
}

export async function bookmark(opts = {}, href = '.') {
  href = this.env.resolve(href || '.');
  await nomad.bookmarks.add({ href, title: opts.title || href, site: 'hyper://private' });
  return notice(html`Bookmarked <a href=${href}>${opts.title || href}</a>`, 'star');
}

export async function echo(opts, ...args) {
  return args.join(' ');
}

export async function go(opts = {}, location = '') {
  if (opts.bookmark) {
    location = `hyper://private/bookmarks/${location}`;
    if (!location.endsWith('.goto')) location += '.goto';
  }
  location = /^[a-z][a-z0-9+.-]*:/i.test(location) && !location.startsWith('hyper:') ? location : this.env.resolve(location);
  if (location.endsWith('.goto')) {
    let urlp = parseLocation(location);
    let st = await statOrNull(urlp.drive, urlp.pathname);
    if (st && st.metadata.href) location = st.metadata.href;
  }
  await this.page.goto(location, { newTab: opts['new-tab'] });
}

export async function edit(opts = {}, location = '') {
  if (!location) throw new Error('Which file? edit {path}');
  location = this.env.resolve(location);
  var urlp = parseLocation(location);
  let st = await statOrNull(urlp.drive, urlp.pathname);
  if (st && st.isDirectory()) throw new Error(`${shortPath(urlp.pathname)} is a folder`);
  if (!st) await urlp.drive.writeFile(urlp.pathname, '');
  await this.page.goto(`nomad://editor/?url=${location}`);
}

export function clear() {
  this.env.clearHistory();
}

export function reload() {
  window.location.reload();
}

// The commands you ran, numbered for `!n`.
export function history(opts = {}, ...words) {
  if (opts.clear) {
    this.term.clearHistory();
    return notice('Forgot your command history');
  }
  const list = this.term.history();
  const q = words.join(' ').toLowerCase();
  const rows = list.map((line, i) => ({ n: i + 1, line })).filter((r) => !q || r.line.toLowerCase().includes(q));
  const shown = rows.slice(-200);
  return {
    toText: () => shown.map((r) => `${String(r.n).padStart(5)}  ${r.line}`).join('\n'),
    toHTML: () =>
      shown.length
        ? html`<table class="rows">
              ${shown.map(
                (r) => html`<tr>
                  <td class="r faint">${r.n}</td>
                  <td class="wrap"><a data-fill=${r.line} title="Put it in the prompt">${r.line}</a></td>
                </tr>`
              )}
            </table>
            <div class="faint"><code>!!</code> runs the last · <code>!n</code> runs number n · <kbd>Ctrl</kbd>+<kbd>R</kbd> searches</div>`
        : html`<span class="faint">Nothing yet</span>`,
  };
}

// env vars
// =

export const env = {
  ls(opts) {
    var vars = this.env.getAll();
    return {
      toText: () => Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n'),
      toHTML: () => html`<table class="rows">
        ${Object.entries(vars).map(([k, v]) => html`<tr><td class="k">$${k}</td><td class="wrap">${v}</td></tr>`)}
      </table>`,
    };
  },
  get(opts, name = '') {
    if (name.startsWith('$')) name = name.slice(1);
    return this.env.get(name);
  },
  set(opts, name = '', ...value) {
    if (name.startsWith('$')) name = name.slice(1);
    if (!name) throw new Error('env set {name} {value}');
    return this.env.set(name, value.join(' '));
  },
  rm(opts, name = '') {
    if (name.startsWith('$')) name = name.slice(1);
    return this.env.set(name, undefined);
  },
};

// page interactions
// =

export const page = {
  async exec(opts, ...jsArgs) {
    var js = jsArgs.join(' ');
    if (!js) throw new Error('page exec {js}');
    var result = await this.page.exec(js);
    return { result, toText: () => String(result), toHTML: () => html`<pre>${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre>` };
  },
  async inject(opts, ...cssArgs) {
    var css = cssArgs.join(' ');
    if (!css) throw new Error('page inject {css}');
    var id = await this.page.inject(css);
    const uninject = (e) => {
      e.preventDefault();
      e.currentTarget.insertAdjacentText('beforeBegin', 'Taken out');
      e.currentTarget.remove();
      this.page.uninject(id);
    };
    this.out(html`<button @click=${uninject}>Take it out</button>`);
    return id;
  },
  async uninject(opts, id) {
    return this.page.uninject('' + id);
  },
};

// system
// =

export const system = {
  async fs_audit_stream(opts = {}) {
    var containerEl = document.createElement('div');
    containerEl.classList.add('border-default');
    containerEl.style.height = '50vh';
    containerEl.style.minHeight = '150px';
    containerEl.style.overflow = 'auto';
    containerEl.style.padding = '5px 8px';

    function isOriginEq(a, b) {
      try {
        return new URL(a).origin === new URL(b).origin;
      } catch (e) {
        return false;
      }
    }

    var stream = await nomad.logger.streamAuditLog();
    stream.addEventListener('data', (e) => {
      if (opts.caller && !isOriginEq(opts.caller, e.detail.caller)) return;
      if (opts.target && !isOriginEq(opts.target, e.detail.target)) return;
      if (opts.method && e.detail.method !== opts.method) return;
      if (opts.longerthan && e.detail.runtime < +opts.longerthan) return;
      var entry = document.createElement('div');
      entry.style.borderBottom = '1px solid var(--term-border)';
      entry.style.padding = '2px 0';
      const row = (k, v) => {
        const d = document.createElement('div');
        const s = document.createElement('span');
        s.className = 'faint';
        s.style.display = 'inline-block';
        s.style.width = '60px';
        s.textContent = k;
        d.append(s, document.createTextNode(String(v)));
        return d;
      };
      entry.append(
        row('caller', e.detail.caller),
        row('target', `hyper://${e.detail.target}/`),
        row('time', new Date(e.detail.ts).toLocaleTimeString()),
        row('runtime', `${e.detail.runtime}ms`),
        row('method', e.detail.method),
        row('args', e.detail.args)
      );
      containerEl.prepend(entry);
    });
    function onStopStream(e) {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.parentNode.textContent = 'Stream stopped';
      stream.close();
    }
    this.out(
      html`<p>Streaming <button class="icon-btn small" title="Stop streaming" aria-label="Stop streaming" @click=${onStopStream}>${icon('stop')}</button></p>`,
      containerEl
    );
  },
};

// etc
// =

export function exit() {
  this.env.close();
}
