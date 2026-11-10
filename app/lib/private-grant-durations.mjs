// How long a page may keep a path of the user's private drive (ADR-0022 amendment). The prompt
// (fg/perm-prompt) offers these in a select, and the guard (bg/web-apis/bg/private-drive-guard.ts)
// takes only one of them back, so a page can never ask for a length of its own. Pure: the prompt and
// the guard both import it, and tests/unit/private-drive-guard.test.js covers it.

export const PRIVATE_GRANT_DURATIONS = [
  { minutes: 60, label: '1 hour' },
  { minutes: 24 * 60, label: '1 day' },
  { minutes: 7 * 24 * 60, label: '1 week' },
  { minutes: 30 * 24 * 60, label: '1 month' },
  { minutes: 90 * 24 * 60, label: '3 months' },
];

export const DEFAULT_PRIVATE_GRANT_MINUTES = PRIVATE_GRANT_DURATIONS[0].minutes;

/** The offered lengths in minutes, shortest first. */
export const PRIVATE_GRANT_MINUTES = PRIVATE_GRANT_DURATIONS.map(
  (d) => d.minutes,
);

/** '1 week' for 10080; '90 minutes' for a length that isn't one of the choices. */
export function durationLabel(minutes) {
  const d = PRIVATE_GRANT_DURATIONS.find((x) => x.minutes === minutes);
  if (d) return d.label;
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = m / 60;
  return Number.isInteger(hours) && hours >= 1
    ? `${hours} hour${hours > 1 ? 's' : ''}`
    : `${m} minutes`;
}

/**
 * The minutes a prompt's answer grants, or 0 for a no. A plain yes (true, from an older prompt or a
 * trusted path) is the default length. A number is taken only when it is one of `offered`.
 */
export function grantedMinutes(
  answer,
  offered = PRIVATE_GRANT_MINUTES,
  fallback = DEFAULT_PRIVATE_GRANT_MINUTES,
) {
  if (!answer) return 0;
  if (typeof answer === 'number' && offered.includes(answer)) return answer;
  return fallback;
}
