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
   (`pickTopics`). the AI page’s setup (nomad://ai/setup) → "Sort articles I save to Reader into topics"
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

## Amendment: RSS and Atom feeds

Reader also follows RSS and Atom feeds, next to the hyper:// feeds it already follows, and the AI
sorts their new posts into the same topics.

1. **A follow can be a web feed.** Its record is `follows/web-<hash>.json`
   `{ url, addedAt, kind: 'web' }`. `followName` in `shared/vault-apps.mjs` names a hyper:// follow by
   its host, as before, and a web feed by a hash of its URL (`feed://` becomes `https://`). Follows
   in a shared Space's Library work the same way (`followHost` in `shared/space-library.mjs`).
2. **One parser for both runtimes.** `shared/web-feeds.mjs` reads RSS 2.0, RSS 1.0 (RDF) and Atom
   with regular expressions: no DOM, nothing from the feed is run, at most 100 items, newest first.
   It also finds the feeds a web page links to (`<link rel="alternate">`). Desktop fetches with the
   calling page's session (`bg/web-apis/bg/web-feeds.ts`, 5 MB cap, 20 s timeout, a 5-minute cache
   that Refresh skips). The phone's backend has no web fetch, so the app fetches the text and the
   backend parses it (`reader`/`parseFeed`).
3. **The add box works out what a link is** (`readerAddLink`). A hyper:// drive root is followed. A
   web address is fetched: a feed is followed; a site's home page that links a feed follows that
   feed; any other page is saved as an article, and Reader offers to follow the site's feed when
   the page links one. A saved article keeps that feed's address (`article.feed`), so the reading
   view and the article's row can offer **Follow site** later.
4. **Read marks for web items live in `web-read.json`**, per feed, because Reader on older clients
   prunes `read.json` to hyper:// URLs. A feed that loads drops marks for items it no longer lists;
   one that didn't load keeps them (`mergeWebRead`).
5. **AI topics for feed posts.** When feeds load, Reader hands bg the recent posts (last 30 days)
   with no topics yet; bg tags up to 20 a round (`postsToTag`), one at a time, on this Device's
   runtime, under the same `ai_reader_topics` setting. Each answer is a `post-topics/<id>.json`
   record, also when it is empty, so a post is asked about once. A user's edit sets
   `topicsBy: 'user'` and the AI leaves it. Records the AI wrote are pruned after 120 days once the
   post is no longer in any feed. Topics list feed posts and saved articles together, newest first.
6. **The phone** follows web feeds from the same box (a feed, or a page that links one), loads
   them, shows their topics, and lists a topic's feed posts under its saved articles. It reads the
   post-topics records but doesn't tag posts itself.
7. **The AI's Reader capabilities** (`listReaderPosts`, `followFeed`, `unfollowFeed`,
   `markPostsRead`) take web feeds too.
