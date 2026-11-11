// The home page's layout and pinned cards (ADR-0048): the Vault reads and writes behind
// nomad://desktop (web-apis/bg/vault.ts), the AI Sidebar's Pin to Home (web-apis/bg/ai-shell.ts)
// and the AI's dashboard capabilities (web-apis/bg/ai-vault.ts). The rules, the record shapes and
// the default layout are shared/home-layout.mjs. A layout and a card are openui-lang programs, so
// each is parsed before it is kept (ai/genui-page.js programError): the page never gets one that
// draws nothing.
//
// `space` is a Space key, or null for a page with none. Records are the user's own, in the Vault,
// so their other Devices have the same home page. A page hears of a change through the Vault's
// own updates (nomad.vault.watchAppData).

import * as vault from '../hyper/vault';
import { programError } from '../ai/genui-page.js';
import * as hl from '../../../shared/home-layout.mjs';

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

export async function cards(space) {
  return hl.sortCards(await vault.listAppRecords(hl.cardsPrefix(space)));
}

async function layoutRecord(space) {
  const rec = await vault.readAppRecord(hl.layoutPath(space));
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

// What the page draws: { layout: { source, custom, canRestore, broken? }, cards: [record] }. A
// layout that no longer draws gives way to the default (`broken`), so the page is never blank; a
// card that doesn't is marked `broken` and the page says so in its place.
export async function get(space) {
  const [rec, list] = await Promise.all([layoutRecord(space), cards(space)]);
  const layout = hl.layoutView(rec);
  if (layout.custom && !draws(layout.source)) {
    layout.source = hl.DEFAULT_LAYOUT;
    layout.broken = true;
  }
  return { layout, cards: list.map((c) => (draws(c.source) ? c : { ...c, broken: true })) };
}

// What the AI reads (getDashboard).
export async function forModel(space) {
  const [rec, list] = await Promise.all([layoutRecord(space), cards(space)]);
  return hl.homeForModel(rec, list);
}

// Pin a new card, or change one (`id`): { id?, title?, source?, wide? }. `origin` is the chat it
// came from (shared/ai-origin.mjs). Returns the record.
export function pinCard(space, fields = {}, origin = null) {
  return inTurn(async () => {
    const list = await cards(space);
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
    await vault.putAppRecord(hl.cardPath(space, rec.id), rec);
    return rec;
  });
}

// One place earlier (-1) or later (1) on the page.
export function moveCard(space, id, dir) {
  return inTurn(async () => {
    const changed = hl.moveCard(await cards(space), String(id), dir);
    for (const rec of changed) await vault.putAppRecord(hl.cardPath(space, rec.id), rec);
    return changed.length > 0;
  });
}

export function removeCard(space, id) {
  return inTurn(async () => {
    const card = (await cards(space)).find((c) => c.id === String(id));
    if (!card) throw new Error('No card with that id. Use getDashboard to find it.');
    await vault.delAppRecord(hl.cardPath(space, card.id));
    return card;
  });
}

// Replace the layout with `source`, or go back to the default with null.
export function setLayout(space, source, origin = null) {
  return inTurn(async () => {
    if (source != null) check(hl.cleanSource(source, hl.MAX_LAYOUT_SOURCE, 'The layout'));
    const prev = await layoutRecord(space);
    const rec = hl.withOrigin(hl.makeLayout(source, prev), source == null ? null : origin, { made: true });
    await vault.putAppRecord(hl.layoutPath(space), rec);
    return hl.layoutView(rec);
  });
}

// The layout before the last change. False when there is none.
export function restoreLayout(space) {
  return inTurn(async () => {
    const rec = hl.restoreLayout(await layoutRecord(space));
    if (!rec) return false;
    await vault.putAppRecord(hl.layoutPath(space), rec);
    return true;
  });
}
