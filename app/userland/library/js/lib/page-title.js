// The tab title for My Library: "<item> · <page> · My Library".
//
// PAGES drives both the sidebar nav and the title, so a page added here gets its title with no
// other change. A page that opens one item (a Job, a Mod, a Persona, a Secret) names it with
// setItemTitle(this, name) from its updated(); the app resets it when the page changes.

export const APP_TITLE = 'My Library';

// [id, label, icon classes]: the order of the sidebar nav.
export const PAGES = [
  ['drives', 'Hyperdrives', 'fas fa-fw fa-sitemap'],
  ['listings', 'Listings', 'fas fa-fw fa-broadcast-tower'],
  ['names', 'Names', 'fas fa-fw fa-tag'],
  ['personas', 'Personas', 'fas fa-fw fa-id-badge'],
  ['mods', 'Mods', 'fas fa-fw fa-magic'],
  ['jobs', 'Jobs', 'fas fa-fw fa-clock'],
  ['secrets', 'Secrets', 'fas fa-fw fa-key'],
  ['sharing', 'Sharing', 'fas fa-fw fa-user-friends'],
  ['bookmarks', 'Bookmarks', 'far fa-fw fa-star'],
  ['contacts', 'Contacts', 'far fa-fw fa-address-card'],
  ['history', 'History', 'fas fa-fw fa-history'],
  ['downloads', 'Downloads', 'fas fa-fw fa-arrow-down'],
];

export const DEFAULT_PAGE = 'drives';

export function pageLabel(view) {
  const page = PAGES.find(([id]) => id === view);
  return page ? page[1] : '';
}

export function pageTitle(view, item = '') {
  const label = pageLabel(view);
  const name = String(item || '').replace(/\s+/g, ' ').trim();
  return [name, label, APP_TITLE].filter(Boolean).join(' · ');
}

// The event a page sends up to the app with the item it has open ('' for none).
export const ITEM_TITLE_EVENT = 'library-item-title';

export function setItemTitle(el, item) {
  const name = item || '';
  if (el._itemTitle === name) return;
  el._itemTitle = name;
  el.dispatchEvent(new CustomEvent(ITEM_TITLE_EVENT, { detail: name, bubbles: true, composed: true }));
}
