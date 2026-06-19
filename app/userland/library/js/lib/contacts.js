/* globals beaker */

// Read/write helpers for the contacts address book.
//
// Contacts are stored in hyper://private/address-book.json as an object keyed
// by the contact's hyperdrive key:
//
//   {
//     "profiles": [...],          // left untouched (used by loadProfile)
//     "contacts": {
//       "<key>": { "title": "Alice", "description": "...", "createdAt": 0 }
//     }
//   }
//
// Each top-level key under `contacts` is one card on the Contacts page.

const ADDRESS_BOOK_PATH = 'hyper://private/address-book.json';

// Normalize whatever is on disk into { ...rest, contacts: { key: info } }.
// Tolerates the legacy Beaker shape where `contacts` is an array of { key }.
function normalize(addressBook) {
  var ab = addressBook && typeof addressBook === 'object' ? addressBook : {};
  var contacts = ab.contacts;
  if (Array.isArray(contacts)) {
    var obj = {};
    for (let c of contacts) {
      if (c && c.key) {
        obj[c.key] = {
          title: c.title || c.name || '',
          description: c.description || '',
        };
      }
    }
    contacts = obj;
  }
  return Object.assign({}, ab, { contacts: contacts || {} });
}

export async function readAddressBook() {
  try {
    // NOTE: readFile's 'json' encoding isn't honored on the read path (it
    // returns the raw string), so parse it ourselves like loadProfile does.
    let raw = await beaker.hyperdrive.readFile(ADDRESS_BOOK_PATH);
    return normalize(JSON.parse(raw));
  } catch (e) {
    // A missing file is expected for a fresh profile - start empty.
    if (!String(e).includes('NotFoundError')) {
      console.error('Failed to read address book', e);
    }
    return { contacts: {} };
  }
}

export async function writeAddressBook(addressBook) {
  await beaker.hyperdrive.writeFile(
    ADDRESS_BOOK_PATH,
    JSON.stringify(addressBook, null, 2)
  );
}

// Accepts a hyper:// URL or a bare key and returns just the key/hostname.
export function parseKey(input) {
  if (!input) return '';
  return input
    .trim()
    .replace(/^hyper:\/\//i, '')
    .split('/')[0]
    .split('?')[0]
    .trim();
}

export async function listContacts() {
  var ab = await readAddressBook();
  return Object.keys(ab.contacts).map((key) =>
    Object.assign({ key, url: `hyper://${key}/` }, ab.contacts[key])
  );
}

export async function addContact({ key, title, description }) {
  key = parseKey(key);
  if (!key) throw new Error('A hyper:// link or key is required');
  var ab = await readAddressBook();
  var existing = ab.contacts[key] || {};
  ab.contacts[key] = {
    title: (title || '').trim() || existing.title || '',
    description: (description || '').trim() || existing.description || '',
    createdAt: existing.createdAt || Date.now(),
  };
  await writeAddressBook(ab);
  return key;
}

export async function removeContact(key) {
  var ab = await readAddressBook();
  if (!(key in ab.contacts)) return;
  delete ab.contacts[key];
  await writeAddressBook(ab);
}
