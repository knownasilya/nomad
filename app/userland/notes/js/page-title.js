// The tab title for nomad://notes: "<note title> · Notes" while a note is open in the list view,
// and "Notes" on the canvas or with no note open. Same shape as My Library's tab title
// (app/userland/library/js/lib/page-title.js).

import { noteTitle } from '../../../../shared/vault-apps.mjs';

export const APP_TITLE = 'Notes';

// body: the open note's text (unsaved edits included), or null when no note is open.
export function notesPageTitle(body, { canvas = false } = {}) {
  if (canvas || body == null) return APP_TITLE;
  const name = noteTitle(body).replace(/\s+/g, ' ').trim();
  return name ? `${name} · ${APP_TITLE}` : APP_TITLE;
}
