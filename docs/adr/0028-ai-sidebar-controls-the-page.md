# The AI Sidebar can click, type and scroll on the page in the user's tab

**Status: Accepted.** 2026-10-30.

The AI Sidebar can **use the page** in the user's tab: it clicks buttons and links, types into
fields, picks from dropdowns, presses keys and scrolls, while the user watches an AI cursor do it.
"Sign me up for the newsletter", "find a direct flight on Friday", "fill in this form with my
work address". The rules are in `app/bg/ai/page-control.mjs`; the actions run in
`app/bg/ui/page-control.js`; the page side (finding controls, the cursor, the bar) is
`app/fg/webview-preload/page-control.js`.

## Decision

1. **The AI picks controls by reference, not by pixel.** `snapshotPage` lists the page's controls
   (buttons, links, text fields, checkboxes, dropdowns, and elements that only act like buttons:
   a click handler in the markup, a tab stop, or a pointer cursor) with a number each, a role, a
   name and its state. The AI passes that `ref` to `clickElement`, `typeText`, `selectOption` or
   `scrollPage`; `pressKey` acts where the focus is. This works with every model Nomad runs,
   including text-only local ones, costs a few KB per step instead of an image, and isn't thrown off
   by layout. `clickAt({ x, y })`, a point in the last screenshot, is there for a model that sees
   images, for canvases and maps that have no controls to list. A page's own WebMCP tools stay the
   first choice when it has them.
2. **Real input, sent from bg.** The preload scrolls a control into view and gives its middle on
   screen; bg moves the cursor there and sends the click with `webContents.sendInputEvent`, types
   with `insertText`, and presses keys as keyDown, char and keyUp. The page gets trusted events with
   real focus and hover, as from the user's own mouse, so frameworks that ignore synthetic events
   work. A `<select>` is set from the isolated world (its value plus `input` and `change`), which a
   framework that tracks the value in the page's world sees as a change. Scrolling is
   `scrollTo` from the isolated world. After each action bg waits for any navigation and for the
   DOM to be still, then returns what it did and the controls on screen now, so the AI rarely needs
   another snapshot.
3. **Refs live in the preload's isolated world.** Elements are kept in that world's maps, so the
   page can't read or forge them. Refs restart with each page load, so bg counts each tab's loads and
   refuses a ref from a snapshot of an earlier page.
4. **One tab per turn.** The first page action of a turn pins the tab the user is on. Later
   actions go to that tab only: if the user switches tabs, the action fails and the AI is told to
   stop and say so. A tab the AI opened itself in the turn (`openTab`) can take over the pin. The AI
   works in the user's tab by default; it doesn't work in background tabs.
5. **The AI Sidebar only.** The capabilities carry the gates `personal`, `tab` and `renderer`, so
   a page's own `nomad.ai.chat()`, the phone's AI panel (no renderer here) and other programs on
   this machine through the loopback MCP (no tab, ADR-0021) never get them, and `executeTool`
   checks again. A CLI runtime's sidebar turn (Claude) gets them through its turn token, like the
   rest of its turn.
6. **The user says yes per site, for 30 days.** The first action on a site asks
   `aiPageControl` ("Let the AI assistant click, type and scroll on this site for 30 days"). A yes
   is stored in sitedata as the time it ends; after that, the next action asks again. The prompt
   itself persists nothing (`persist: false`). The grant shows in the site-info panel, where the
   user can remove it, or pick Allow or Deny, which don't end. A no holds for the rest of the turn.
7. **Some things stay the user's.** The AI can't type into or click password fields
   (`type=password`, `autocomplete` current-password, new-password or one-time-code), payment fields
   (`autocomplete=cc-*`, or named like a card number or CVV) or file inputs; the snapshot marks
   them `blocked` and never includes their value. A click on a control named to buy, pay, check
   out, place an order, subscribe, donate, send, post, publish, delete, remove, unsubscribe,
   transfer, withdraw, book or reserve, and Enter in a form whose submit button is named that way,
   wait for the user's OK (`aiPageAction`, asked every time). nomad:// pages and `hyper://private/`
   are off limits.
8. **The user can always see it and stop it.** While the AI controls a page, the page has a blue
   border, the AI's cursor with a "Nomad AI" tag, and a "Nomad AI is using this page" bar with a
   Stop button, all in a closed shadow root that ignores the pointer except for Stop. They sit in
   the top layer (a manual popover, shown again whenever the page opens a modal or popover of its
   own), so a page's dialogs and menus never cover them. A page's modal makes the bar inert, so a
   click on it is caught by position. They come back
   on each new page load until the turn ends, and go away when it does. Stop and Esc end the turn.
   A click or key press of the user's own in the page ends the AI's control for the rest of the
   turn: the next action fails, and the AI is told to say what it did and what's left.
9. **Page text is data.** The prompt tells the model that a page's text is not the user's
   instructions. The confirm in 7 is the backstop for a page that talks the AI into a purchase or a
   post.

## Consequences

- The AI can do anything the user could do on a site they allowed, apart from the fields in 7, so
  the 30-day grant is a real grant. The bar, the cursor and Stop are what keep it in view.
- The risky-click words are English and match names, not intent: a button called "Confirm" on a
  payment page goes through without a confirm. The confirm is a backstop, not the guard; the site
  grant is.
- Frames are not listed: a control inside an iframe (an embedded payment form, many sign-in
  widgets) can't be used by ref. `clickAt` reaches it for a model that sees images.
- Elements that act like buttons only through a script's listener and no pointer cursor are
  missed.
- The phone's AI panel doesn't get page control. It would need a round trip over the AI Bridge
  into the phone's WebView, with synthetic events only.
