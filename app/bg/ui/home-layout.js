// The home page's layout and pinned cards (ADR-0048): the Vault reads and writes behind
// nomad://desktop (web-apis/bg/vault.ts), the AI Sidebar's Pin to Home (web-apis/bg/ai-shell.ts)
// and the AI's dashboard capabilities (web-apis/bg/ai-vault.ts). The rules, the record shapes and
// the default layout are shared/home-layout.mjs. A layout and a card are openui-lang programs, so
// each is parsed before it is kept (ai/genui-page.js programError): the page never gets one that
// draws nothing.
//
// `space` is a Space key, or null for a page with none. A Space that isn't shared keeps its home
// page in the user's Vault, so their other Devices have the same one. A shared Space keeps one for
// everyone in it in its Space Library (ADR-0048 amendment): its owners and editors change it, a
// viewer only sees it. `spaceLibrary.records` picks the place. A page hears of a change through
// the Vault's and the Space Library's updates (nomad.vault.watchAppData, watchHome).

import { programError } from '../ai/genui-page.js';
import * as spaceLibrary from '../hyper/space-library';
import * as hl from '../../../shared/home-layout.mjs';

// Where the Space's home page is: { shared, writable, layout, cards }, each of the last two a
// record store (spaceLibrary.records).
async function place(space) {
  const [layout, cards] = await Promise.all([spaceLibrary.records(space, 'home'), spaceLibrary.records(space, 'homeCards')]);
  return { shared: layout.shared, writable: layout.writable && cards.writable, layout, cards };
}

// The store to write to, or an error a viewer of a shared Space understands.
async function writable(space) {
  const p = await place(space);
  if (!p.writable) throw new Error('You can view this Space, but only the people who can edit it change its home page.');
  return p;
}

// Whose home page it is: { shared, writable, members } (members a count, 0 when not shared).
export async function about(space) {
  const p = await place(space);
  const members = p.shared ? (await spaceLibrary.members(space).catch(() => [])).length : 0;
  return { shared: p.shared, writable: p.writable, members };
}

/** @type {Promise<any>} */
let writes = Promise.resolve(); // one write at a time: a move changes two records
const inTurn = (fn) => {
  const run = writes.then(fn, fn);
  writes = run.catch(() => {});
  return run;
};

function check(source) {
  const err = programError(source);
  // programError speaks of saveAsset's argument; here the program is a card or the layout.
  if (err) throw new Error(err.replace(/`openui`/g, 'The program'));
}

export async function cards(space, p = null) {
  return hl.sortCards(await ((p || (await place(space))).cards.list()));
}

async function layoutRecord(space, p = null) {
  const rec = await (p || (await place(space))).layout.get(hl.LAYOUT_FILE).catch(() => null);
  return hl.isLayout(rec) ? rec : null;
}

// Whether a stored program still draws. A layout or card was checked when it was kept, but the
// library can change under it (a later version of Nomad, or an older one on this Device).
const drawn = new Map(); // source -> boolean, the newest 64
function draws(source) {
  if (drawn.has(source)) return drawn.get(source);
  const ok = !programError(source);
  if (drawn.size >= 64) drawn.delete(drawn.keys().next().value);
  drawn.set(source, ok);
  return ok;
}

// What the page draws: { layout: { source, custom, canRestore, broken? }, cards: [record],
// shared, canChange }. A layout that no longer draws gives way to the default (`broken`), so the
// page is never blank; a card that doesn't is marked `broken` and the page says so in its place.
export async function get(space) {
  const p = await place(space);
  const [rec, list] = await Promise.all([layoutRecord(space, p), cards(space, p)]);
  const layout = hl.layoutView(rec);
  if (layout.custom && !draws(layout.source)) {
    layout.source = hl.DEFAULT_LAYOUT;
    layout.broken = true;
  }
  return {
    layout,
    cards: list.map((c) => (draws(c.source) ? c : { ...c, broken: true })),
    shared: p.shared,
    canChange: p.writable,
  };
}

// What the AI reads (getDashboard). `name` is the Space's name.
export async function forModel(space, name = '') {
  const p = await place(space);
  const [rec, list, who] = await Promise.all([layoutRecord(space, p), cards(space, p), about(space)]);
  return hl.homeForModel(rec, list, { ...who, name });
}

// Pin a new card, or change one (`id`): { id?, title?, source?, wide? }. `origin` is the chat it
// came from (shared/ai-origin.mjs). Returns the record.
export function pinCard(space, fields = {}, origin = null) {
  return inTurn(async () => {
    const p = await writable(space);
    const list = await cards(space, p);
    const id = fields.id ? String(fields.id) : '';
    const prev = id ? list.find((c) => c.id === id) : null;
    if (id && !prev) throw new Error('No card with that id. Use getDashboard to find it.');
    if (!prev && list.length >= hl.MAX_CARDS) {
      throw new Error(`The home page holds ${hl.MAX_CARDS} cards. Remove one first.`);
    }
    const source = fields.source ?? prev?.source;
    check(hl.cleanSource(source, hl.MAX_CARD_SOURCE, 'The card'));
    let rec = hl.makeCard(
      {
        id: prev ? prev.id : hl.newCardId(),
        title: fields.title,
        source,
        wide: typeof fields.wide === 'boolean' ? fields.wide : undefined,
      },
      prev
    );
    // A card the user turned narrow again drops the flag (makeCard keeps only `true`).
    if (fields.wide === false) delete rec.wide;
    rec = hl.withOrigin(rec, origin, { made: !prev });
    await p.cards.put(hl.cardFile(rec.id), rec);
    return rec;
  });
}

// A Job's own card (shared/jobs.mjs `home` grant): its run makes it, or replaces its program, in
// the Job's Space. { source, title?, wide? }; `wide` counts only on a new card, so the user's
// choice stays. `origin` is the run (shared/ai-origin.mjs). Returns the record.
export function setJobCard(space, job, fields = {}, origin = null) {
  return inTurn(async () => {
    const p = await writable(space);
    const list = await cards(space, p);
    const prev = hl.jobCardOf(list, job?.id);
    if (!prev && list.length >= hl.MAX_CARDS) {
      throw new Error(`The home page holds ${hl.MAX_CARDS} cards, so there is no room for this Job's card.`);
    }
    const source = hl.cleanSource(fields.source, hl.MAX_CARD_SOURCE, 'The card');
    check(source);
    let rec = hl.makeJobCard(job, { id: hl.newCardId(), title: fields.title, source, wide: fields.wide }, prev);
    rec = hl.withOrigin(rec, origin, { made: !prev });
    await p.cards.put(hl.cardFile(rec.id), rec);
    return rec;
  });
}

// Take a Job's card off the page: when the Job is deleted, loses its `home` grant, or its run asks.
// The removed record, or null when it had none.
export function removeJobCard(space, jobId) {
  return inTurn(async () => {
    const p = await place(space);
    const card = hl.jobCardOf(await cards(space, p), jobId);
    if (card) {
      if (!p.writable) throw new Error('You can view this Space, but only the people who can edit it change its home page.');
      await p.cards.del(hl.cardFile(card.id));
    }
    return card;
  });
}

// One place earlier (-1) or later (1) on the page.
export function moveCard(space, id, dir) {
  return inTurn(async () => {
    const p = await writable(space);
    const changed = hl.moveCard(await cards(space, p), String(id), dir);
    for (const rec of changed) await p.cards.put(hl.cardFile(rec.id), rec);
    return changed.length > 0;
  });
}

export function removeCard(space, id) {
  return inTurn(async () => {
    const p = await writable(space);
    const card = (await cards(space, p)).find((c) => c.id === String(id));
    if (!card) throw new Error('No card with that id. Use getDashboard to find it.');
    await p.cards.del(hl.cardFile(card.id));
    return card;
  });
}

// Replace the layout with `source`, or go back to the default with null.
export function setLayout(space, source, origin = null) {
  return inTurn(async () => {
    if (source != null) check(hl.cleanSource(source, hl.MAX_LAYOUT_SOURCE, 'The layout'));
    const p = await writable(space);
    const prev = await layoutRecord(space, p);
    const rec = hl.withOrigin(hl.makeLayout(source, prev), source == null ? null : origin, { made: true });
    await p.layout.put(hl.LAYOUT_FILE, rec);
    return hl.layoutView(rec);
  });
}

// The layout before the last change. False when there is none.
export function restoreLayout(space) {
  return inTurn(async () => {
    const p = await writable(space);
    const rec = hl.restoreLayout(await layoutRecord(space, p));
    if (!rec) return false;
    await p.layout.put(hl.LAYOUT_FILE, rec);
    return true;
  });
}
