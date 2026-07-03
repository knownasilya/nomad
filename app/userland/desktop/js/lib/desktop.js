import { getAvailableName } from 'nomad://app-stdlib/js/fs.js';

// exported
// =

// const EXPLORER_APP = 'https://hyperdrive.network/'
// export const FIXED_FILES = [
//   makeFixedLink('.home-drive.goto', `${EXPLORER_APP}system`, 'Home Drive'),
//   makeFixedLink('.library.goto', 'nomad://library/', 'My Library'),
// ]

export async function load() {
  var bookmarks = [];
  try {
    bookmarks = await nomad.bookmarks.list();
    bookmarks = bookmarks.filter((b) => b.pinned);
  } catch (e) {
    console.log('Failed to load bookmarks files', e);
  }
  return bookmarks;
}

export async function createLink({ href, title }, pinned) {
  let bookmark = await nomad.bookmarks.get(href);
  if (bookmark) title = bookmark.title;
  await nomad.bookmarks.add({ href, title, pinned });
}

export async function remove(bookmark) {
  await nomad.bookmarks.remove(bookmark.href);
}

// internal
// =

function makeFixedLink(name, href, title) {
  return {
    name,
    stat: {
      isDirectory: () => false,
      isFile: () => true,
      mount: undefined,
      metadata: { href, title },
    },
    isFixed: true,
  };
}
