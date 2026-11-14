// nomad://versions/?drive=<url>[&path=/file] — a drive's version history: every change, newest
// first, grouped by day; an old version of a file; restoring one file, or the whole drive, to a
// point. A restore is one more change, so it shows here too and can itself be undone.
//
// Everything comes from the internal nomad.drives API (bg/web-apis/bg/drives.ts →
// app/bg/hyper/drive-history.js; the rules are shared/drive-history.mjs). Only Autobase drives
// (every drive made since ADR-0010) have a history; an old Hyperdrive gets a notice.
//
// Vanilla JS (served as-is, no bundle), styled with the app-stdlib tokens like nomad://calendar.

const params = new URLSearchParams(location.search);

const state = {
  drive: normalizeDrive(params.get('drive') || ''),
  path: params.get('path') || '',
  info: null, // { title, writable, version }
  rows: [],
  before: null,
  loading: true,
  loadingMore: false,
  error: '',
  none: false, // no history to show (not an Autobase drive)
  viewing: null, // { row, loading, file, error }
  confirming: null, // { row, version, loading, summary, error }
  busy: false,
  toast: '',
};

function normalizeDrive(s) {
  const m = /^hyper:\/\/([^/?#]+)/i.exec(String(s).trim());
  return m ? `hyper://${m[1]}/` : '';
}

async function load({ more = false } = {}) {
  if (!state.drive) {
    state.loading = false;
    render();
    return;
  }
  if (more) state.loadingMore = true;
  else state.loading = true;
  render();
  try {
    const res = await nomad.drives.history(state.drive, {
      before: more ? state.before : null,
      path: state.path || null,
    });
    if (!res) {
      state.none = true;
    } else {
      state.info = {
        title: res.title,
        writable: res.writable,
        version: res.version,
      };
      state.rows = more ? state.rows.concat(res.rows) : res.rows;
      state.before = res.before;
    }
    state.error = '';
  } catch (err) {
    state.error = err.message || String(err);
  }
  state.loading = false;
  state.loadingMore = false;
  render();
}

function setPath(path) {
  state.path = path;
  const u = new URL(location.href);
  if (path) u.searchParams.set('path', path);
  else u.searchParams.delete('path');
  history.replaceState(null, '', u);
  load();
}

// rendering

function render() {
  const app = document.getElementById('app');
  const driveName =
    state.info?.title || (state.drive ? shortKey(state.drive) : '');
  document.title = [
    state.path ? state.path.split('/').pop() : '',
    driveName,
    'Version history',
  ]
    .filter(Boolean)
    .join(' · ');
  app.replaceChildren(
    ...[
      el('header', {}, [
        el('div', { class: 'brand' }, [
          el('img', { src: 'asset:favicon:nomad://versions/', alt: '' }),
          'Version history',
        ]),
        driveName
          ? el('div', { class: 'drive-name', title: state.drive }, [driveName])
          : null,
        el('div', { class: 'spacer' }),
        state.drive
          ? el('a', { class: 'btn', href: state.drive, target: '_blank' }, [
              icon('external-link-alt'),
              'Open drive',
            ])
          : null,
      ]),
      el('main', {}, [renderBody()]),
      state.viewing ? renderViewer() : null,
      state.confirming ? renderConfirm() : null,
      state.toast
        ? el('div', { class: 'toast', role: 'status' }, [state.toast])
        : null,
    ].filter(Boolean),
  );
}

function renderBody() {
  if (!state.drive) {
    return notice(
      'No drive picked',
      'Open Version history from a drive’s site info (Tools) or its menu in My Library.',
    );
  }
  if (state.loading)
    return el('div', { class: 'loading' }, [
      icon('circle-notch', 'fa-spin'),
      ' Reading the history…',
    ]);
  if (state.error) return notice('Couldn’t read the history', state.error);
  if (state.none) {
    return notice(
      'This drive has no version history',
      'Drives made before collaborative drives (and drives from outside Nomad) keep no history Nomad can show.',
    );
  }
  const parts = [];
  if (!state.info.writable) {
    parts.push(
      el('div', { class: 'banner' }, [
        icon('eye'),
        el('span', {}, [
          'You can look through this drive’s history. Only a device that can edit it can restore.',
        ]),
      ]),
    );
  }
  if (state.path) {
    parts.push(
      el('div', { class: 'filter' }, [
        icon('file-alt'),
        el('span', {}, ['Changes to ', el('code', {}, [state.path])]),
        el('button', { class: 'btn', onclick: () => setPath('') }, [
          'Show every file',
        ]),
      ]),
    );
  }
  if (!state.rows.length) {
    parts.push(
      notice(
        'No changes yet',
        state.path
          ? 'This file has no changes to show.'
          : 'Files you add and edit show up here.',
      ),
    );
    return el('div', {}, parts);
  }
  for (const [day, rows] of groupByDay(state.rows)) {
    parts.push(
      el('section', { class: 'day' }, [
        el('h2', {}, [day]),
        el('div', { class: 'rows' }, rows.map(renderRow)),
      ]),
    );
  }
  if (state.before != null) {
    parts.push(
      el('div', { class: 'more' }, [
        el(
          'button',
          {
            class: 'btn',
            disabled: state.loadingMore,
            onclick: () => load({ more: true }),
          },
          [
            state.loadingMore ? icon('circle-notch', 'fa-spin') : null,
            'Show older changes',
          ],
        ),
      ]),
    );
  }
  return el('div', {}, parts);
}

const KIND = {
  added: { icon: 'plus', label: 'Added' },
  changed: { icon: 'pen', label: 'Changed' },
  deleted: { icon: 'trash', label: 'Deleted' },
};

function renderRow(row) {
  const k = KIND[row.kind] || KIND.changed;
  const writable = state.info.writable;
  return el('div', { class: `row ${row.kind}` }, [
    el('span', { class: 'kind-icon', title: k.label }, [icon(k.icon)]),
    el('div', { class: 'main' }, [
      el(
        'button',
        {
          class: 'path',
          title: state.path ? row.path : `Show only ${row.path}`,
          onclick: () => !state.path && setPath(row.path),
        },
        [row.path],
      ),
      el('div', { class: 'meta' }, [
        k.label,
        ' · ',
        row.at ? (row.approx ? 'about ' : '') + timeOf(row.at) : 'time unknown',
        row.kind !== 'deleted' ? ` · ${formatSize(row.size)}` : '',
      ]),
    ]),
    el('div', { class: 'actions' }, [
      el(
        'button',
        {
          class: 'icon-btn',
          title:
            row.kind === 'deleted'
              ? 'See the file as it was before it was deleted'
              : 'See this version',
          'aria-label':
            row.kind === 'deleted'
              ? 'See the file as it was before it was deleted'
              : 'See this version',
          onclick: () => openViewer(row),
        },
        [icon('eye')],
      ),
      writable
        ? el(
            'button',
            {
              class: 'icon-btn',
              title:
                row.kind === 'deleted'
                  ? 'Bring this file back'
                  : 'Restore this version of the file',
              'aria-label':
                row.kind === 'deleted'
                  ? 'Bring this file back'
                  : 'Restore this version of the file',
              disabled: state.busy,
              onclick: () => restoreFile(row),
            },
            [icon('undo')],
          )
        : null,
      writable
        ? el(
            'button',
            {
              class: 'icon-btn',
              title: 'Restore the whole drive to just after this change',
              'aria-label': 'Restore the whole drive to just after this change',
              disabled: state.busy,
              onclick: () => openConfirm(row),
            },
            [icon('history')],
          )
        : null,
    ]),
  ]);
}

function renderViewer() {
  const { row, loading, file, error } = state.viewing;
  let body;
  if (loading)
    body = el('div', { class: 'loading' }, [
      icon('circle-notch', 'fa-spin'),
      ' Reading…',
    ]);
  else if (error) body = el('p', { class: 'error' }, [error]);
  else if (!file.exists)
    body = el('p', { class: 'muted' }, [
      'The file didn’t exist at this point.',
    ]);
  else if (file.text == null) {
    body = el('p', { class: 'muted' }, [
      `This version (${formatSize(file.size)}) can’t be shown here: it isn’t text, or it’s too big. You can still restore it.`,
    ]);
  } else body = el('pre', { class: 'file-text' }, [file.text || ' ']);
  const when = row.at ? dateTimeOf(row.at, row.approx) : '';
  return modal(
    [
      el('h3', {}, [row.path]),
      el('div', { class: 'muted' }, [
        row.kind === 'deleted'
          ? `Before it was deleted${when ? `, ${when}` : ''}`
          : when,
      ]),
    ],
    body,
    [
      el('button', { class: 'btn', onclick: closeModal }, ['Close']),
      state.info.writable
        ? el(
            'button',
            {
              class: 'btn primary',
              disabled: state.busy || loading,
              onclick: () => restoreFile(row),
            },
            [
              icon('undo'),
              row.kind === 'deleted' ? 'Bring it back' : 'Restore this version',
            ],
          )
        : null,
    ],
  );
}

function renderConfirm() {
  const { row, loading, summary, error } = state.confirming;
  let body;
  if (loading)
    body = el('div', { class: 'loading' }, [
      icon('circle-notch', 'fa-spin'),
      ' Working out what would change…',
    ]);
  else if (error) body = el('p', { class: 'error' }, [error]);
  else if (!summary.total)
    body = el('p', {}, [
      'The drive is already the way it was then. Nothing would change.',
    ]);
  else {
    const counts = [
      summary.changed &&
        (summary.changed === 1
          ? '1 file goes back to an older version'
          : `${summary.changed} files go back to an older version`),
      summary.back &&
        (summary.back === 1
          ? '1 deleted file comes back'
          : `${summary.back} deleted files come back`),
      summary.removed &&
        (summary.removed === 1
          ? '1 newer file is removed'
          : `${summary.removed} newer files are removed`),
    ].filter(Boolean);
    body = el('div', {}, [
      el(
        'ul',
        { class: 'counts' },
        counts.map((c) => el('li', {}, [c])),
      ),
      el('div', { class: 'paths' }, [
        ...summary.paths.map((p) => el('code', {}, [p])),
        summary.total > summary.paths.length
          ? el('div', { class: 'muted' }, [
              `and ${summary.total - summary.paths.length} more`,
            ])
          : null,
      ]),
      el('p', { class: 'muted' }, [
        'This is saved as a new change, so you can undo it from this page.',
      ]),
    ]);
  }
  return modal(
    [
      el('h3', {}, ['Restore the whole drive?']),
      el('div', { class: 'muted' }, [
        `To just after ${row.path} was ${(KIND[row.kind] || KIND.changed).label.toLowerCase()}${row.at ? `, ${dateTimeOf(row.at, row.approx)}` : ''}`,
      ]),
    ],
    body,
    [
      el('button', { class: 'btn', onclick: closeModal }, ['Cancel']),
      el(
        'button',
        {
          class: 'btn primary',
          disabled: state.busy || loading || !!error || !summary?.total,
          onclick: restoreDrive,
        },
        [icon('history'), 'Restore drive'],
      ),
    ],
  );
}

function modal(head, body, buttons) {
  const box = el(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    [
      el('div', { class: 'modal-head' }, [
        el('div', { class: 'modal-title' }, head),
        el(
          'button',
          {
            class: 'icon-btn',
            title: 'Close',
            'aria-label': 'Close',
            onclick: closeModal,
          },
          [icon('times')],
        ),
      ]),
      el('div', { class: 'modal-body' }, [body]),
      el('div', { class: 'modal-foot' }, buttons),
    ],
  );
  return el(
    'div',
    {
      class: 'backdrop',
      onclick: (e) => e.target === e.currentTarget && closeModal(),
    },
    [box],
  );
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (state.viewing || state.confirming)) closeModal();
});

function closeModal() {
  state.viewing = null;
  state.confirming = null;
  render();
}

// actions

async function openViewer(row) {
  state.viewing = { row, loading: true, file: null, error: '' };
  render();
  try {
    const file = await nomad.drives.fileAt(state.drive, row.path, row.restore);
    if (state.viewing?.row === row)
      state.viewing = { row, loading: false, file, error: '' };
  } catch (err) {
    if (state.viewing?.row === row)
      state.viewing = {
        row,
        loading: false,
        file: null,
        error: err.message || String(err),
      };
  }
  render();
}

// The drive just after this row's change.
const pointAfter = (row) => row.seq + 1;

async function openConfirm(row) {
  const version = pointAfter(row);
  state.confirming = { row, version, loading: true, summary: null, error: '' };
  render();
  try {
    const summary = await nomad.drives.restorePreview(state.drive, version);
    if (state.confirming?.row === row)
      state.confirming = { row, version, loading: false, summary, error: '' };
  } catch (err) {
    if (state.confirming?.row === row)
      state.confirming = {
        row,
        version,
        loading: false,
        summary: null,
        error: err.message || String(err),
      };
  }
  render();
}

async function restoreFile(row) {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    const { changed } = await nomad.drives.restoreFile(
      state.drive,
      row.path,
      row.restore,
    );
    state.viewing = null;
    flash(
      changed ? `Restored ${row.path}` : `${row.path} is already that version`,
    );
    await load();
  } catch (err) {
    flash(err.message || String(err));
  }
  state.busy = false;
  render();
}

async function restoreDrive() {
  const c = state.confirming;
  if (!c || state.busy) return;
  state.busy = true;
  render();
  try {
    const sum = await nomad.drives.restoreDrive(state.drive, c.version);
    state.confirming = null;
    flash(
      sum.total
        ? `Restored the drive (${sum.total} file${sum.total === 1 ? '' : 's'})`
        : 'Nothing needed to change',
    );
    await load();
  } catch (err) {
    if (state.confirming) state.confirming.error = err.message || String(err);
  }
  state.busy = false;
  render();
}

let toastTimer;
function flash(text) {
  state.toast = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = '';
    render();
  }, 3500);
}

// helpers

function groupByDay(rows) {
  const groups = new Map();
  let last = 'Earlier';
  for (const row of rows) {
    const day = row.at ? dayLabel(row.at) : last;
    last = day;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(row);
  }
  return groups;
}

function dayLabel(ms) {
  const d = new Date(ms);
  const now = new Date();
  const start = (x) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

const timeOf = (ms) =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
const dateTimeOf = (ms, approx = false) =>
  `${dayLabel(ms).replace(/^Today$/, 'today').replace(/^Yesterday$/, 'yesterday')} at ${approx ? 'about ' : ''}${timeOf(ms)}`;

function formatSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const shortKey = (url) => {
  const host = /^hyper:\/\/([^/]+)/.exec(url)?.[1] || url;
  return host.length > 20 ? `${host.slice(0, 6)}…${host.slice(-4)}` : host;
};

function notice(title, text) {
  return el('div', { class: 'notice' }, [
    el('h2', {}, [title]),
    el('p', {}, [text]),
  ]);
}

function showFatal(err) {
  document
    .getElementById('app')
    .replaceChildren(
      notice('Version history failed to start', err.message || String(err)),
    );
  console.error('[versions] init error:', err);
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) {
      if (v) node.addEventListener(k.slice(2), v);
    } else if (k === 'disabled') node.disabled = !!v;
    else if (v === true) node.setAttribute(k, '');
    else if (v != null && v !== false) node.setAttribute(k, v);
  }
  for (const c of children || []) if (c != null && c !== false) node.append(c);
  return node;
}

function icon(name, cls = '') {
  return el('span', {
    class: `fas fa-fw fa-${name}${cls ? ' ' + cls : ''}`,
    'aria-hidden': 'true',
  });
}

// boot: last, so every helper above is defined.
load().catch(showFatal);
