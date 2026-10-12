# Highlights mark text with Chromium's text fragments, and live in the Vault

**Status: Accepted.** 2026-10-11.

The user can select text on a web or hyper:// page and **highlight** it, **copy a link** to it, or
**leave a note** about it. The page shows its Highlights each time it loads; a Highlight with a Note
gets a small note button at its end, which opens the Note in a new tab. The rules are in
`shared/highlights.mjs`; the browser side is `app/bg/ui/highlights.js`; the page side is
`app/fg/webview-preload/highlights.js`.

## Decision

1. **A Highlight names its text with a text directive**, the part of a link after `#:~:text=`
   (`[prefix-,]textStart[,textEnd][,-suffix]`), as Chrome's "Copy link to highlight" does. Nomad
   makes and finds directives with `text-fragments-polyfill`, Google's implementation of the rules
   Chromium follows. So a copied link marks the text in any Chromium browser, Nomad included
   (Chromium handles the link itself), and the stored directive finds the same text again.
2. **One set per user, in the Vault**: `/.vault/highlights/<page>/<id>.json`
   `{ type: 'nomad/highlight', id, url, text, quote, title, noteId?, createdAt }`. `url` is the page's
   address without its fragment and without tracking parameters (`utm_*`, `fbclid`, …); `<page>` is
   a short hash of it, so a page's Highlights are one prefix to read. A solo Vault that joins another
   brings them along (ADR-0017).
3. **A Note is an ordinary Note.** "Highlight and Add Note" makes a Note with the page's title, the
   quoted text, and a link back to it, then opens it with the cursor at the end. The Highlight keeps
   the Note's id. Removing the Highlight keeps the Note: it holds what the user wrote. Deleting the
   Note removes the note button; the Highlight stays.
4. **The page draws, the browser stores.** The preload asks for the page's Highlights over IPC
   (`nomad-highlights:list`), finds each one, and marks it with the CSS Custom Highlight API, so the
   page's DOM doesn't change. The note buttons live in a closed shadow root. The browser reads the
   selection and the Highlight under a right-click by calling into the preload's isolated world
   (Electron's world 999), which the page's scripts can't reach.
5. **Top frame of http(s) and hyper:// pages only.** Not nomad:// pages, not frames.

## Consequences

- A page can tell that some of its text is highlighted: `CSS.highlights` and the note buttons' host
  element are in its document. It can't read the Notes. Drawing outside the page (in the shell)
  would hide this, at the cost of keeping overlays in step with the page's scrolling.
- Text that changes or moves to another page loses its Highlight there; the Note keeps the quote.
- The phone shows the Notes but doesn't draw Highlights yet.
