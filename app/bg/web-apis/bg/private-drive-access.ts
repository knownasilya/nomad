// The one wired private-drive guard (see private-drive-guard.ts). The nomad.fs facade (fs.ts) and the
// Hyperdrive backend (hyperdrive.ts) both use this instance, so they see the same grants.
import * as filesystem from '../../filesystem/index';
import * as drives from '../../hyper/drives';
import * as permissionsUI from '../../ui/permissions';
import * as wcTrust from '../../wc-trust';
import { parseDriveUrl } from '../../../lib/urls';
import { createPrivateDriveGuard } from './private-drive-guard';

export const privateDrive = createPrivateDriveGuard({
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
