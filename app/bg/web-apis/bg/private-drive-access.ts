// The one wired private-drive guard (see private-drive-guard.ts). The nomad.fs facade (fs.ts) and the
// Hyperdrive backend (hyperdrive.ts) both use this instance, so they see the same grants. Grants are
// kept on this computer until they end, in <userData>/private-drive-grants.json (never synced).
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import * as filesystem from '../../filesystem/index';
import * as drives from '../../hyper/drives';
import * as permissionsUI from '../../ui/permissions';
import * as wcTrust from '../../wc-trust';
import { parseDriveUrl } from '../../../lib/urls';
import { createPrivateDriveGuard } from './private-drive-guard';

const FILE = 'private-drive-grants.json';
const filePath = () => path.join(app.getPath('userData'), FILE);
let writes: Promise<any> = Promise.resolve();

const store = {
  async load() {
    const data = JSON.parse(await fs.promises.readFile(filePath(), 'utf8'));
    return data?.grants;
  },
  save(grants) {
    const text = JSON.stringify({ version: 1, grants }, null, 2);
    writes = writes
      .catch(() => {})
      .then(() => fs.promises.writeFile(filePath(), text, { mode: 0o600 }));
    return writes;
  },
};

export const privateDrive = createPrivateDriveGuard({
  store,
  isWcTrusted: (sender) => wcTrust.isWcTrusted(sender),
  isRootKey: (key) => !!key && filesystem.isRootUrl(`hyper://${key}/`),
  // `hyper://private/` means the sender's own Space's root, as in the serve path and fs-router.
  senderDriveKey: async (sender) => {
    try {
      const url = sender.getURL();
      const urlp = parseDriveUrl(url);
      if (urlp.protocol !== 'hyper:') return null;
      if (urlp.hostname === 'private') {
        const spaceId = filesystem.getSpaceIdForWebContents(sender.id);
        const spaceUrl = spaceId ? filesystem.getSpaceRootDriveUrl(spaceId) : null;
        return await drives.fromURLToKey(spaceUrl || url, true);
      }
      return await drives.fromURLToKey(url, true);
    } catch {
      return null;
    }
  },
  senderOrigin: (sender) => {
    try {
      const u = new URL(sender.getURL());
      return u.host ? `${u.protocol}//${u.host}` : null;
    } catch {
      return null;
    }
  },
  requestPermission: (permId, sender, opts) =>
    permissionsUI.requestPermission(permId, sender, opts),
});
