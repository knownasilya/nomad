import { normalizeOrigin } from '../../../lib/urls';
import * as capabilities from '../../hyper/capabilities';

// The page's origin, which owns the capabilities it creates. Not `URL.origin`: that is "null" for
// hyper:// and nomad:// URLs, which made every page the owner of every capability.
const senderOrigin = (sender) => normalizeOrigin(sender.getURL());

// exported api
// =

export default {
  /**
   * @param {String} target
   * @returns {Promise<String>}
   */
  async create(target) {
    var origin = senderOrigin(this.sender);
    return capabilities.createCap(origin, target);
  },

  /**
   * @param {String} capUrl
   * @param {String} target
   * @returns {Promise<Void>}
   */
  async modify(capUrl, target) {
    var origin = senderOrigin(this.sender);
    return capabilities.modifyCap(origin, capUrl, target);
  },

  /**
   * @param {String} capUrl
   * @returns {Promise<Void>}
   */
  async delete(capUrl) {
    var origin = senderOrigin(this.sender);
    return capabilities.deleteCap(origin, capUrl);
  },
};
