# Pinned pages belong to the Space, and sync

**Status: Accepted.** 2026-10-31.

Desktop had two kinds of "pinned": pinned tabs in the sidebar, kept only in this window's session,
and pins on the new tab page, kept in `/nomad/pins.json` of the Personal Space's Root Drive. The
phone's home shortcuts use that same file, but for the Space the phone is in. So a page pinned on the
phone never showed up in the desktop sidebar, a tab pinned on desktop never reached the phone, and in
any Space but Personal desktop and the phone read different files. The user wants one set of pinned
pages per Space, on every Device, drawn on desktop as icon tiles like the phone's shortcuts (and
Arc's favorites).

The rules are `shared/pins.mjs` (tests `tests/unit/pins.test.js`); desktop keeps them in
`app/bg/ui/space-pins.js`, binds tabs in `app/bg/ui/tabs/manager.js`, and draws them in
`app/fg/shell-window/sidebar.js` and `tabs.js`.

## Decision

1. **A Space's pins are `/nomad/pins.json` in its Root Drive** (its Space Library when the Space is
   shared, ADR-0029): an array of hrefs, in order, in the canonical form both runtimes give a URL.
   Nothing changes on the wire or on the phone. A pin's title is the title of the bookmark with that
   href in the same drive, so pinning a page also writes a bookmark (in the phone's
   `/bookmarks/<hash>.json` form, so the phone can remove it too).
2. **A pinned tab is bound to one pin** (`pinUrl` on the tab, kept in the session). The pin is what
   lasts: closing the tab leaves the tile, and clicking the tile opens the tab again. Navigating
   inside a pinned tab keeps the binding.
3. **Pins change from any Device.** Desktop watches the drive (`base.on('update')`). When a pin goes
   away, its bound tab stays open as an ordinary tab. A pinned tab from before this change, or one
   pinned before the pins were read, is bound to the pin for its page, and that page is added to the
   pins once. A drive whose view hasn't synced yet is "not read", never "no pins", so it can't unpin
   everything. A Space the Device can only view leaves its own pinned tabs alone and can't take
   new pins.
4. **Desktop draws pins as tiles.** In the sidebar they are a grid of favicon tiles above the tabs
   (the open tab's tile lifted, a closed pin's icon quieter); drag to reorder, drag a tab onto them to
   pin it, right-click a closed pin to open or unpin it. The top bar keeps its compact pinned tabs, in
   pin order, and shows closed pins there too.
