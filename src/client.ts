import { defaultFilterRegistry, loadFilterSnapshot, type MembershipFilter } from './filters/index.js'
import type { IndicantSnapshotEnvelope, RoomKey } from './types.js'
import { signIndicantRequest } from './http/auth.js'

export interface IndicantClientOptions {
  baseUrl: string
  secret?: string | Uint8Array
  filterFactory?: (filterType: string) => MembershipFilter
  fetchImpl?: typeof fetch
}

export class IndicantClient {
  private readonly baseUrl: string
  private readonly secret: string | Uint8Array | undefined
  private readonly filterFactory: (filterType: string) => MembershipFilter
  private readonly fetchImpl: typeof fetch
  private filter?: MembershipFilter
  private snapshot?: IndicantSnapshotEnvelope

  constructor(options: IndicantClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.secret = options.secret
    this.filterFactory = options.filterFactory ?? defaultFilterFactory
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async check(room: RoomKey): Promise<boolean | undefined> {
    const res = await this.fetchImpl(`${this.baseUrl}/rooms/${encodeURIComponent(room)}`, { method: 'HEAD' })
    if (res.status === 204) return true
    if (res.status === 404) return false
    if (res.status === 503) return undefined
    throw new Error(`unexpected Indicant status ${res.status}`)
  }

  async checkStrict(room: RoomKey): Promise<boolean> {
    const body = JSON.stringify({ room })
    const url = `${this.baseUrl}/check`
    const headers = this.authHeaders('POST', new URL(url).pathname, body)
    headers.set('content-type', 'application/json')
    const res = await this.fetchImpl(url, { method: 'POST', headers, body })
    if (res.status === 204) return true
    if (res.status === 404) return false
    throw new Error(`unexpected Indicant status ${res.status}`)
  }

  async checkMany(rooms: readonly RoomKey[]): Promise<Set<RoomKey>> {
    const body = JSON.stringify({ rooms })
    const url = `${this.baseUrl}/check`
    const headers = this.authHeaders('POST', new URL(url).pathname, body)
    headers.set('content-type', 'application/json')
    const res = await this.fetchImpl(url, { method: 'POST', headers, body })
    if (!res.ok) throw new Error(`unexpected Indicant status ${res.status}`)
    const data = await res.json() as { maybe?: string[] }
    return new Set(data.maybe ?? [])
  }

  currentSnapshot(): IndicantSnapshotEnvelope | undefined {
    return this.snapshot
  }

  async publishSnapshot(snapshotBytes: Uint8Array): Promise<void> {
    const url = `${this.baseUrl}/filter`
    const headers = this.authHeaders('PUT', new URL(url).pathname, snapshotBytes)
    headers.set('content-type', 'application/vnd.indicant.snapshot+json')
    const body = new Uint8Array(snapshotBytes)
    const res = await this.fetchImpl(url, { method: 'PUT', headers, body })
    if (!res.ok) throw new Error(`unexpected Indicant status ${res.status}`)
  }

  async refreshSnapshot(): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/filter`, { method: 'GET' })
    if (!res.ok) throw new Error(`unexpected Indicant status ${res.status}`)
    const snapshot = await res.json() as IndicantSnapshotEnvelope
    const filter = this.filterFactory(snapshot.filter)
    loadFilterSnapshot(filter, snapshot)
    this.filter = filter
    this.snapshot = snapshot
  }

  checkSnapshot(room: RoomKey): boolean | undefined {
    if (!this.filter || !this.snapshot) return undefined
    if (Date.now() > this.snapshot.expiresAt) return undefined
    return this.filter.possible(room)
  }

  private authHeaders(method: string, path: string, body: Uint8Array | string): Headers {
    const headers = new Headers()
    if (!this.secret) return headers
    const timestamp = String(Date.now())
    headers.set('x-indicant-timestamp', timestamp)
    headers.set('x-indicant-signature', signIndicantRequest(this.secret, method, path, timestamp, body))
    return headers
  }
}

export function defaultFilterFactory(filterType: string): MembershipFilter {
  return defaultFilterRegistry.create(filterType)
}
