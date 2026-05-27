import http from 'node:http'
import { createIndicant, createIndicantHttpHandler, IndicantClient } from '../src/index.js'

const secret = 'replace-with-a-long-random-secret'

const embedded = createIndicant({
  role: 'embedded',
  tracker: true,
  checkStrategy: 'hybrid',
  filter: { type: 'cuckoo', options: { capacity: 10_000, fingerprintBits: 16 } }
})

const distribution = createIndicant({
  role: 'distribution',
  tracker: false,
  checkStrategy: 'filter',
  filter: { type: 'cuckoo', options: { capacity: 10_000, fingerprintBits: 16 } }
})

// Simulate signaling lifecycle hooks. A future y-webrtc adapter would call these.
embedded.enter('room-hash-a', 'socket-1')
embedded.enter('room-hash-b', 'socket-2')
embedded.enter('room-hash-a', 'probe-1', { role: 'observer' })

const embeddedHttp = createIndicantHttpHandler(embedded, {
  basePath: '/embedded-indicant',
  exposeSnapshot: true,
  exposeStats: true
})

const distributionHttp = createIndicantHttpHandler(distribution, {
  basePath: '/distribution-indicant',
  secret,
  defaultCheckStrategy: 'filter',
  exposeSnapshot: true,
  exposeStats: true
})

const server = http.createServer(async (req, res) => {
  if (await embeddedHttp(req, res)) return
  if (await distributionHttp(req, res)) return
  res.writeHead(404).end('not found')
})

server.listen(8787, async () => {
  console.log('Indicant example listening on http://localhost:8787')
  console.log('Try: curl -I http://localhost:8787/embedded-indicant/rooms/room-hash-a')

  // Publish the embedded filter into the distribution Indicant instance.
  const publisher = new IndicantClient({ baseUrl: 'http://localhost:8787/distribution-indicant', secret })
  await publisher.publishSnapshot(embedded.snapshot(true))
  console.log('Published embedded snapshot to distribution Indicant')
})
