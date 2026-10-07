// @ts-nocheck
import { randomBytes } from 'crypto';
import Hyperdrive from 'hyperdrive';

// Open a Hyperdrive on its own namespaced Corestore session.
//
// A failed open (an Autobase core is not a Hyperbee — ready() throws DECODING_ERROR)
// must close that namespace. Hyperdrive.close() does not, when ready() never finished,
// and the leaked session holds the core. The following Autobase open then waits forever,
// which is the "drive tab spins, https sites load" failure.
export async function openHyperdrive(corestore, keyBuf) {
  const driveStore = corestore.namespace(randomBytes(32));
  const drive = keyBuf ? new Hyperdrive(driveStore, keyBuf) : new Hyperdrive(driveStore);
  try {
    await drive.ready();
    return drive;
  } catch (err) {
    await drive.close().catch(() => {});
    await driveStore.close().catch(() => {});
    throw err;
  }
}
