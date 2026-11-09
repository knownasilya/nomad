// Longer answers for the AI's prompts on the phone (ADR-0013 §6, ADR-0019). On desktop, Allow on a
// prompt whose permission keeps a yes (`persist: 'allow'` in lib/permissions.ts: Notes, Reader,
// Mods, Jobs, memory, the calendar, contacts, drive edits) is kept for the tab's site in sitedata,
// and site-info lists it. A phone turn's prompts went over the Bridge with no sitedata at all, so
// the phone asked on every turn. This wraps the Bridge's relay so a phone turn reads and keeps the
// same records: a kept yes (or a Deny set in site-info) answers without asking, and the prompt
// offers "Don't ask again" (the `similar` box, as desktop's prompt has for page clicks and the
// 3-month send grant), which keeps the yes the way desktop's Allow does.

/**
 * The site a kept answer is for: the origin of the turn's sender (the phone's tab, or the page's
 * drive), or null when there is none to keep it for.
 * @param {string} url
 * @returns {string|null}
 */
export function keepSite(url) {
  let u;
  try {
    u = new URL(String(url || ''));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:' && u.protocol !== 'hyper:') return null;
  // makeRemoteSender's stand-in when the phone sent no tab.
  if (!u.host || (u.protocol === 'hyper:' && u.host === 'unknown')) return null;
  return `${u.protocol}//${u.host}`;
}

/**
 * The site as the prompt names it: the host of a web site, the tab's title for a drive (its key
 * says nothing to a person), else the key cut short.
 * @param {string} site an origin from keepSite
 * @param {string} [title]
 */
export function siteLabel(site, title) {
  const u = new URL(site);
  if (u.protocol !== 'hyper:') return u.host;
  const t = String(title || '').trim();
  if (t && t !== 'Loading…') return t.length > 60 ? t.slice(0, 59) + '…' : t;
  return /^[0-9a-f]{64}$/i.test(u.host) ? `hyper://${u.host.slice(0, 6)}…` : `hyper://${u.host}`;
}

/** The box's label on the phone. The record is on the computer, so it says where to change it. */
export function keepLabel(label) {
  return `Don't ask again on ${label} (change it in site info on your computer)`;
}

/**
 * `relay(permission, sender, opts)` with kept answers. A permission that `persists` checks `get`
 * first: 1 allows and 0 denies without asking (as desktop's permission engine does). Else it asks
 * with `similar` set to the box's label, and a yes with the box ticked ('similar') is kept with
 * `set` and answers true. Any other permission, or a turn with no site, goes to `relay` as it is.
 * @param {(permission: string, sender: any, opts?: object) => Promise<any>} relay
 * @param {{ site: string|null, label?: string, persists: (permission: string) => boolean,
 *   get: (site: string, permission: string) => Promise<any>,
 *   set: (site: string, permission: string) => Promise<any> }} store
 */
export function keepingPermit(relay, { site, label, persists, get, set }) {
  return async (permission, sender, opts) => {
    if (!site || !persists(permission)) return relay(permission, sender, opts);
    const kept = await Promise.resolve(get(site, permission)).catch(() => undefined);
    if (kept === 1 || kept === true) return true;
    if (kept === 0 || kept === false) return false;
    const answer = await relay(permission, sender, {
      ...opts,
      similar: keepLabel(label || site),
    });
    if (answer === 'similar') {
      await Promise.resolve(set(site, permission)).catch(() => {});
      return true;
    }
    return !!answer;
  };
}
