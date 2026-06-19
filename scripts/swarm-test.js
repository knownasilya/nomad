// Standalone Hyperswarm connectivity test — bypasses all of Nomad.
// Run on BOTH machines with the same shared word:
//   node scripts/swarm-test.js nomad-connectivity-test
// If you see "CONNECTED" on both, the network is fine and the bug is in Nomad.
// If you sit forever with 0 peers, it's the network/OS (firewall, NAT, VPN).
const Hyperswarm = require('../app/node_modules/hyperswarm')
const crypto = require('crypto')

const word = process.argv[2] || 'nomad-connectivity-test'
const topic = crypto.createHash('sha256').update(word).digest() // 32-byte topic

;(async () => {
  const swarm = new Hyperswarm()
  swarm.on('connection', (conn, info) => {
    const host = conn.rawStream && conn.rawStream.remoteHost
    const type = conn.relayedThrough ? 'RELAY' : 'direct'
    console.log(`✅ CONNECTED to peer ${host}  (${type})`)
    conn.on('error', () => {})
  })

  console.log(`joining topic for "${word}" ... (Ctrl-C to quit)`)
  const discovery = swarm.join(topic, { server: true, client: true })
  await discovery.flushed()   // announce/lookup actually pushed to the DHT
  console.log('announced to DHT — so outbound UDP to bootstrap works.')
  await swarm.flush()         // wait for first round of peer connections
  console.log(`initial flush done — peers so far: ${swarm.connections.size}`)
})()
