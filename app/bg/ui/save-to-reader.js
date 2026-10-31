// Save to Reader (ADR-0033): keep the page a tab shows in the Reader of the tab's Space, as a read
// article. From the page's context menu (context-menu.js) and the site menu (views.saveToReader).
// The AI picks its topics afterwards (web-apis/bg/reader-articles.ts).

import * as prompts from './subwindows/prompts';
import * as logLib from '../logger';
import * as vaultApps from '../web-apis/bg/vault-apps';
import * as readerArticles from '../web-apis/bg/reader-articles';
import { articleUrl } from '../../../shared/reader-articles.mjs';

const logger = logLib.get().child({ category: 'hyper', subcategory: 'reader-articles' });

// True when the page at `url` can be saved: http(s) or a hyper:// page, not nomad:// or the
// private drive.
export function canSave(url) {
  return !!articleUrl(url);
}

export async function saveWebContents(wc) {
  if (!wc || wc.isDestroyed() || !canSave(wc.getURL())) return;
  let message;
  try {
    const space = await vaultApps.spaceKey({ sender: wc });
    const article = await readerArticles.saveTab(space, wc);
    message = `Saved “${clip(article.title)}” to Reader`;
  } catch (err) {
    logger.warn('Could not save the page to Reader', { error: err?.message });
    message = 'Couldn’t save to Reader: ' + (err?.message || err);
  }
  await prompts.create(wc, 'toast', { message, duration: 4000 }).catch(() => {});
}

// Save a link on the page, unread: it's for later. Fetched with the tab's session.
export async function saveLink(wc, url) {
  if (!wc || wc.isDestroyed() || !canSave(url)) return;
  let message;
  try {
    const space = await vaultApps.spaceKey({ sender: wc });
    const article = await readerArticles.saveUrl(space, url, { session: wc.session, read: false });
    message = `Saved “${clip(article.title)}” to Reader to read later`;
  } catch (err) {
    logger.warn('Could not save the link to Reader', { error: err?.message });
    message = 'Couldn’t save to Reader: ' + (err?.message || err);
  }
  await prompts.create(wc, 'toast', { message, duration: 4000 }).catch(() => {});
}

function clip(s) {
  const t = String(s || '');
  return t.length > 60 ? t.slice(0, 59) + '…' : t;
}
