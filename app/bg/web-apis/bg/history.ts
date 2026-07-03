import * as historyDb from '../../dbs/history';
const hdb: any = historyDb; // pass-through spreads into fixed-arity db fns
import { findTab } from '../../ui/tabs/manager';

function getCallerSpaceId(sender) {
  const tab = findTab(sender);
  return tab?.spaceId ?? undefined;
}

// exported api
// =

export default {
  async addVisit(...args) {
    return hdb.addVisit(0, ...args);
  },

  async getVisitHistory(opts) {
    return historyDb.getVisitHistory(0, opts, getCallerSpaceId(this.sender));
  },

  async getMostVisited(opts) {
    return historyDb.getMostVisited(0, opts, getCallerSpaceId(this.sender));
  },

  async search(...args) {
    return hdb.search(...args);
  },

  async removeVisit(...args) {
    return hdb.removeVisit(...args);
  },

  async removeAllVisits(...args) {
    return hdb.removeAllVisits(...args);
  },

  async removeVisitsAfter(...args) {
    return hdb.removeVisitsAfter(...args);
  },
};
