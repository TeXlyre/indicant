import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { Distributor, pollSnapshots, type SnapshotSource } from '../../src/distributor.js'
import { IndicantClient } from '../../src/client.js'
import { roomKeyFromUuid } from '../../src/keys.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXT = fileURLToPath(import.meta.url).endsWith('.ts') ? '.ts' : '.js'
const SRC = existsSync(join(HERE, 'ui')) ? join(HERE, 'ui') : join(HERE, 'src')
const SECRET = process.env.INDICANT_SECRET ?? 'dashboard-demo-secret'
const BASE_PATH = '/indicant'
const POLL_MS = 1000

type FilterType = 'cuckoo' | 'bloom' | 'counting-bloom' | 'exact-set'

interface ClusterConfig { providers: number; serversPerProvider: number; filterType: FilterType }

interface ServerHandle {
  serverId: string
  distributorId: string
  port: number
  worker: Worker
  client: IndicantClient
}

let config: ClusterConfig = { providers: 2, serversPerProvider: 2, filterType: 'cuckoo' }
let distributors: Distributor[] = []
let servers: ServerHandle[] = []
let rooms: { uuid: string; key: string; serverId: string; distributorId: string }[] = []
let truth: { key: string; serverId: string }[] = []
let pollTimer: ReturnType<typeof setInterval> | null = null

function serverUrl(port: number): string {
  return `http://127.0.0.1:${port}${BASE_PATH}`
}

function spawnServer(serverId: string, distributorId: string, filterType: FilterType): Promise<ServerHandle> {
  const worker = new Worker(join(HERE, `server-worker${EXT}`), {
    workerData: { serverId, filterType, basePath: BASE_PATH, secret: SECRET }
  })
  return new Promise((resolve, reject) => {
    worker.once('error', reject)
    worker.once('message', (msg: { type: string; port: number }) => {
      if (msg.type !== 'listening') return
      const client = new IndicantClient({ baseUrl: serverUrl(msg.port), secret: SECRET })
      resolve({ serverId, distributorId, port: msg.port, worker, client })
    })
  })
}

async function teardown(): Promise<void> {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  await Promise.all(servers.map((s) => s.worker.terminate()))
  servers = []
  distributors = []
  rooms = []
  truth = []
}

function allSources(): SnapshotSource[] {
  return servers.map((s) => ({ serverId: s.serverId, client: s.client }))
}

async function federate(): Promise<void> {
  const sources = allSources()
  await Promise.all(distributors.map((dist) => pollSnapshots(dist, sources)))
}

async function buildCluster(next: ClusterConfig): Promise<void> {
  await teardown()
  config = next
  distributors = Array.from({ length: config.providers }, (_, i) =>
    new Distributor(`dist-${String.fromCharCode(97 + i)}`, { ignoreExpired: true }))

  const spawns: Promise<ServerHandle>[] = []
  for (const dist of distributors) {
    for (let n = 1; n <= config.serversPerProvider; n++) {
      spawns.push(spawnServer(`${dist.distributorId}-server-${n}`, dist.distributorId, config.filterType))
    }
  }
  servers = await Promise.all(spawns)
  await federate()
  pollTimer = setInterval(() => { void federate() }, POLL_MS)
}

function enterRoom(handle: ServerHandle, key: string): Promise<void> {
  return new Promise((resolve) => {
    const onMsg = (msg: { type: string; room: string }) => {
      if (msg.type === 'entered' && msg.room === key) { handle.worker.off('message', onMsg); resolve() }
    }
    handle.worker.on('message', onMsg)
    handle.worker.postMessage({ type: 'enter', room: key, connection: crypto.randomUUID() })
  })
}

async function createRoom(distributorId: string) {
  const owned = servers.filter((s) => s.distributorId === distributorId)
  const target = owned[Math.floor(Math.random() * owned.length)]!
  const uuid = crypto.randomUUID()
  const key = roomKeyFromUuid(uuid)
  await enterRoom(target, key)
  const entry = { uuid, key, serverId: target.serverId, distributorId }
  rooms.push(entry)
  truth.push({ key, serverId: target.serverId })
  await federate()
  return entry
}

async function lookup(distributorId: string, uuid: string) {
  const dist = distributors.find((d) => d.distributorId === distributorId)!
  const key = roomKeyFromUuid(uuid)
  return { key, hits: dist.locate(key) }
}

function simulate(probeCount: number) {
  const stats = { routes: 0, correct: 0, falsePositive: 0, missed: 0, phantom: 0 }
  const lookFrom = distributors[0]!
  for (const { key, serverId } of truth) {
    const hits = lookFrom.locate(key)
    if (!hits.some((h) => h.serverId === serverId)) stats.missed++
    for (const h of hits) {
      stats.routes++
      if (h.serverId === serverId) stats.correct++
      else stats.falsePositive++
    }
  }
  for (let i = 0; i < probeCount; i++) {
    const hits = lookFrom.locate(roomKeyFromUuid(crypto.randomUUID()))
    stats.routes += hits.length
    stats.phantom += hits.length
  }
  return { knownRooms: truth.length, ...stats }
}

function state() {
  return {
    config,
    pollMs: POLL_MS,
    distributors: distributors.map((d) => ({
      distributorId: d.distributorId,
      owns: servers.filter((s) => s.distributorId === d.distributorId).map((s) => s.serverId),
      sees: d.remoteServerIds()
    })),
    servers: servers.map((s) => ({ serverId: s.serverId, distributorId: s.distributorId, port: s.port })),
    rooms
  }
}

async function serveStatic(res: http.ServerResponse, file: string, type: string): Promise<void> {
  try {
    const data = await readFile(join(SRC, file))
    res.writeHead(200, { 'content-type': type }).end(data)
  } catch {
    res.writeHead(404).end('not found')
  }
}

function json(res: http.ServerResponse, value: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value, null, 2))
}

function body(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => resolve(d)) })
}

await buildCluster(config)

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://local')
  const p = url.pathname

  if (p === '/') return serveStatic(res, 'index.html', 'text/html; charset=utf-8')
  if (p === '/styles.css') return serveStatic(res, 'styles.css', 'text/css')
  if (p === '/app.js') return serveStatic(res, 'app.js', 'text/javascript')

  if (p === '/api/state') return json(res, state())

  if (req.method === 'POST' && p === '/api/rebuild') {
    const next = JSON.parse(await body(req)) as ClusterConfig
    await buildCluster(next)
    return json(res, state())
  }

  if (req.method === 'POST' && p === '/api/create') {
    const { distributorId } = JSON.parse(await body(req)) as { distributorId: string }
    return json(res, await createRoom(distributorId))
  }

  if (p === '/api/where') {
    const distributorId = url.searchParams.get('distributorId') ?? distributors[0]!.distributorId
    const uuid = url.searchParams.get('uuid') ?? ''
    return json(res, await lookup(distributorId, uuid))
  }

  if (p === '/api/simulate') {
    const probes = Number(url.searchParams.get('probes') ?? '200')
    return json(res, simulate(probes))
  }

  res.writeHead(404).end('not found')
}).listen(8788, () => console.log('Indicant distribution demo on http://localhost:8788'))
