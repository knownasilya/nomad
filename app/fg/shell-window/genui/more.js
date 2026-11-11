// The second set of components (ADR-0048), shaped after Nuxt UI's: layout (Grid, Columns,
// Accordion, Collapsible, Carousel, Header), content (Icon, Avatar, User, Kbd, Link, Breadcrumb,
// CodeBlock, Empty, Feature), lists (List, DataList, Tree) and numbers (Sparkline, Calendar, the
// ring of a Progress). `ui` is the <nomad-genui> drawing them: _node() and _slot() draw what a
// slot holds, _state()/_setState() keep what is open, _fire() sends a click's steps.
//
// Like the rest, every string from the model goes in as text, an icon is a name from
// app/lib/genui/icons.mjs, and a url opens only on a click (cards.js linkOf).

import { html, svg, nothing } from 'lit';
import { iconName } from '../../../lib/genui/icons.mjs';
import { linkOf } from './cards.js';
import { initials, monthGrid, parseMonth, ringDash, sparkGeometry } from './chart-math.js';

const isEl = (v) => v && typeof v === 'object' && v.type === 'element';
const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v) => (v == null ? '' : typeof v === 'object' ? '' : String(v));
const oneOf = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);

export const COLORS = ['neutral', 'primary', 'info', 'success', 'warning', 'error'];
// The class that sets a color's variables (styles.js): '' for none.
export const colorClass = (c, dflt = '') => (c === 'danger' ? 'error' : oneOf(c, COLORS, dflt));
export const sizeClass = (s) => `sz-${oneOf(s, ['s', 'm', 'l'], 'm')}`;

// <span class="fas fa-…">, or nothing for a name we don't draw.
export function icon(name, cls = '') {
  const n = iconName(name);
  return n ? html`<span class="fas fa-fw fa-${n} ${cls}" aria-hidden="true"></span>` : nothing;
}

function open(ui, link) {
  return (e) => {
    e.stopPropagation();
    ui._fire([{ type: 'open_url', url: link.href }]);
  };
}

// — Layout —

const COLS = { 1: 1, 2: 2, 3: 3, 4: 4 };

export function grid(ui, p, path) {
  const cols = COLS[Math.round(Number(p.columns))] || 2;
  return html`<div class="grid-wrap">
    <div class="grid c${cols}" style="gap:${ui._gap(p.gap)}px">
      ${list(p.children).map((c, i) => {
        if (isEl(c) && c.typeName === 'GridItem') {
          const span = Math.max(1, Math.min(cols, Math.round(Number(c.props?.span)) || 1));
          return html`<div class="grid-item stack span${span}">
            ${ui._children(c.props?.children, `${path}.${i}`)}
          </div>`;
        }
        return ui._node(c, `${path}.${i}`);
      })}
    </div>
  </div>`;
}

// Outside a Grid a GridItem is only its children.
export function gridItem(ui, p, path) {
  return html`<div class="stack">${ui._children(p.children, path)}</div>`;
}

export function columns(ui, p, path) {
  const count = Math.max(1, Math.min(4, Math.round(Number(p.count)) || 3));
  return html`<div class="columns" style="--col-count:${count};--col-gap:${ui._gap(p.gap, 16)}px">
    ${ui._children(p.children, path)}
  </div>`;
}

export function accordion(ui, p, path) {
  const items = list(p.items).filter(isEl);
  if (!items.length) return nothing;
  const key = `acc:${path}`;
  const start = items.map((it, i) => (it.props?.open === true ? i : -1)).filter((i) => i >= 0);
  const opened = ui._state(key, p.multiple ? start : start.slice(0, 1));
  const toggle = (i) => {
    const on = opened.includes(i);
    ui._setState(key, on ? opened.filter((n) => n !== i) : p.multiple ? [...opened, i] : [i]);
  };
  return html`<div class="accordion">
    ${items.map((it, i) => {
      const t = it.props || {};
      const on = opened.includes(i);
      return html`<div class="acc-item ${on ? 'open' : ''}">
        <button class="acc-head" aria-expanded=${on ? 'true' : 'false'} @click=${() => toggle(i)}>
          ${icon(t.icon, 'acc-icon')}
          <span class="acc-label">${str(t.label)}</span>
          <span class="fas fa-chevron-down chev" aria-hidden="true"></span>
        </button>
        ${on
          ? html`<div class="acc-body stack">${ui._children(t.content, `${path}.${i}`)}</div>`
          : nothing}
      </div>`;
    })}
  </div>`;
}

export function collapsible(ui, p, path) {
  const key = `col:${path}`;
  const on = ui._state(key, p.open === true);
  return html`<div class="collapsible ${on ? 'open' : ''}">
    <button
      class="col-head"
      aria-expanded=${on ? 'true' : 'false'}
      @click=${() => ui._setState(key, !on)}
    >
      <span class="fas fa-chevron-right chev" aria-hidden="true"></span>
      <span>${str(p.label)}</span>
    </button>
    ${on ? html`<div class="col-body stack">${ui._children(p.children, path)}</div>` : nothing}
  </div>`;
}

export function carousel(ui, p, path) {
  const items = list(p.items);
  if (!items.length) return nothing;
  const key = `car:${path}`;
  const at = Math.max(0, Math.min(items.length - 1, ui._state(key, 0)));
  const go = (d) => ui._setState(key, (at + d + items.length) % items.length);
  if (items.length === 1) return html`<div class="stack">${ui._node(items[0], `${path}.0`)}</div>`;
  return html`<div class="carousel">
    <div class="stack" aria-live="polite">${ui._node(items[at], `${path}.${at}`)}</div>
    <div class="carousel-nav">
      <button class="icon-btn" title="Previous" aria-label="Previous" @click=${() => go(-1)}>
        <span class="fas fa-chevron-left" aria-hidden="true"></span>
      </button>
      <span class="carousel-dots" aria-hidden="true">
        ${items.map((_, i) => html`<span class="dot ${i === at ? 'on' : ''}"></span>`)}
      </span>
      <span class="sr">${at + 1} of ${items.length}</span>
      <button class="icon-btn" title="Next" aria-label="Next" @click=${() => go(1)}>
        <span class="fas fa-chevron-right" aria-hidden="true"></span>
      </button>
    </div>
  </div>`;
}

export function separator(ui, p) {
  return p.label
    ? html`<div class="sep-label" role="separator"><span>${str(p.label)}</span></div>`
    : html`<hr />`;
}

export function header(ui, p, path) {
  const actions = list(p.actions);
  return html`<div class="header">
    ${iconName(p.icon) ? html`<span class="header-icon">${icon(p.icon)}</span>` : nothing}
    <div class="header-text">
      ${p.eyebrow ? html`<div class="eyebrow">${str(p.eyebrow)}</div>` : nothing}
      <div class="header-title">${str(p.title)}</div>
      ${p.description ? html`<div class="header-desc">${str(p.description)}</div>` : nothing}
    </div>
    ${actions.length
      ? html`<div class="header-actions">
          ${actions.map((a, i) => ui._slot(a, `${path}.a${i}`))}
        </div>`
      : nothing}
  </div>`;
}

// — Content —

export function iconNode(ui, p) {
  const n = iconName(p.name);
  if (!n) return nothing;
  return html`<span class="icon ${colorClass(p.color)} ${sizeClass(p.size)}"
    ><span class="fas fa-fw fa-${n}" aria-hidden="true"></span
  ></span>`;
}

const STATUS = { online: 'Online', away: 'Away', busy: 'Busy', offline: 'Offline' };

export function avatar(ui, p) {
  const name = str(p.name);
  const status = oneOf(p.status, Object.keys(STATUS), '');
  return html`<span
    class="avatar ${colorClass(p.color, 'neutral')} ${sizeClass(p.size)}"
    title=${status ? `${name} · ${STATUS[status]}` : name}
    role="img"
    aria-label=${status ? `${name}, ${STATUS[status]}` : name}
  >
    ${iconName(p.icon) ? icon(p.icon) : html`<span aria-hidden="true">${initials(name)}</span>`}
    ${status ? html`<span class="status ${status}"></span>` : nothing}
  </span>`;
}

export function avatarGroup(ui, p) {
  const all = list(p.avatars).filter(isEl);
  if (!all.length) return nothing;
  const max = Math.max(1, Math.round(Number(p.max)) || 5);
  const shown = all.slice(0, max);
  const rest = all.slice(max);
  return html`<span class="avatar-group">
    ${shown.map((a) => avatar(ui, a.props || {}))}
    ${rest.length
      ? html`<span
          class="avatar neutral ${sizeClass(shown[0].props?.size)}"
          title=${rest.map((a) => str(a.props?.name)).join(', ')}
          >+${rest.length}</span
        >`
      : nothing}
  </span>`;
}

export function user(ui, p, path) {
  const link = linkOf(p.url);
  const name = str(p.name);
  return html`<div class="user">
    ${isEl(p.avatar) ? ui._slot(p.avatar, `${path}.av`) : avatar(ui, { name })}
    <div class="user-text">
      ${link
        ? html`<button class="user-name inline-link" title=${link.href} @click=${open(ui, link)}>
            ${name}
          </button>`
        : html`<div class="user-name">${name}</div>`}
      ${p.description ? html`<div class="user-desc">${str(p.description)}</div>` : nothing}
    </div>
    ${p.trailing != null
      ? html`<div class="trailing">${ui._slot(p.trailing, `${path}.tr`)}</div>`
      : nothing}
  </div>`;
}

export function kbd(ui, p) {
  const keys = list(p.keys).map(str).filter(Boolean);
  if (!keys.length) return nothing;
  return html`<span class="kbds"
    >${keys.map((k, i) => html`${i ? html`<span class="plus">+</span>` : nothing}<kbd>${k}</kbd>`)}</span
  >`;
}

export function link(ui, p) {
  const to = linkOf(p.url);
  const label = str(p.label) || to?.label || str(p.url);
  // A url we won't open still shows its label, as plain text.
  if (!to) return html`<span class="slot-text">${label}</span>`;
  return html`<button class="inline-link" title=${to.href} @click=${open(ui, to)}>
    ${icon(p.icon)} ${label}
  </button>`;
}

export function breadcrumb(ui, p) {
  const items = list(p.items).map(str).filter(Boolean);
  if (!items.length) return nothing;
  return html`<nav class="breadcrumb" aria-label="Path">
    ${items.map(
      (t, i) =>
        html`${i
            ? html`<span class="fas fa-chevron-right crumb-sep" aria-hidden="true"></span>`
            : nothing}<span
            class="crumb ${i === items.length - 1 ? 'current' : ''}"
            aria-current=${i === items.length - 1 ? 'page' : nothing}
            >${t}</span
          >`
    )}
  </nav>`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  // A sandboxed page (an Asset's preview) has no clipboard API.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function codeBlock(ui, p, path) {
  const code = str(p.code);
  const key = `code:${path}`;
  const copied = ui._state(key, false);
  const onCopy = async () => {
    if (!(await copyText(code))) return;
    ui._setState(key, true);
    setTimeout(() => ui._setState(key, false), 1500);
  };
  return html`<div class="code">
    <div class="code-head">
      <span class="code-title">${str(p.title) || str(p.language) || 'Code'}</span>
      <button
        class="icon-btn"
        title=${copied ? 'Copied' : 'Copy'}
        aria-label=${copied ? 'Copied' : 'Copy the code'}
        @click=${onCopy}
      >
        <span class="fas ${copied ? 'fa-check' : 'fa-copy'}" aria-hidden="true"></span>
      </button>
    </div>
    <pre><code>${code}</code></pre>
  </div>`;
}

export function empty(ui, p) {
  const actions = list(p.actions).filter(isEl);
  return html`<div class="empty">
    ${iconName(p.icon) ? html`<span class="empty-icon">${icon(p.icon)}</span>` : nothing}
    <div class="empty-title">${str(p.title)}</div>
    ${p.description ? html`<div class="empty-desc">${str(p.description)}</div>` : nothing}
    ${actions.length
      ? html`<div class="buttons">${actions.map((b) => ui._button(b.props || {}))}</div>`
      : nothing}
  </div>`;
}

export function feature(ui, p) {
  const to = linkOf(p.url);
  const body = html`
    ${iconName(p.icon)
      ? html`<span class="feature-icon ${colorClass(p.color, 'primary')}">${icon(p.icon)}</span>`
      : nothing}
    <span class="feature-text">
      <span class="feature-title">${str(p.title)}</span>
      ${p.description ? html`<span class="feature-desc">${str(p.description)}</span>` : nothing}
    </span>
  `;
  return to
    ? html`<button class="feature clickable" title=${to.href} @click=${open(ui, to)}>
        ${body}
      </button>`
    : html`<div class="feature">${body}</div>`;
}

// — Lists —

export function listNode(ui, p, path) {
  const items = list(p.items).filter(isEl);
  if (!items.length) return nothing;
  const variant = oneOf(p.variant, ['plain', 'divided', 'cards'], 'divided');
  return html`<ul class="list ${variant}">
    ${items.map((it, i) => {
      const t = it.props || {};
      const to = linkOf(t.url);
      const text = html`
        <span class="li-title">${str(t.title)}</span>
        ${t.description ? html`<span class="li-desc">${str(t.description)}</span>` : nothing}
      `;
      return html`<li class="li">
        ${t.leading != null
          ? html`<span class="leading">${ui._slot(t.leading, `${path}.${i}.l`)}</span>`
          : nothing}
        ${to
          ? html`<button class="li-main link" title=${to.href} @click=${open(ui, to)}>
              ${text}
            </button>`
          : html`<span class="li-main">${text}</span>`}
        ${t.trailing != null
          ? html`<span class="trailing">${ui._slot(t.trailing, `${path}.${i}.t`)}</span>`
          : nothing}
      </li>`;
    })}
  </ul>`;
}

export function dataList(ui, p) {
  const items = list(p.items).filter(isEl);
  if (!items.length) return nothing;
  const cols = p.layout === 'columns';
  return html`<dl class="${cols ? 'data-cols' : 'fields'}">
    ${items.map((f) =>
      cols
        ? html`<div>
            <dt>${str(f.props?.label)}</dt>
            <dd>${str(f.props?.value)}</dd>
          </div>`
        : html`<dt>${str(f.props?.label)}</dt>
            <dd>${str(f.props?.value)}</dd>`
    )}
  </dl>`;
}

export function steps(ui, p) {
  const items = list(p.items).filter(isEl);
  const current = Number.isFinite(Number(p.current)) && p.current != null ? Number(p.current) : 0;
  return html`<ol class="steps ${current ? 'tracked' : ''}">
    ${items.map((s, i) => {
      const n = i + 1;
      const state = !current ? '' : n < current ? 'done' : n === current ? 'current' : 'todo';
      const mark =
        state === 'done'
          ? html`<span class="fas fa-check" aria-hidden="true"></span>`
          : iconName(s.props?.icon)
            ? icon(s.props.icon)
            : n;
      return html`<li class=${state} aria-current=${state === 'current' ? 'step' : nothing}>
        <span class="n">${mark}</span>
        <div>
          <div class="title">${str(s.props?.title)}</div>
          ${s.props?.details ? html`<div class="details">${str(s.props.details)}</div>` : nothing}
        </div>
      </li>`;
    })}
  </ol>`;
}

function treeItems(ui, items, path, depth) {
  // A model can nest without end; a tree that deep is no use to read.
  if (depth > 8) return nothing;
  return html`<ul class="tree" role=${depth ? 'group' : 'tree'}>
    ${list(items)
      .filter(isEl)
      .map((it, i) => {
        const t = it.props || {};
        const kids = list(t.children).filter(isEl);
        const key = `tree:${path}.${i}`;
        const on = kids.length ? ui._state(key, t.open === true) : false;
        const glyph = iconName(t.icon) || (kids.length ? (on ? 'folder-open' : 'folder') : '');
        const label = html`${glyph ? icon(glyph, 'tree-icon') : nothing}<span>${str(t.label)}</span>`;
        return html`<li role="treeitem" aria-expanded=${kids.length ? (on ? 'true' : 'false') : nothing}>
          ${kids.length
            ? html`<button class="tree-row" @click=${() => ui._setState(key, !on)}>
                <span class="fas fa-chevron-right chev ${on ? 'open' : ''}" aria-hidden="true"></span>
                ${label}
              </button>`
            : html`<span class="tree-row leaf">${label}</span>`}
          ${on ? treeItems(ui, kids, `${path}.${i}`, depth + 1) : nothing}
        </li>`;
      })}
  </ul>`;
}

export function tree(ui, p, path) {
  return list(p.items).filter(isEl).length ? treeItems(ui, p.items, path, 0) : nothing;
}

// — Numbers —

export function sparkline(ui, p) {
  const variant = oneOf(p.variant, ['line', 'area', 'bar'], 'line');
  const g = sparkGeometry(p.values);
  if (!g.points.length) return nothing;
  const nums = list(p.values).map(Number).filter(Number.isFinite);
  return html`<span
    class="spark ${colorClass(p.color)}"
    role="img"
    aria-label=${`Trend: ${nums[0]} to ${nums[nums.length - 1]}`}
  >
    <svg viewBox="0 0 100 28" preserveAspectRatio="none">
      ${variant === 'bar'
        ? g.bars.map((b) => svg`<rect class="spark-bar" x=${b.x} y=${b.y} width=${b.w} height=${b.h} rx="1" />`)
        : svg`${variant === 'area' && g.area ? svg`<path class="spark-area" d=${g.area} />` : nothing}
            <path class="spark-line" d=${g.line} vector-effect="non-scaling-stroke" />`}
    </svg>
  </span>`;
}

export function progressRing(ui, p, pct, text) {
  const r = 26;
  return html`<div
    class="ring ${colorClass(p.color)}"
    role="progressbar"
    aria-label=${str(p.label)}
    aria-valuenow=${Number(p.value) || 0}
    aria-valuemax=${Number(p.max) > 0 ? Number(p.max) : 100}
  >
    <svg viewBox="0 0 64 64" width="64" height="64">
      <circle class="ring-track" cx="32" cy="32" r=${r} />
      <circle
        class="ring-fill"
        cx="32"
        cy="32"
        r=${r}
        stroke-dasharray=${ringDash(pct, r)}
        transform="rotate(-90 32 32)"
      />
      <text class="ring-text" x="32" y="36" text-anchor="middle">${text}</text>
    </svg>
    <div class="ring-text-side">
      <div class="ring-label">${str(p.label)}</div>
      ${p.caption ? html`<div class="ring-caption">${str(p.caption)}</div>` : nothing}
    </div>
  </div>`;
}

// The day a week starts on where the user is (0 Sunday … 6 Saturday).
function firstDayOfWeek() {
  try {
    const loc = new Intl.Locale(navigator.language);
    const info = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo;
    if (info && Number.isFinite(info.firstDay)) return info.firstDay % 7;
  } catch {}
  return 0;
}

const pad2 = (n) => String(n).padStart(2, '0');

export function calendar(ui, p) {
  const now = new Date();
  const m = parseMonth(p.month) || { year: now.getFullYear(), month: now.getMonth() };
  const first = firstDayOfWeek();
  const weeks = monthGrid(m.year, m.month, first);
  const prefix = `${m.year}-${pad2(m.month + 1)}-`;
  const marks = new Map();
  for (const mk of list(p.marks).filter(isEl)) {
    const date = str(mk.props?.date).slice(0, 10);
    if (!date.startsWith(prefix)) continue;
    const day = Number(date.slice(8));
    if (!marks.has(day)) marks.set(day, []);
    marks.get(day).push({ label: str(mk.props?.label), color: colorClass(mk.props?.color, 'primary') });
  }
  const today =
    now.getFullYear() === m.year && now.getMonth() === m.month ? now.getDate() : 0;
  const title = new Date(m.year, m.month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  // 2023-01-01 was a Sunday.
  const dayName = (i) =>
    new Date(2023, 0, 1 + ((first + i) % 7)).toLocaleDateString(undefined, { weekday: 'narrow' });
  const labelled = [...marks].sort((a, b) => a[0] - b[0]).filter(([, ms]) => ms.some((x) => x.label));
  return html`<div class="calendar">
    <div class="cal-title">${title}</div>
    <table class="cal-grid" role="grid" aria-label=${title}>
      <thead>
        <tr>
          ${[0, 1, 2, 3, 4, 5, 6].map((i) => html`<th scope="col">${dayName(i)}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${weeks.map(
          (w) =>
            html`<tr>
              ${w.map((d) => {
                if (!d) return html`<td></td>`;
                const ms = marks.get(d);
                const tip = ms?.map((x) => x.label).filter(Boolean).join(', ') || '';
                return html`<td>
                  <span
                    class="cal-day ${d === today ? 'today' : ''} ${ms ? `marked ${ms[0].color}` : ''}"
                    title=${tip || nothing}
                    >${d}</span
                  >
                </td>`;
              })}
            </tr>`
        )}
      </tbody>
    </table>
    ${labelled.length
      ? html`<ul class="cal-marks">
          ${labelled.map(([d, ms]) =>
            ms
              .filter((x) => x.label)
              .map(
                (x) =>
                  html`<li>
                    <span class="cal-dot ${x.color}"></span>
                    <span class="cal-date">${d}</span>
                    <span>${x.label}</span>
                  </li>`
              )
          )}
        </ul>`
      : nothing}
  </div>`;
}
