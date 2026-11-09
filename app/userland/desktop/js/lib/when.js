// Times on the home page, in words. Job times and "changed at" times are real times (ISO); the
// calendar's are wall times, which shared/home-dashboard.mjs already turned into day labels.

import { formatTime } from 'nomad://app-stdlib/js/time-of-day.js';

const pad = (n) => String(n).padStart(2, '0');
const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// This computer's wall time, 'YYYY-MM-DDTHH:MM' (shared/calendar.mjs localWallTime).
export function wallNow(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "Monday, 9 November"
export function longDate(d = new Date()) {
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const clock = (d) => formatTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);

// "just now", "5 min ago", "2 h ago", "Yesterday", "3 days ago", "12 Nov".
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(new Date(t))) / DAY_MS);
  if (days < 1) return `${Math.floor(s / 3600)} h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// "now", "in 5 min", "in 2 h", "Tomorrow, 8:00 AM", "Wed, 8:00 AM", "12 Nov".
export function until(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const s = (t - now) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `in ${Math.ceil(s / 60)} min`;
  const d = new Date(t);
  const days = Math.round((startOfDay(d) - startOfDay(new Date(now))) / DAY_MS);
  if (days < 1) return s < 6 * 3600 ? `in ${Math.round(s / 3600)} h` : `Today, ${clock(d)}`;
  if (days === 1) return `Tomorrow, ${clock(d)}`;
  if (days < 7) return `${DAYS[d.getDay()]}, ${clock(d)}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
