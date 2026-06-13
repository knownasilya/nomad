import hyper from '../../hyper/index';

// exported api
// =

export default {
  async listCores(url) {
    // TODO: drive stats not available in Hyperdrive v11 — return placeholder
    return [];
  },

  async hasCoreBlocks(key, from, to) {
    // TODO: direct core access removed — use Corestore from daemon if needed
    return [];
  },

  async createCoreEventStream(url, corename) {
    // TODO: core event streams removed in v11 stack
    const { EventEmitter } = await import('events');
    return new EventEmitter();
  },
};
