// nomad/shared/home-setup.mjs
//
// Set up a home: one step that makes a Space for the people you live with. It makes a new Space,
// shares it (ADR-0029, so its Notes and pins are its members'), puts in three starter Notes, a
// Groceries list (shared/note-lists.mjs), House info and a Chores list, pins the first two
// (ADR-0032), gives the Space a household board for its home page (boardLists, shared/home-layout.mjs
// householdLayout, ADR-0048 amendment), and opens the Space's Sharing page to invite the others as
// Can edit.
//
// Desktop runs it (app/bg/web-apis/bg/vault.ts setUpHome), from My Library → Sharing. The phone
// joins the Space with the code like any shared Space. Pure: no I/O.

export const HOME_NAME = 'Home';
export const HOME_ICON = 'home';
export const HOME_COLOR = '#e8a025'; // one of the Space colors (fg/shell-menus/spaces.js COLORS)
export const MAX_NAME = 100;

// The starter Notes, in pin order: { key, title, body, pin? }. The first line of a Note is its
// title. One with `pin: false` isn't pinned: it is on the home page's board instead.
export function starterNotes() {
  return [
    {
      key: 'groceries',
      title: 'Groceries',
      body: '# Groceries\n\n- [ ] \n',
    },
    {
      key: 'house',
      title: 'House info',
      body: [
        '# House info',
        '',
        'What everyone in the house needs to know. Ask the AI about it: “when do the bins go out?”',
        '',
        '## Wi-Fi',
        '',
        '- Network: ',
        '- Password: ',
        '',
        '## Bins',
        '',
        '- Rubbish: ',
        '- Recycling: ',
        '',
        '## Emergency contacts',
        '',
        '- ',
        '',
        '## Appliances and manuals',
        '',
        '- ',
        '',
      ].join('\n'),
    },
    {
      key: 'chores',
      title: 'Chores',
      body: '# Chores\n\n- [ ] \n',
      pin: false,
    },
  ];
}

// The lists the household board shows, by title, in order (shared/home-layout.mjs householdLayout).
export function boardLists() {
  return ['Chores', 'Groceries'];
}

// The link that opens a Note, as a pin.
export function noteUrl(id) {
  if (!/^[a-z0-9-]+$/.test(String(id || ''))) throw new Error('Not a note id: ' + id);
  return `nomad://notes/${id}`;
}

// The Space's name and the user's name in it, tidied: { name, ownName }. Throws when one is too long.
/** @param {{ name?: string, ownName?: string }} names */
export function homeNames({ name, ownName } = {}, fallbackOwnName = 'Me') {
  const n = String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const own = String(ownName ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (n.length > MAX_NAME) throw new Error(`A Space’s name can be at most ${MAX_NAME} characters`);
  if (own.length > MAX_NAME) throw new Error(`Your name can be at most ${MAX_NAME} characters`);
  return { name: n || HOME_NAME, ownName: own || fallbackOwnName };
}

// The pins for the starter Notes, given their ids by key: [{ url, title }].
export function starterPins(ids) {
  return starterNotes()
    .filter((n) => n.pin !== false && ids && ids[n.key])
    .map((n) => ({ url: noteUrl(ids[n.key]), title: n.title }));
}
