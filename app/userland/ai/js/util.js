import { html } from 'nomad://app-stdlib/vendor/lit-element/lit-element.js';

// An error from bg arrives wrapped ("Error invoking remote method …: Error: …").
export function cleanError(err) {
  return String(err?.message || err).replace(/^.*?Error: /, '');
}

// "just now", "5 minutes ago", "yesterday", or the date.
export function timeAgo(ts) {
  const t = typeof ts === 'string' ? Date.parse(ts) : Number(ts);
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} ${m === 1 ? 'minute' : 'minutes'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `text` with every word of the search in <mark>, as Lit parts (so it's never parsed as HTML).
export function highlight(text, words) {
  const str = String(text || '');
  const list = (words || []).filter(Boolean);
  if (!list.length) return str;
  const re = new RegExp(`(${list.map(escapeRe).join('|')})`, 'gi');
  return str.split(re).map((part, i) => (i % 2 ? html`<mark>${part}</mark>` : part));
}
