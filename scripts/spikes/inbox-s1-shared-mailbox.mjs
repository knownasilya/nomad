// Spike S1 (ADR-0036): several Devices answering one mailbox key.
//
// Starts a local HyperDHT testnet, has 3 "Devices" listen on the SAME key pair, and connects to it
// from a client with a fresh key pair for every delivery. Reports which server answered, how long a
// connect took, and how fast a connect succeeds after servers go away (closed cleanly, and killed
// without unannouncing).
//
//   node scripts/spikes/inbox-s1-shared-mailbox.mjs
//
// Run from the repo root after `npm install` (it uses app/node_modules).
import { createRequire } from 'module';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const createTestnet = require('hyperdht/testnet');
const DHT = require('hyperdht');

const ROUNDS = Number(process.env.ROUNDS || 12);

const testnet = await createTestnet(10, { teardown: () => {} });
const bootstrap = testnet.bootstrap;
const mailbox = DHT.keyPair();

async function device(name) {
  const node = new DHT({ bootstrap, ephemeral: true });
  await node.fullyBootstrapped();
  const server = node.createServer((conn) => {
    conn.on('error', () => {});
    conn.end(Buffer.from(name));
  });
  await server.listen(mailbox);
  return { name, node, server };
}

async function deliver(timeout = 20000) {
  const node = new DHT({ bootstrap, ephemeral: true });
  const t0 = Date.now();
  try {
    const conn = node.connect(mailbox.publicKey, { keyPair: DHT.keyPair() });
    const who = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), timeout);
      conn.on('data', (d) => { clearTimeout(timer); resolve(d.toString()); });
      conn.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    conn.destroy();
    return { who, ms: Date.now() - t0 };
  } catch (e) {
    return { who: null, ms: Date.now() - t0, error: e.code || e.message };
  } finally {
    await node.destroy();
  }
}

async function rounds(label, n = ROUNDS) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await deliver());
  const counts = {};
  for (const r of out) counts[r.who || `fail:${r.error}`] = (counts[r.who || `fail:${r.error}`] || 0) + 1;
  const ms = out.filter((r) => r.who).map((r) => r.ms).sort((a, b) => a - b);
  console.log(`\n${label}`);
  console.log('  answered by:', counts);
  if (ms.length) console.log(`  connect ms: min ${ms[0]}, median ${ms[ms.length >> 1]}, max ${ms.at(-1)}`);
  return out;
}

const devices = [await device('desktop'), await device('laptop'), await device('phone')];
await rounds('3 Devices listening on one mailbox key');

// The Device that answers is killed: no unannounce, its node vanishes. Its announce stays in the
// DHT until it expires, so this is the failover a sender actually sees when a laptop lid closes.
await devices[0].node.destroy({ force: true });
await rounds('desktop (the one answering) killed without unannouncing; 2 left');

await devices[1].server.close();
await devices[1].node.destroy();
await rounds('laptop closed cleanly (unannounced); 1 left (phone)');

await devices[2].node.destroy({ force: true });
await rounds('all gone', 3);

await testnet.destroy();
process.exit(0);
