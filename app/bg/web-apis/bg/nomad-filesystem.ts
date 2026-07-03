import { PermissionsError } from 'beaker-error-constants';
import * as filesystem from '../../filesystem/index';

// typedefs
// =

/**
 * @typedef {Object} NomadFilesystemPublicAPIRootRecord
 * @prop {string} url
 */

// exported api
// =

export default {
  /**
   * @returns {NomadFilesystemPublicAPIRootRecord}
   */
  get() {
    if (!this.sender.getURL().startsWith('nomad:')) {
      throw new PermissionsError();
    }
    return {
      url: filesystem.get().url,
    };
  },
};
