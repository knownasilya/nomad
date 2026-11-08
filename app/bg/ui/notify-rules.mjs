// Desktop notifications: the rules, with no Electron in them (tests: tests/unit/notify-rules.test.js).
// The I/O is bg/ui/desktop-notifications.js.
//
// Three kinds:
// - A Job's run that has a notification (shared/jobs.mjs `finalNotification`), on whichever of the
//   user's Devices ran it: every computer shows it, as the phone does.
// - A notice from another member's Job in a shared Space (shared/space-library.mjs notices).
// - A permission prompt that waits while nobody sees it: Nomad isn't the app in front, or the prompt
//   is on a tab that isn't the active one (the AI asking on a page, a watched Job's tab).

import { pendingNotifications } from '../../../shared/jobs.mjs';
import { pendingNotices } from '../../../shared/space-library.mjs';

// The settings, each on by default (bg/dbs/settings.js). `inbox_notify` (Messages) is bg/hyper/inbox.js's.
export const SETTINGS = {
  jobs: 'notify_jobs',
  spaces: 'notify_space_notices',
  prompts: 'notify_prompts',
};
// Where this computer keeps what it already showed: a run's finishedAt, and a notice id per Space
// Library. Both are the sender's clock, never this computer's.
export const JOB_SINCE = 'job_notify_since';
export const SPACE_SINCE = 'space_notice_since';

// More than this at once (a laptop that slept, a Vault that just synced) become one notification.
export const MAX_AT_ONCE = 4;
const MAX_TITLE = 80;
const MAX_BODY = 200;

const clip = (s, n) => {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};

// The Job notifications to show, and the mark to keep. `since` is the newest finishedAt this computer
// handled ('' or null: it never looked, so nothing older shows). A run someone watched in the AI
// Sidebar (`chat`) doesn't notify while a Nomad window is in front: they saw it end.
export function jobAlerts(runs, since, { appFocused = false, max = MAX_AT_ONCE } = {}) {
  const { notify, since: next } = pendingNotifications(runs, since || null);
  const fresh = notify.filter((r) => !(appFocused && r.chat));
  let alerts;
  if (fresh.length > max) {
    alerts = [
      {
        title: `${fresh.length} Job results`,
        body: clip(fresh.map((r) => r.notification.title).join(', '), MAX_BODY),
        jobId: null,
      },
    ];
  } else {
    alerts = fresh.map((r) => ({
      title: clip(r.notification.title, MAX_TITLE) || 'Job',
      body: clip(r.notification.body, MAX_BODY),
      jobId: r.jobId,
    }));
  }
  return { alerts, since: next || null };
}

// A shared Space's notices to show, and the mark to keep for its Library. Only other members' notices:
// this person's own Job already notified them as a run.
export function spaceAlerts(
  notices,
  since,
  { spaceName = '', memberId = null, max = MAX_AT_ONCE } = {}
) {
  const { notify, since: next } = pendingNotices(notices, since || null, memberId);
  const name = clip(spaceName, 40) || 'Shared Space';
  let alerts;
  if (notify.length > max) {
    alerts = [
      {
        title: `${notify.length} notifications from ${name}`,
        body: clip(
          notify
            .map((n) => n.title)
            .filter(Boolean)
            .join(', '),
          MAX_BODY
        ),
      },
    ];
  } else {
    alerts = notify.map((n) => ({
      title: clip(n.title ? `${name} · ${n.title}` : name, MAX_TITLE),
      body: clip([n.body, n.from && `from ${n.from}`].filter(Boolean).join(' · '), MAX_BODY),
    }));
  }
  return { alerts, since: next };
}

// Whether a prompt needs the OS to say so: nobody sees it when the window isn't in front (another
// app is, or it's minimized or hidden) or its tab isn't the one showing.
export function promptNeedsAlert({
  winFocused,
  winVisible = true,
  winMinimized = false,
  tabActive,
}) {
  return !winFocused || !winVisible || !!winMinimized || !tabActive;
}

// A `html` tag for lib/permissions.ts renderPermDesc that makes plain text, for a prompt's
// notification: the OS shows text only. Handlers (`@click=${fn}`) drop out.
export function textTag(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += plain(values[i]);
  });
  return out;
}

function plain(v) {
  if (v == null || v === false || typeof v === 'function') return '';
  if (Array.isArray(v)) return v.map(plain).join(' ');
  return String(v);
}

// What a permission prompt asks, as one line of text: tags out, entities decoded, cut short.
export function promptText(desc) {
  const text = String(desc ?? '')
    .replace(/<li[^>]*>/gi, ' · ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/: ·/g, ':')
    .replace(/ ([.,;:!?)])/g, '$1')
    .trim();
  return clip(text, MAX_BODY);
}

// The site a prompt is for, as the user knows it: the host, or the nomad:// page.
export function siteOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'nomad:') return `nomad://${u.hostname}`;
    if (u.hostname === 'private' && u.protocol === 'hyper:') return 'your private drive';
    if (u.protocol === 'hyper:' && /^[0-9a-f]{64}$/i.test(u.hostname))
      return `hyper://${u.hostname.slice(0, 6)}…`;
    return u.hostname || u.protocol.replace(/:$/, '');
  } catch {
    return '';
  }
}

// The notification for a prompt that waits. `ai`: the AI asks (a promptTrusted permission), not the page.
export function promptAlert({ url, desc, ai = false }) {
  const site = siteOf(url);
  const what = promptText(desc) || 'It needs your answer.';
  if (ai) {
    return {
      title: 'The AI is waiting for your answer',
      body: clip(site ? `${what} (${site})` : what, MAX_BODY),
    };
  }
  return {
    title: clip(
      site ? `${site} is asking for permission` : 'A site is asking for permission',
      MAX_TITLE
    ),
    body: what,
  };
}

// The Space Library marks ({ [library]: noticeId }), read from the setting's JSON.
export function parseMarks(raw) {
  if (!raw) return {};
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
