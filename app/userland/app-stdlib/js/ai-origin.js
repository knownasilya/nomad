// "Made in the AI chat …" on an item the user's AI made or changed (ADR-0047): a Note, an Asset, a
// drive. bg works out what each line says (nomad.aiChats.origins / driveOrigins, from the rules in
// shared/ai-origin.mjs); this draws them and opens the chat in the window's AI Sidebar, or the Job
// in My Library. A chat that was deleted, or one that was never kept (the phone's AI panel), shows
// as plain "Made with AI" with no link.
//
// Plain DOM with no imports, so nomad://notes and nomad://assets (bundled) and site-info (Lit,
// unbundled) all use it. Colors are app-stdlib's tokens, so it follows light and dark.

const CSS = `
.ai-origins { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--text-color--light, #666); }
.ai-origins .ai-origin { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ai-origins .ai-origin > .fas { flex: none; width: 14px; text-align: center; opacity: .8; }
.ai-origins button.ai-origin-open {
  all: unset; cursor: pointer; color: var(--text-color--link, #2864dc); min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-radius: 3px;
}
.ai-origins button.ai-origin-open:hover { text-decoration: underline; }
.ai-origins button.ai-origin-open:focus-visible { outline: 2px solid var(--text-color--link, #2864dc); outline-offset: 1px; }
.ai-origins .ai-origin-gone { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: help; }
.ai-origins .ai-origin-when { flex: none; color: var(--text-color--very-light, #999); }
details.ai-origins-fold { font-size: 12px; color: var(--text-color--very-light, #999); }
details.ai-origins-fold > summary {
  display: inline-flex; align-items: center; gap: 6px; list-style: none; cursor: pointer;
  border-radius: 3px; user-select: none;
}
details.ai-origins-fold > summary::-webkit-details-marker { display: none; }
details.ai-origins-fold > summary:hover { color: var(--text-color--light, #666); }
details.ai-origins-fold > summary:focus-visible { outline: 2px solid var(--text-color--link, #2864dc); outline-offset: 1px; }
details.ai-origins-fold > summary .fas { width: 14px; text-align: center; }
details.ai-origins-fold > summary .chev { font-size: 9px; transition: transform .12s; }
details.ai-origins-fold[open] > summary .chev { transform: rotate(90deg); }
details.ai-origins-fold > .ai-origins { margin: 4px 0 0 20px; }
`;

let foldOpen = false; // a folded list stays open across redraws once the user opened it

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null && c !== false) node.append(c);
  return node;
}

const icon = (name) => el('span', { class: `fas fa-${name}`, 'aria-hidden': 'true' });

function when(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function openUrl(url) {
  if (window.nomad?.browser?.openUrl) nomad.browser.openUrl(url, { setActive: true });
  else window.open(url);
}

// Opens what a line links to: the chat in this window's AI Sidebar, or the Job.
export async function openAiOrigin(o) {
  if (o.kind === 'chat') return nomad.aiChats.open(o.id, o.space ? { space: o.space } : {});
  if (o.kind === 'job') return openUrl(`nomad://library/jobs?id=${encodeURIComponent(o.id)}`);
}

/**
 * The lines for an item's resolved origins, or null when there are none.
 * @param {Array<{ kind: string, text: string, tip: string, at?: string }>} origins
 * @param {{ onError?: (err: Error) => void }} [opts]
 */
export function aiOriginsElement(origins, { onError = (err) => console.warn(err), collapsed = false } = {}) {
  if (!Array.isArray(origins) || !origins.length) return null;
  const list = linesElement(origins, onError, !collapsed);
  if (!collapsed) return list;
  // Folded: one quiet line, "Made with AI", that opens the list.
  const label = `${origins.some((o) => o.made) ? 'Made with AI' : 'Changed with AI'}${origins.length > 1 ? ` · ${origins.length} chats` : ''}`;
  const fold = el('details', { class: 'ai-origins-fold', open: foldOpen }, [
    el('style', {}, [CSS]),
    el('summary', { title: 'Show the AI chats that made or changed this' }, [icon('robot'), label, el('span', { class: 'fas fa-chevron-right chev', 'aria-hidden': 'true' })]),
    list,
  ]);
  fold.addEventListener('toggle', () => (foldOpen = fold.open));
  return fold;
}

function linesElement(origins, onError, withStyle) {
  return el('div', { class: 'ai-origins', role: 'list', 'aria-label': 'AI chats that made or changed this' }, [
    withStyle ? el('style', {}, [CSS]) : null,
    ...origins.map((o) => {
      const linked = o.kind === 'chat' || o.kind === 'job';
      const at = when(o.at);
      return el('div', { class: 'ai-origin', role: 'listitem' }, [
        icon(o.kind === 'job' ? 'clock' : 'robot'),
        linked
          ? el(
              'button',
              {
                type: 'button',
                class: 'ai-origin-open',
                title: o.tip,
                'aria-label': `${o.text}. ${o.tip}`,
                onclick: () => Promise.resolve(openAiOrigin(o)).catch(onError),
              },
              [o.text]
            )
          : el('span', { class: 'ai-origin-gone', title: o.tip, tabindex: '0', 'aria-label': `${o.text}. ${o.tip}` }, [o.text]),
        at ? el('span', { class: 'ai-origin-when' }, ['· ' + at]) : null,
      ]);
    }),
  ]);
}

// What bg said for a list, for a short while, so an app that redraws often doesn't flicker.
const cache = new Map(); // JSON of the list -> { at, origins }
const CACHE_MS = 30_000;

// Looks up an item's `ai` list and draws it into `slot` (emptied when there's nothing to show).
// `seq` guards against an older lookup landing after a newer one.
export async function showAiOrigins(slot, list, opts = {}) {
  if (!slot) return;
  const seq = (slot.__aiOriginSeq = (slot.__aiOriginSeq || 0) + 1);
  if (!Array.isArray(list) || !list.length || !window.nomad?.aiChats?.origins) return slot.replaceChildren();
  const key = JSON.stringify(list);
  const hit = cache.get(key);
  let origins = hit && Date.now() - hit.at < CACHE_MS ? hit.origins : null;
  if (!origins) {
    try {
      origins = await nomad.aiChats.origins(list);
      cache.set(key, { at: Date.now(), origins });
    } catch (err) {
      console.warn('[ai-origin]', err);
      origins = [];
    }
  }
  if (slot.__aiOriginSeq !== seq) return;
  const node = aiOriginsElement(origins, opts);
  slot.replaceChildren(...(node ? [node] : []));
}
