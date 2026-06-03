import { Distributor, pollSnapshots } from 'indicant/distributor'
import { IndicantClient } from 'indicant/client'

const enc = new TextEncoder()

function toBase64Url(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hashRoomKey(input, domain) {
  const data = new Uint8Array([...enc.encode(domain), 0x0a, ...enc.encode(input)])
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toBase64Url(new Uint8Array(digest))
}

export async function roomKeyFromUuid(uuid) {
  return hashRoomKey(await hashRoomKey(uuid, 'indicant-room-h1'), 'indicant-room-h2')
}

class WorkerServer {
  constructor(serverId, distributorId, filterType) {
    this.serverId = serverId
    this.distributorId = distributorId
    this.seq = 0
    this.pending = new Map()
    this.worker = new Worker(new URL('./server.worker.js', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event) => {
      const { id } = event.data
      const resolve = this.pending.get(id)
      if (resolve) { this.pending.delete(id); resolve(event.data) }
    }
    this.ready = this.call({ type: 'init', filterType })
    this.client = new IndicantClient({ baseUrl: `worker://${serverId}/indicant`, fetchImpl: this.fetchImpl.bind(this) })
  }

  call(msg) {
    const id = ++this.seq
    return new Promise((resolve) => { this.pending.set(id, resolve); this.worker.postMessage({ ...msg, id }) })
  }

  async enter(room) {
    await this.call({ type: 'enter', room, connection: crypto.randomUUID() })
  }

  async fetchImpl(url, opts) {
    if (String(url).endsWith('/filter') && (!opts || opts.method === undefined || opts.method === 'GET')) {
      const { envelope } = await this.call({ type: 'filter' })
      return new Response(JSON.stringify(envelope), { status: 200, headers: { 'content-type': 'application/vnd.indicant.snapshot+json' } })
    }
    return new Response(null, { status: 404 })
  }

  terminate() { this.worker.terminate() }
}

export async function buildCluster({ providers, serversPerProvider, filterType }) {
  const distributors = Array.from({ length: providers }, (_, i) =>
    new Distributor(`dist-${String.fromCharCode(97 + i)}`, { ignoreExpired: true }))
  const servers = []
  for (const dist of distributors) {
    for (let n = 1; n <= serversPerProvider; n++) {
      servers.push(new WorkerServer(`${dist.distributorId}-server-${n}`, dist.distributorId, filterType))
    }
  }
  await Promise.all(servers.map((s) => s.ready))
  return { distributors, servers }
}

export async function federate(distributors, servers) {
  const sources = servers.map((s) => ({ serverId: s.serverId, client: s.client }))
  await Promise.all(distributors.map((dist) => pollSnapshots(dist, sources)))
}

export async function runSimulation(distributors, truth, probeCount) {
  const stats = { routes: 0, correct: 0, falsePositive: 0, missed: 0, phantom: 0 }
  const lookFrom = distributors[0]
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
    const key = await roomKeyFromUuid(crypto.randomUUID())
    const hits = lookFrom.locate(key)
    stats.routes += hits.length
    stats.phantom += hits.length
  }
  return stats
}
