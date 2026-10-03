// @ts-nocheck
import * as drives from './drives';
import * as assets from './assets';
import * as debug from './debugging';
import * as dns from './dns';
import * as watchlist from './watchlist';
import * as daemon from './daemon';
import * as discovery from './discovery';

export default {
  drives,
  assets,
  debug,
  dns,
  watchlist,
  daemon,
  discovery,
  async setup(opts) {
    await this.drives.setup(opts);
    await this.watchlist.setup();
    // Announce any already-listed Drives once the swarm is up (ADR-0016). Individual Drives
    // (re-)list lazily when their manifest is read via getDriveIdentFull.
    this.discovery.install();
  },
};
