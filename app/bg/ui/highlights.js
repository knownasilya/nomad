// Highlights: text the user marks on a web or hyper:// page, and the Note they leave about it
// (ADR-0020). Records live in the Vault (shared/highlights.mjs), so the user's other Devices have
// them; a Note is an ordinary Note (bg/web-apis/bg/vault-apps.ts) that quotes the text and links
// back to it with a '#:~:text=' link.
//
// The page context menu (context-menu.js) gets its items from menuItems(). The webview preload
// (fg/webview-preload/highlights.js) draws a page's Highlights: it asks for them on
// 'nomad-highlights:list', and sends 'nomad-highlights:open-note' when its note button is pressed.
// To read the selection and show a message, this module calls into the preload's world.

import { app, ipcMain, clipboard, webContents as allWebContents } from 'electron';
import * as vault from '../hyper/vault';
import * as vaultApps from '../web-apis/bg/vault-apps';
import * as tabManager from './tabs/manager';
import * as logLib from '../logger';
import * as hl from '../../../shared/highlights.mjs';
import { isNoteId, notePath, isNote } from '../../../shared/vault-apps.mjs';

const logger = logLib.get().child({ category: 'browser', subcategory: 'highlights' });

// Electron runs a context-isolated preload in world 999; its globals are out of the page's reach.
const PRELOAD_WORLD = 999;
const PAGE_CALL_TIMEOUT = 500;
const CHANGED = 'nomad-highlights:changed';

export function setup() {
  ipcMain.handle('nomad-highlights:list', async (e) => {
    const page = senderPage(e);
    if (!page) return [];
    return (await listFor(page)).map((h) => ({ id: h.id, text: h.text, hasNote: h.hasNote }));
  });

  ipcMain.on('nomad-highlights:open-note', async (e, id) => {
    try {
      const page = senderPage(e);
      const h = page && (await listFor(page)).find((x) => x.id === id);
      if (h && h.hasNote) openNote(e.sender, h.noteId);
      else e.sender.send(CHANGED, {}); // the Note is gone: redraw without its button
    } catch (err) {
      logger.warn('Could not open a highlight’s note', { error: err?.message });
    }
  });

  // A page that changes its address without loading (history.pushState) shows other Highlights.
  app.on('web-contents-created', (_e, wc) => {
    let page = null;
    wc.on('did-navigate', (_e2, url) => {
      page = hl.pageUrl(url);
    });
    wc.on('did-navigate-in-page', (_e2, url, isMainFrame) => {
      if (!isMainFrame) return;
      const next = hl.pageUrl(url);
      if (next === page) return;
      page = next;
      if (next) wc.send(CHANGED, {});
    });
  });
}

// The context menu
// =

// Items for the page context menu: { copyLink, items }. `copyLink` goes under Copy; `items` is a
// group of its own. Empty when the page can't have Highlights or the click wasn't on text.
export async function menuItems(wc, props) {
  const none = { copyLink: null, items: [] };
  if (props.isEditable || !hl.pageUrl(props.pageURL)) return none;
  if (props.frame && props.frame.parent) return none; // the top frame only
  const ctx = await callPage(wc, 'context()');
  if (!ctx) return none;

  if (ctx.selection) {
    return {
      copyLink: { label: 'Copy Link to Highlight', click: () => copyLink(wc) },
      items: [
        { label: 'Highlight', click: () => addHighlight(wc) },
        { label: 'Highlight and Add Note', click: () => addHighlight(wc, { withNote: true }) },
      ],
    };
  }

  const page = hl.pageUrl(wc.getURL());
  const h = ctx.hit && page && (await listFor(page)).find((x) => x.id === ctx.hit.id);
  if (!h) return none;
  return {
    copyLink: null,
    items: [
      h.hasNote
        ? { label: 'Open Note', click: () => openNote(wc, h.noteId) }
        : { label: 'Add Note', click: () => addNote(wc, h) },
      {
        label: 'Copy Link to Highlight',
        click: () => {
          clipboard.writeText(hl.withTextDirective(wc.getURL(), h.text));
          say(wc, 'Link copied');
        },
      },
      { label: 'Remove Highlight', click: () => removeHighlight(wc, h) },
    ],
  };
}

async function copyLink(wc) {
  const frag = await makeFragment(wc);
  if (!frag) return;
  clipboard.writeText(hl.withTextDirective(wc.getURL(), frag.text));
  say(wc, 'Link copied');
}

async function addHighlight(wc, { withNote = false } = {}) {
  const frag = await makeFragment(wc);
  if (!frag) return;
  const url = wc.getURL();
  const title = wc.getTitle();
  try {
    // The Note first: a Highlight that points at no Note is worse than a Note with no Highlight.
    const note = withNote ? await createNote(url, title, frag) : null;
    const rec = hl.makeHighlight({
      id: hl.newHighlightId(),
      url,
      text: frag.text,
      quote: frag.quote,
      title,
      noteId: note ? note.id : undefined,
    });
    await vault.putAppRecord(hl.highlightPath(rec.url, rec.id), rec);
    pageChanged(rec.url, wc);
    if (note) openNote(wc, note.id, { write: true });
  } catch (err) {
    logger.warn('Could not save a highlight', { error: err?.message });
    say(wc, 'Not saved: ' + (err?.message || err));
  }
}

async function addNote(wc, h) {
  try {
    const note = await createNote(wc.getURL(), wc.getTitle() || h.title, {
      text: h.text,
      quote: h.quote,
    });
    const fields = {
      id: h.id,
      url: h.url,
      text: h.text,
      quote: h.quote,
      title: h.title,
      noteId: note.id,
    };
    const rec = hl.makeHighlight(fields, h);
    await vault.putAppRecord(hl.highlightPath(rec.url, rec.id), rec);
    pageChanged(rec.url);
    openNote(wc, note.id, { write: true });
  } catch (err) {
    logger.warn('Could not add a note to a highlight', { error: err?.message });
    say(wc, 'Not saved: ' + (err?.message || err));
  }
}

// The Note stays: it holds what the user wrote, and still links to the text.
async function removeHighlight(wc, h) {
  try {
    await vault.delAppRecord(hl.highlightPath(h.url, h.id));
    pageChanged(h.url);
  } catch (err) {
    say(wc, 'Not removed: ' + (err?.message || err));
  }
}

function createNote(url, title, { text, quote }) {
  const body = hl.highlightNoteBody({ title, quote, link: hl.withTextDirective(url, text) });
  return vaultApps.saveNote(null, { body });
}

// In a new tab next to the page, in the page's Space. `write` puts the cursor at the end, to type.
function openNote(wc, noteId, { write = false } = {}) {
  const win = tabManager.findContainingWindow(wc);
  if (!win || !isNoteId(noteId)) return;
  const tab = tabManager.findTab(wc);
  /** @type {any} create() types its options from its defaults, which name every option */
  const opts = { setActive: true, adjacentActive: true, spaceId: tab?.spaceId };
  tabManager.create(win, `nomad://notes/${noteId}${write ? '?write' : ''}`, opts);
}

// Data
// =

// The page's Highlights, oldest first, each with `hasNote`: its Note still exists.
async function listFor(page) {
  const recs = (await vault.listAppRecords(hl.highlightsPrefix(page))).filter(
    (r) => hl.isHighlight(r) && r.url === page
  );
  const out = [];
  for (const r of hl.sortHighlights(recs)) {
    const hasNote = isNoteId(r.noteId) && isNote(await vault.readAppRecord(notePath(r.noteId)));
    out.push({ ...r, hasNote });
  }
  return out;
}

// Every tab showing the page redraws its Highlights. The tab the change came from also drops its
// selection, so the new Highlight shows.
function pageChanged(page, origin = null) {
  for (const wc of allWebContents.getAllWebContents()) {
    if (wc.isDestroyed() || hl.pageUrl(wc.getURL()) !== page) continue;
    wc.send(CHANGED, { clearSelection: wc === origin });
  }
}

// The page's address, when the IPC came from a top frame.
function senderPage(e) {
  const frame = e.senderFrame;
  if (!frame || frame.parent) return null;
  return hl.pageUrl(frame.url);
}

// The preload's world
// =

function callPage(wc, expr) {
  const code = `(window.__nomadHighlights ? window.__nomadHighlights.${expr} : null)`;
  return Promise.race([
    wc.executeJavaScriptInIsolatedWorld(PRELOAD_WORLD, [{ code }]),
    new Promise((resolve) => setTimeout(() => resolve(null), PAGE_CALL_TIMEOUT)),
  ]).catch(() => null);
}

async function makeFragment(wc) {
  const res = await callPage(wc, 'makeFragment()');
  if (res && res.text && hl.isTextDirective(res.text)) return res;
  say(
    wc,
    res && res.error === 'ambiguous'
      ? 'This text shows up more than once. Select more of it to link to it.'
      : 'Nomad couldn’t make a link to this text.'
  );
  return null;
}

function say(wc, text) {
  callPage(wc, `say(${JSON.stringify(String(text))})`);
}
