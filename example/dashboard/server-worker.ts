import http from 'node:http'
import { workerData, parentPort } from 'node:worker_threads'
import { createIndicant, createIndicantHttpHandler } from '../../src/index.js'

const { serverId, filterType, basePath, secret } = workerData as {
  serverId: string
  filterType: string
  basePath: string
  secret: string
}

const indicant = createIndicant({
  role: 'embedded',
  tracker: true,
  checkStrategy: 'hybrid',
  filter: { type: filterType, options: { capacity: 10_000 } }
})

const handler = createIndicantHttpHandler(indicant, {
  basePath,
  secret,
  exposeSnapshot: true,
  exposeStats: true
})

const server = http.createServer(async (req, res) => {
  if (await handler(req, res)) return
  res.writeHead(404).end('not found')
})

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  parentPort?.postMessage({ type: 'listening', serverId, port })
})

parentPort?.on('message', (msg: { type: string; room: string; connection: string }) => {
  if (msg.type !== 'enter') return
  indicant.enter(msg.room, msg.connection)
  parentPort?.postMessage({ type: 'entered', room: msg.room })
})
