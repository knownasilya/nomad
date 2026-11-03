// Spike S1, part 2 (ADR-0036): failover when the Device the DHT points at dies.
//
// HyperDHT keeps ONE forwarding entry per (DHT node, target). Every Device that listens on the same
// mailbox key announces to the same closest nodes, so whoever announced last is the one those nodes
// forward to. This makes the desktop announce last, kills it without unannouncing (a laptop lid
// closing, a crash), then retries a delivery every second and reports how long until one lands.
//
//   node scripts/spikes/inbox-s1-failover.mjs              # 3 Devices on one key
//   PER_DEVICE=1 node scripts/spikes/inbox-s1-failover.mjs # each Device its own derived key
import { createRequire } from 'module';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const createTestnet = require('hyperdht/testnet');
const DHT = require('hyperdht');

const PER_DEVICE = !!process.env.PER_DEVICE;
const testnet = await createTestnet(20, { teardown: () => {} });
const bootstrap = testnet.bootstrap;
const shared = DHT.keyPair();

async function device(name) {
  const node = new DHT({ bootstrap, ephemeral: true });
  await node.fullyBootstrapped();
  const keyPair = PER_DEVICE ? DHT.keyPair() : shared;
  const server = node.createServer((conn) => {
    conn.on('error', () => {});
    conn.end(Buffer.from(name));
  });
  await server.listen(keyPair);
  return { name, node, server, keyPair };
}

async function tryOne(publicKey, timeout) {
  const node = new DHT({ bootstrap, ephemeral: true });
  try {
    const conn = node.connect(publicKey, { keyPair: DHT.keyPair() });
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeout);
      conn.on('data', (d) => { clearTimeout(timer); resolve(d.toString()); conn.destroy(); });
      conn.on('error', () => { clearTimeout(timer); resolve(null); });
    });
  } finally {
    await node.destroy();
  }
}

// One delivery: the shared key, or each Device's key in turn (what a short published list means).
async function deliver(devices, timeout = 5000) {
  const keys = PER_DEVICE ? devices.map((d) => d.keyPair.publicKey) : [shared.publicKey];
  for (const k of keys) {
    const who = await tryOne(k, timeout);
    if (who) return who;
  }
  return null;
}

const desktop = await device('desktop');
const laptop = await device('laptop');
const phone = await device('phone');
// The desktop announces again, last: every DHT node now forwards to it.
desktop.server.refresh();
await new Promise((r) => setTimeout(r, 4000));
console.log(`mode: ${PER_DEVICE ? 'one key per Device' : 'one shared key'}`);
console.log('before:', await deliver([desktop, laptop, phone]));

await desktop.node.destroy({ force: true });
const t0 = Date.now();
let who = null;
let tries = 0;
while (!who && Date.now() - t0 < 6 * 60 * 1000) {
  tries++;
  who = await deliver([laptop, phone], 3000);
  if (!who) await new Promise((r) => setTimeout(r, 1000));
}
console.log(`after killing desktop: ${who || 'nobody'} answered after ${((Date.now() - t0) / 1000).toFixed(1)} s (${tries} tries)`);

await testnet.destroy();
process.exit(0);
