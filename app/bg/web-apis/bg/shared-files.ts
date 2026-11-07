// Internal web API: nomad.sharedFiles — the files and folders the user picked for a site in the
// capability file picker (bg/hyper/capabilities.js, picked capabilities). Site-info lists them under
// Permissions, and only site-info can take one back. Available only to nomad:// pages (internalOnly
// in web-apis/bg.ts). The drive's key is never in what this returns.

import { normalizeOrigin } from '../../../lib/urls';
import * as capabilities from '../../hyper/capabilities';
import { capUrlFor } from '../../hyper/capability-rules.mjs';

function assertSiteInfo(ctx) {
  const url = ctx?.sender?.getURL?.() || '';
  if (!/^nomad:\/\/site-info(\/|$)/.test(url)) throw new Error('Only site-info can remove these');
}

export default {
  async list(origin) {
    const o = normalizeOrigin(String(origin || ''));
    return capabilities
      .listCaps(o)
      .filter((c) => c.picked)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map((c) => ({
        url: capUrlFor(c.token, c.target.path),
        path: c.target.path,
        title: c.title || '',
        driveTitle: c.driveTitle || '',
        createdAt: c.createdAt || 0,
      }));
  },

  async remove(url) {
    assertSiteInfo(this);
    const cap = capabilities.lookupCap(String(url || ''));
    if (!cap || !cap.picked) throw new Error('That file is not shared');
    await capabilities.deleteCap(null, String(url));
  },
};
