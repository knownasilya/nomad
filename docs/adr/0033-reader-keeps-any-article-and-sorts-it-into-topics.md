# Reader keeps any article, and the AI sorts it into topics

**Status: Accepted.** 2026-10-31.

Reader only followed `walled.garden/feed` drives over hyper://. The user also reads ordinary web
pages and wants one place that keeps track of them: save what they read from any URL, see it
grouped by topic without filing it by hand, and read it again in a quiet, minimal view that works in
the dark.

The rules are `shared/reader-articles.mjs` (tests `tests/unit/reader-articles.test.js`). Desktop
stores and tags in `app/bg/web-apis/bg/reader-articles.ts`, reads pages with
`app/bg/lib/extract-article.mjs`, and saves from a tab in `app/bg/ui/save-to-reader.js`. The UI is
`nomad://reader`; the phone lists them in `mobile/components/Reader.tsx`.

## Decision

1. **A saved article is a Vault record per Space**, beside the Space's feeds:
   `/.vault/reader/<space>/articles/<id>.json`, the id 16 hex characters from the URL (without its
   fragment and tracking parameters), so saving a page twice keeps one article. It is the user's own
   even in a shared Space (ADR-0029), like the read marks: what someone reads isn't the Space's.
   Its readable text is a second record, `article-text/<id>.json`, written once per save, so marking
   it read or changing its topics doesn't add the whole text to the Vault's log again. The text is
   cut at 50,000 characters.
2. **Any http(s) page or hyper:// page can be saved**, never nomad:// or `hyper://private/`. From a
   tab: the page's context menu (Save Page to Reader; Save Link to Reader for a link, unread, for
   later) and the site menu's Save to Reader. In `nomad://reader`: paste a link in the box that
   also subscribes to feeds (a drive's root address subscribes; anything else is saved). A page saved
   from its tab counts as read.
3. **The readable text comes from Mozilla's Readability** over linkedom in the main process. From a
   tab, bg serializes the live DOM in the preload's isolated world (999), so pages drawn by script
   work and the page's scripts can't stand in for the DOM API. A pasted link is fetched with the
   calling page's session, so a site the user is signed in to gives the page they see. No script
   runs and nothing loads while reading it. The text keeps a small Markdown subset: paragraphs,
   headings, list items, quotes, preformatted blocks. Links and images are dropped.
4. **The AI picks one to three topics after a save**, on this Device's runtime only (`completeText`,
   as auto-names), one article at a time, given the user's topics so far so it reuses them. The
   page's words go in as data to sort; the reply is only read as a short list of topic strings
   (`pickTopics`). Settings → AI → "Sort articles I save to Reader into topics"
   (`ai_reader_topics`) turns the automatic run off; Reader's "Suggest topics" still asks. A topic
   the user sets (`topicsBy: 'user'`) is never changed by the AI.
5. **Reader shows them as a reading log**: Saved → Reading log, a Topics list with counts, and
   "No topic yet". Each article can be marked read or unread, opened in a tab, given topics by
   hand, or removed.
6. **The reading view** (`nomad://reader/?read=<id>`) draws the stored text as plain text nodes,
   in light, sepia or dark (or following the system), with a size and serif/sans choice kept in
   this Device's `localStorage`. When a page had no readable text, it offers to load it again.
7. **The phone reads them**: Reader's Saved chip, topic chips, and mark read or unread. It doesn't
   save pages yet: it has no page reader of its own.

## Consequences

- Two new app dependencies, `@mozilla/readability` and `linkedom` (main process only).
- The AI's Reader capabilities (`listReaderPosts`, …) don't see saved articles yet. Adding them is
  a later change, with the steps CLAUDE.md lists for a personal capability.
