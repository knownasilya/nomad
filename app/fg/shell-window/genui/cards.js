// Cards for a purpose (ADR-0027): EntityCard, LinkCard, ProductCard, EventCard, QuoteCard,
// ProsCons, Timeline and CardGrid. `ui` is the <nomad-genui> drawing them: its _fire() sends a
// click's steps to the sidebar, and _tag() / _button() / _children() draw what cards share.
// A url opens only on a click, and only an http(s) or hyper:// one, or a link to one of the user's
// things in Nomad (shared/item-links.mjs; the sidebar checks again).

import { html, nothing } from 'lit';
import { parseItemLink } from '../../../../shared/item-links.mjs';

const isEl = (v) => v && typeof v === 'object' && v.type === 'element';
const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v) => (v == null ? '' : typeof v === 'object' ? '' : String(v));
const VARIANTS = ['neutral', 'info', 'success', 'warning', 'danger'];

// { href, label } for a url a card may open, or null. The label is what the card shows: the
// host for the web, a shortened key for a drive, where it is for a Note, a Job or a Mod.
export function linkOf(url) {
  const item = /^nomad:/i.test(str(url).trim()) ? parseItemLink(str(url)) : null;
  if (item) return { href: item.url, label: item.place, hyper: false };
  let u;
  try {
    u = new URL(str(url));
  } catch {
    return null;
  }
  if (u.protocol === 'http:' || u.protocol === 'https:') {
    return { href: u.href, label: u.hostname.replace(/^www\./, ''), hyper: false };
  }
  if (u.protocol === 'hyper:') {
    const host = /^[0-9a-f]{52,64}$/i.test(u.hostname) ? `${u.hostname.slice(0, 6)}…` : u.hostname;
    const path = u.pathname !== '/' ? u.pathname : '';
    return { href: u.href, label: `hyper://${host}${path}`, hyper: true };
  }
  return null;
}

// "2026-11-04" → { month: 'Nov', day: '4', weekday: 'Wed' }; anything else → null.
export function dateParts(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(date));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime()) || d.getDate() !== Number(m[3])) return null;
  return {
    month: d.toLocaleDateString(undefined, { month: 'short' }),
    day: String(d.getDate()),
    weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
    year: d.getFullYear() !== new Date().getFullYear() ? String(d.getFullYear()) : '',
  };
}

function open(ui, link) {
  return (e) => {
    e.stopPropagation();
    ui._fire([{ type: 'open_url', url: link.href }]);
  };
}

function tags(ui, values) {
  const t = list(values).map(str).filter(Boolean);
  if (!t.length) return nothing;
  return html`<div class="tags">${t.map((text) => ui._tag({ text }))}</div>`;
}

function stars(rating) {
  const r = Math.max(0, Math.min(5, Number(rating)));
  if (!Number.isFinite(r)) return nothing;
  const half = Math.round(r * 2) / 2;
  return html`<span class="stars" title=${`${r} out of 5`} aria-label=${`${r} out of 5`}>
    ${[1, 2, 3, 4, 5].map((i) =>
      half >= i
        ? html`<span class="fas fa-star"></span>`
        : half >= i - 0.5
          ? html`<span class="fas fa-star-half-alt"></span>`
          : html`<span class="far fa-star"></span>`
    )}
    <span class="stars-n">${Math.round(r * 10) / 10}</span>
  </span>`;
}

// A card title that opens its url, or plain text when it has none.
function title(ui, text, link) {
  return link
    ? html`<button class="card-title link" title=${link.href} @click=${open(ui, link)}>
        ${str(text)}
      </button>`
    : html`<div class="card-title">${str(text)}</div>`;
}

export function entityCard(ui, p) {
  const link = linkOf(p.url);
  const fields = list(p.fields).filter(isEl);
  return html`<div class="card entity-card">
    <div class="entity-head">
      ${p.icon
        ? html`<span class="entity-icon"><span class="fas fa-fw fa-${str(p.icon)}"></span></span>`
        : nothing}
      <div class="entity-names">
        ${title(ui, p.title, link)}
        ${p.subtitle ? html`<div class="card-subtitle">${str(p.subtitle)}</div>` : nothing}
      </div>
    </div>
    ${fields.length
      ? html`<dl class="fields">
          ${fields.map(
            (f) =>
              html`<dt>${str(f.props?.label)}</dt>
                <dd>${str(f.props?.value)}</dd>`
          )}
        </dl>`
      : nothing}
    ${p.description ? html`<div class="card-text">${str(p.description)}</div>` : nothing}
    ${tags(ui, p.tags)} ${link ? html`<div class="card-source">${link.label}</div>` : nothing}
  </div>`;
}

export function linkCard(ui, p) {
  const link = linkOf(p.url);
  const body = html`
    <div class="card-title">${str(p.title)}</div>
    ${p.description ? html`<div class="card-text">${str(p.description)}</div>` : nothing}
    <div class="card-source">
      <span class="fas fa-fw ${link?.hyper ? 'fa-hdd' : 'fa-globe'}"></span>
      ${str(p.source) || link?.label || str(p.url)}
    </div>
  `;
  // A url we won't open still shows, so the user sees what the model meant.
  if (!link) return html`<div class="card link-card">${body}</div>`;
  return html`<button class="card link-card clickable" title=${link.href} @click=${open(ui, link)}>
    ${body}
  </button>`;
}

export function productCard(ui, p) {
  const action = p.action
    ? html`<div class="buttons">${ui._button({ label: 'Details', action: p.action })}</div>`
    : nothing;
  return html`<div class="card product-card">
    ${p.badge ? html`<span class="badge">${str(p.badge)}</span>` : nothing}
    <div class="card-title">${str(p.title)}</div>
    ${p.price || p.rating != null
      ? html`<div class="product-meta">
          ${p.price ? html`<span class="price">${str(p.price)}</span>` : nothing}
          ${p.rating != null ? stars(p.rating) : nothing}
        </div>`
      : nothing}
    ${p.description ? html`<div class="card-text">${str(p.description)}</div>` : nothing}
    ${tags(ui, p.tags)} ${action}
  </div>`;
}

export function eventCard(ui, p) {
  const link = linkOf(p.url);
  const d = dateParts(p.date);
  return html`<div class="card event-card">
    <div class="date-badge" aria-hidden=${d ? 'true' : 'false'}>
      ${d
        ? html`<span class="m">${d.month}</span><span class="d">${d.day}</span
            ><span class="w">${d.weekday}</span>`
        : html`<span class="raw">${str(p.date)}</span>`}
    </div>
    <div class="event-body">
      ${title(ui, p.title, link)}
      <div class="event-meta">
        ${d ? html`<span class="sr">${str(p.date)}</span>` : nothing}
        ${p.time
          ? html`<span><span class="far fa-fw fa-clock"></span>${str(p.time)}</span>`
          : nothing}
        ${p.location
          ? html`<span><span class="fas fa-fw fa-map-marker-alt"></span>${str(p.location)}</span>`
          : nothing}
        ${d?.year ? html`<span>${d.year}</span>` : nothing}
      </div>
      ${p.details ? html`<div class="card-text">${str(p.details)}</div>` : nothing}
    </div>
  </div>`;
}

export function quoteCard(ui, p) {
  const link = linkOf(p.url);
  const source = str(p.source) || link?.label || '';
  return html`<figure class="card quote-card">
    <blockquote>${str(p.text)}</blockquote>
    ${source
      ? html`<figcaption>
          —
          ${link
            ? html`<button class="inline-link" title=${link.href} @click=${open(ui, link)}>
                ${source}
              </button>`
            : source}
        </figcaption>`
      : nothing}
  </figure>`;
}

export function prosCons(ui, p) {
  const col = (items, good) => html`<div class="pc-col ${good ? 'pros' : 'cons'}">
    <div class="pc-head">${good ? 'Pros' : 'Cons'}</div>
    <ul>
      ${list(items)
        .map(str)
        .filter(Boolean)
        .map(
          (t) => html`<li>
            <span class="fas fa-fw ${good ? 'fa-check' : 'fa-times'}"></span><span>${t}</span>
          </li>`
        )}
    </ul>
  </div>`;
  return html`<div class="card pros-cons">
    ${p.title ? html`<div class="card-title">${str(p.title)}</div>` : nothing}
    <div class="pc-cols">${col(p.pros, true)} ${col(p.cons, false)}</div>
  </div>`;
}

export function timeline(ui, p) {
  const items = list(p.items).filter(isEl);
  if (!items.length) return nothing;
  return html`<ol class="timeline">
    ${items.map((it) => {
      const t = it.props || {};
      const v = VARIANTS.includes(t.variant) ? t.variant : 'neutral';
      return html`<li class=${v}>
        <span class="tl-dot"></span>
        <div class="tl-date">${str(t.date)}</div>
        <div class="tl-title">${str(t.title)}</div>
        ${t.details ? html`<div class="tl-details">${str(t.details)}</div>` : nothing}
      </li>`;
    })}
  </ol>`;
}

export function cardGrid(ui, p, path) {
  return html`<div class="card-grid">${ui._children(p.cards, path)}</div>`;
}
