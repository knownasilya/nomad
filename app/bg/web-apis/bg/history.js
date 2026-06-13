// @ts-nocheck
import * as historyDb from '../../dbs/history';
import { findTab } from '../../ui/tabs/manager';

function getCallerSpaceId(sender) {
  const tab = findTab(sender);
  return tab?.spaceId ?? undefined;
}

// exported api
// =

export default {
  async addVisit(...args) {
    return historyDb.addVisit(0, ...args);
  },

  async getVisitHistory(opts) {
    return historyDb.getVisitHistory(0, opts, getCallerSpaceId(this.sender));
  },

  async getMostVisited(opts) {
    return historyDb.getMostVisited(0, opts, getCallerSpaceId(this.sender));
  },

  async search(...args) {
    return historyDb.search(...args);
  },

  async removeVisit(...args) {
    return historyDb.removeVisit(...args);
  },

  async removeAllVisits(...args) {
    return historyDb.removeAllVisits(...args);
  },

  async removeVisitsAfter(...args) {
    return historyDb.removeVisitsAfter(...args);
  },
};
