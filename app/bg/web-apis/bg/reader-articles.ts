// Reader's saved articles (ADR-0033): any web page, kept in the Vault beside a Space's feeds, with
// topics this Device's AI picks. Record layout and rules: shared/reader-articles.mjs. Reached from
// nomad://reader (vault.ts readerSaveArticle/…), and from a tab: the page's context menu and the
// site menu's Save to Reader (saveTab).
//
// - The readable text comes from Readability (bg/lib/extract-article.mjs) over the tab's live DOM,
//   or over the HTML of a pasted link, fetched with the caller's session (its cookies).
// - Tagging runs in the background, one article at a time, on this Device's runtime only
//   (ai.ts completeText, passed in by main.js as auto-names gets it). Settings → AI → "Sort
//   articles I save to Reader into topics" (`ai_reader_topics`) turns the automatic run off; the
//   Reader's "Suggest topics" still asks. Topics the user set are never changed by the AI.

import { EventEmitter } from 'events';
import { net } from 'electron';
import * as vault from '../../hyper/vault';
import * as settingsDb from '../../dbs/settings';
import * as logLib from '../../logger';
import * as ra from '../../../../shared/reader-articles.mjs';
import { extractArticle } from '../../lib/extract-article.mjs';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'reader-articles' });

export const TOPICS_SETTING = 'ai_reader_topics';
const MAX_HTML = 5 * 1024 * 1024; // bytes of a fetched page
const FETCH_TIMEOUT = 20e3;

// 'changed' when tagging starts or ends, for an open Reader (vault-apps.ts watch).
export const events = new EventEmitter();

type Complete = (messages: any[], opts?: any) => Promise<string | null>;
let complete: Complete | null = null;
let queue: Promise<void> = Promise.resolve();
const tagging = new Set<string>(); // `${space}/${id}`, queued or running
let noRuntime = false; // the last run found no AI runtime on this Device

// `complete` is passed in by main.js: importing the AI stack here would loop back to the tabs.
export function setup(opts: { complete?: Complete } = {}) {
  complete = opts.complete || null;
}

// Every saved article in the Space, newest first.
export async function list(space) {
  return ra.sortArticles(await vault.listAppRecords(ra.articlesPrefix(space)));
}

// What the Reader shows about the AI: whether it sorts new articles, which ones it is on now, and
// whether the last try found no runtime.
export async function aiState(space) {
  const prefix = space + '/';
  return {
    autoTopics: !!(await settingsDb.get(TOPICS_SETTING)),
    tagging: [...tagging].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)),
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

// Save a page from its HTML (the tab's DOM, serialized).
export async function saveHtml(space, { url, html, title = '' }, opts: { read?: boolean } = {}) {
  const page = extractArticle(html, url);
  return savePage(space, { ...page, title: page.title || title, url }, opts);
}

// Save a pasted link: fetch it with `session` (the caller's, so a site the user is signed in to
// gives the page they see), then read it. A page that isn't HTML (a PDF, an image) is still saved,
// under its address.
export async function saveUrl(
  space,
  rawUrl,
  { session = null, read = true }: { session?: any; read?: boolean } = {}
) {
  const url = ra.articleUrl(rawUrl);
  if (!url) throw new Error('Enter a web address (https://…) to save it');
  const { html, finalUrl } = await fetchPage(url, session);
  if (!html) return savePage(space, { url: finalUrl, title: finalUrl }, { read });
  return saveHtml(space, { url: finalUrl, html }, { read });
}

async function fetchPage(url, session) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const doFetch = session?.fetch ? session.fetch.bind(session) : net.fetch;
    let res;
    try {
      res = await doFetch(url, {
        signal: controller.signal,
        headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
      });
    } catch (err) {
      throw new Error(
        controller.signal.aborted
          ? 'That page took too long to load'
          : `Couldn’t load that page (${err?.message || err})`
      );
    }
    if (!res.ok) throw new Error(`Couldn’t load that page (${res.status})`);
    const finalUrl = ra.articleUrl(res.url) || url;
    if (!/html|xml/i.test(res.headers.get('content-type') || '')) return { html: '', finalUrl };
    const buf = await res.arrayBuffer();
    const bytes = buf.byteLength > MAX_HTML ? buf.slice(0, MAX_HTML) : buf;
    return { html: new TextDecoder().decode(bytes), finalUrl };
  } finally {
    clearTimeout(timer);
  }
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
    const known = ra.topicCounts(await list(space)).map((t) => t.topic);
    article = ra.withTopics(article, topics, known);
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

function queueTopics(space, id, { force = false } = {}) {
  const key = space + '/' + id;
  if (tagging.has(key) || !complete) return;
  tagging.add(key);
  events.emit('changed');
  queue = queue
    .then(() => pickTopics(space, id, force))
    .catch((err) => {
      logger.warn('Could not pick topics', { id, error: err?.message || String(err) });
    })
    .finally(() => {
      tagging.delete(key);
      events.emit('changed');
    });
}

async function pickTopics(space, id, force) {
  if (noRuntime) return; // the rest of this batch would fail the same way
  const article = await get(space, id);
  if (!article || (article.topicsBy && !force)) return;
  const known = ra.topicCounts(await list(space)).map((t) => t.topic);
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
