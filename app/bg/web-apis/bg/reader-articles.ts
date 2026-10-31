// Reader's saved articles (ADR-0033): any web page, kept in the Vault beside a Space's feeds, with
// topics this Device's AI picks. Record layout and rules: shared/reader-articles.mjs. Reached from
// nomad://reader (vault.ts readerSaveArticle/…), and from a tab: the page's context menu and the
// site menu's Save to Reader (saveTab).
//
// - The readable text comes from Readability (bg/lib/extract-article.mjs) over the tab's live DOM,
//   or over the HTML of a pasted link, fetched with the caller's session (its cookies).
// - Tagging runs in the background, one article at a time, on this Device's runtime only
//   (ai.ts completeText, passed in by main.js as auto-names gets it). The AI page’s setup (nomad://ai/setup) → "Sort
//   articles I save to Reader into topics" (`ai_reader_topics`) turns the automatic run off; the
//   Reader's "Suggest topics" still asks. Topics the user set are never changed by the AI.

import { EventEmitter } from 'events';
import * as vault from '../../hyper/vault';
import * as settingsDb from '../../dbs/settings';
import * as logLib from '../../logger';
import * as ra from '../../../../shared/reader-articles.mjs';
import { extractArticle } from '../../lib/extract-article.mjs';
import { findFeedLinks } from '../../../../shared/web-feeds.mjs';
import * as webFeeds from './web-feeds';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'reader-articles' });

export const TOPICS_SETTING = 'ai_reader_topics';
const MAX_HTML = 5 * 1024 * 1024; // characters of a tab's DOM

// 'changed' when tagging starts or ends, for an open Reader (vault-apps.ts watch).
export const events = new EventEmitter();

type Complete = (messages: any[], opts?: any) => Promise<string | null>;
let complete: Complete | null = null;
let queue: Promise<void> = Promise.resolve();
const tagging = new Set<string>(); // `${space}/${id}` (an article) or `${space}/p:${url}` (a feed post), queued or running
let noRuntime = false; // the last run found no AI runtime on this Device

// `complete` is passed in by main.js: importing the AI stack here would loop back to the tabs.
export function setup(opts: { complete?: Complete } = {}) {
  complete = opts.complete || null;
}

// Every saved article in the Space, newest first.
export async function list(space) {
  return ra.sortArticles(await vault.listAppRecords(ra.articlesPrefix(space)));
}

// The topics of the Space's feed posts (hyper:// and RSS): [{ url, topics, topicsBy }].
export async function listPostTopics(space) {
  return (await vault.listAppRecords(ra.postTopicsPrefix(space))).filter(ra.isPostTopics);
}

// Every topic in use, articles' and posts', most used first: the AI is asked to reuse these.
async function knownTopics(space) {
  return ra.topicCounts([...(await list(space)), ...(await listPostTopics(space))]).map((t) => t.topic);
}

// What the Reader shows about the AI: whether it sorts new articles, which ones it is on now, and
// whether the last try found no runtime.
export async function aiState(space) {
  const prefix = space + '/';
  return {
    autoTopics: !!(await settingsDb.get(TOPICS_SETTING)),
    tagging: [...tagging].filter((k) => k.startsWith(prefix) && !k.startsWith(prefix + 'p:')).map((k) => k.slice(prefix.length)),
    taggingPosts: [...tagging].filter((k) => k.startsWith(prefix + 'p:')).map((k) => k.slice(prefix.length + 2)),
    noRuntime,
  };
}

export async function get(space, id) {
  const rec = await vault.readAppRecord(ra.articlePath(space, id));
  return ra.isArticle(rec) ? rec : null;
}

export async function getText(space, id) {
  return (await vault.readAppRecord(ra.articleTextPath(space, id)))?.text || '';
}

// Save a page read from a tab or a fetch: `page` is extractArticle's result plus its `url`.
async function savePage(space, page, { read = true } = {}) {
  const url = ra.articleUrl(page.url);
  if (!url) throw new Error('Reader can save http(s) and hyper:// pages');
  const id = ra.articleId(url);
  const prev = await get(space, id);
  const article = ra.makeArticle({ ...page, url }, prev, { read });
  await vault.putAppRecord(ra.articlePath(space, id), article);
  if (page.text)
    await vault.putAppRecord(ra.articleTextPath(space, id), ra.articleText(id, page.text));
  logger.info('Saved an article to Reader', { id, site: article.site, words: article.words });
  if (!article.topicsBy && (await settingsDb.get(TOPICS_SETTING))) queueTopics(space, id);
  return article;
}

// Save a page from its HTML (the tab's DOM, serialized). Keeps the first RSS/Atom feed the page links
// to, so Reader can offer to follow the site.
export async function saveHtml(space, { url, html, title = '' }, opts: { read?: boolean } = {}) {
  const page = extractArticle(html, url);
  const feed = findFeedLinks(html, url)[0]?.url;
  return savePage(space, { ...page, title: page.title || title, url, feed }, opts);
}

// Save a pasted link: fetch it with `session` (the caller's, so a site the user is signed in to
// gives the page they see), then read it. A page that isn't HTML (a PDF, an image) is still saved,
// under its address. `fetched` is the page when the caller already has it (webFeeds.probe).
export async function saveUrl(
  space,
  rawUrl,
  { session = null, read = true, fetched = null }: { session?: any; read?: boolean; fetched?: { html: string; finalUrl: string } | null } = {}
) {
  const url = ra.articleUrl(rawUrl);
  if (!url) throw new Error('Enter a web address (https://…) to save it');
  let page = fetched;
  if (!page) {
    const { text, finalUrl, type } = await webFeeds.fetchPage(url, session);
    page = { html: type === 'html' ? text : '', finalUrl };
  }
  const finalUrl = ra.articleUrl(page.finalUrl) || url;
  if (!page.html) return savePage(space, { url: finalUrl, title: finalUrl }, { read });
  return saveHtml(space, { url: finalUrl, html: page.html }, { read });
}

// Save what a tab shows. Reads its DOM in the preload's isolated world (999), so the page's own
// scripts can't stand in for the DOM API. Returns the article.
export async function saveTab(space, wc) {
  const url = wc.getURL();
  if (!ra.articleUrl(url)) throw new Error('Reader can save http(s) and hyper:// pages');
  let page: any = null;
  try {
    page = await wc.executeJavaScriptInIsolatedWorld(999, [
      { code: `({ html: document.documentElement.outerHTML, title: document.title })` },
    ]);
  } catch (err) {
    logger.warn('Could not read the tab for Reader', { error: err?.message });
  }
  if (!page || typeof page.html !== 'string')
    return savePage(space, { url, title: wc.getTitle() || url });
  return saveHtml(space, {
    url,
    html: page.html.slice(0, MAX_HTML),
    title: page.title || wc.getTitle(),
  });
}

// Mark read or unread, or set the topics by hand. Returns the article.
export async function update(
  space,
  id,
  { topics, read }: { topics?: string[] | string; read?: boolean } = {}
) {
  let article = await get(space, id);
  if (!article) throw new Error('That article isn’t in Reader any more');
  const before = article;
  if (topics !== undefined) {
    article = ra.withTopics(article, topics, await knownTopics(space));
  }
  if (read !== undefined) article = ra.withRead(article, read);
  if (article !== before) await vault.putAppRecord(ra.articlePath(space, id), article);
  return article;
}

export async function remove(space, id) {
  await vault.delAppRecord(ra.articlePath(space, id));
  await vault.delAppRecord(ra.articleTextPath(space, id)).catch(() => {});
}

// Ask the AI for topics now: for `ids` (even ones the user tagged: they asked), or else for every
// article not tagged yet. Returns how many were queued.
export async function suggestTopics(space, ids: string[] | null = null) {
  const todo = ids?.length
    ? ids.filter(ra.isArticleId)
    : (await list(space)).filter((a) => !a.topicsBy).map((a) => a.id);
  noRuntime = false;
  for (const id of todo) queueTopics(space, id, { force: !!ids?.length });
  return todo.length;
}

// Feed posts the Reader just loaded: ask the AI about the recent ones it hasn't looked at (a batch
// at a time; the next refresh sends the rest). `posts` are { url, title, summary, feedTitle,
// createdAt }. With `urls`, ask again for those posts, even ones the user tagged. Returns how many.
export async function tagPosts(space, posts = [], { urls = null }: { urls?: string[] | null } = {}) {
  if (!complete) return 0;
  const clean = (posts || [])
    .filter((p) => p && typeof p.url === 'string' && /^(https?|hyper):\/\//i.test(p.url))
    .map((p) => ({ url: p.url, title: String(p.title || ''), summary: String(p.summary || ''), feedTitle: String(p.feedTitle || ''), createdAt: String(p.createdAt || '') }));
  let todo;
  if (urls?.length) {
    todo = clean.filter((p) => urls.includes(p.url));
    noRuntime = false;
  } else {
    if (!(await settingsDb.get(TOPICS_SETTING)) || noRuntime) return 0;
    const recs = await listPostTopics(space);
    await pruneOld(space, recs, new Set(clean.map((p) => p.url)));
    todo = ra.postsToTag(clean, recs.map((r) => r.url));
  }
  for (const post of todo) queueTopics(space, 'p:' + post.url, { force: !!urls?.length, post });
  return todo.length;
}

// The AI's topics for posts gone from every feed, months later: nothing shows them any more.
async function pruneOld(space, recs, current) {
  const before = Date.now() - 120 * 86400e3;
  for (const r of recs) {
    if (r.topicsBy === 'ai' && !current.has(r.url) && Date.parse(r.updatedAt) < before) {
      await vault.delAppRecord(ra.postTopicsPath(space, r.url)).catch(() => {});
    }
  }
}

// Set a feed post's topics by hand.
export async function setPostTopics(space, url, topics) {
  if (typeof url !== 'string' || !/^(https?|hyper):\/\//i.test(url)) throw new Error('Not a post’s address');
  const rec = ra.makePostTopics(url, Array.isArray(topics) ? topics : String(topics || '').split(','), 'user', await knownTopics(space));
  await vault.putAppRecord(ra.postTopicsPath(space, url), rec);
  return rec;
}

function queueTopics(space, id, { force = false, post = null }: { force?: boolean; post?: any } = {}) {
  const key = space + '/' + id;
  if (tagging.has(key) || !complete) return;
  tagging.add(key);
  events.emit('changed');
  queue = queue
    .then(() => (post ? pickPostTopics(space, post, force) : pickTopics(space, id, force)))
    .catch((err) => {
      logger.warn('Could not pick topics', { id, error: err?.message || String(err) });
    })
    .finally(() => {
      tagging.delete(key);
      events.emit('changed');
    });
}

async function pickPostTopics(space, post, force) {
  if (noRuntime) return;
  const path = ra.postTopicsPath(space, post.url);
  const prev = await vault.readAppRecord(path);
  if (prev && !force) return;
  const known = await knownTopics(space);
  const reply = await complete(ra.topicMessages({ title: post.title, site: '', excerpt: post.summary, text: '', feedTitle: post.feedTitle }, known), { maxTokens: 120 });
  if (reply === null) {
    noRuntime = true;
    return;
  }
  // Stored even when empty, so the AI isn't asked about this post again.
  const topics = ra.pickTopics(reply, known);
  const now = await vault.readAppRecord(path);
  if (now?.topicsBy === 'user' && !force) return;
  await vault.putAppRecord(path, ra.makePostTopics(post.url, topics, 'ai', known));
}

async function pickTopics(space, id, force) {
  if (noRuntime) return; // the rest of this batch would fail the same way
  const article = await get(space, id);
  if (!article || (article.topicsBy && !force)) return;
  const known = await knownTopics(space);
  const text = await getText(space, id);
  const reply = await complete(ra.topicMessages({ ...article, text }, known), { maxTokens: 120 });
  if (reply === null) {
    noRuntime = true;
    return;
  }
  const topics = ra.pickTopics(reply, known);
  if (!topics.length) {
    logger.info('No topics from the AI', { id, reply: String(reply).slice(0, 80) });
    return;
  }
  // The user may have set topics while the AI was thinking; theirs win.
  const now = await get(space, id);
  if (!now || (now.topicsBy === 'user' && !force && article.topicsBy !== 'user')) return;
  await vault.putAppRecord(ra.articlePath(space, id), {
    ...now,
    topics,
    topicsBy: 'ai',
    updatedAt: new Date().toISOString(),
  });
  logger.info('Picked topics', { id, topics });
}
