import type { IndicantSnapshotEnvelope, RoomKey } from '../types.js'

export interface MembershipFilterCapabilities {
  add?: boolean
  delete?: boolean
  clear?: boolean
  rebuild?: boolean
  export?: boolean
  import?: boolean
  estimateSize?: boolean
}

export interface MembershipFilter {
  readonly type: string
  readonly version?: number
  readonly capabilities?: MembershipFilterCapabilities
  add?(key: RoomKey): boolean
  delete?(key: RoomKey): boolean
  possible(key: RoomKey): boolean
  clear?(): void
  rebuild?(keys: Iterable<RoomKey>): void
  exportPayload(): unknown
  importPayload(payload: unknown): void
  estimatedBytes?(): number
}

export interface IndicantFilterPlugin<TOptions = unknown> {
  readonly type: string
  readonly version?: number
  create(options?: TOptions): MembershipFilter
}

export type FilterFactory<TOptions = unknown> = (options?: TOptions) => MembershipFilter

export type FilterSpec =
  | MembershipFilter
  | IndicantFilterPlugin<any>
  | string
  | { type: string; options?: unknown }

export class FilterRegistry {
  private readonly plugins = new Map<string, IndicantFilterPlugin<any>>()

  register<TOptions>(plugin: IndicantFilterPlugin<TOptions>): this {
    if (!plugin.type) throw new Error('filter plugin type is required')
    this.plugins.set(plugin.type, plugin as IndicantFilterPlugin<any>)
    return this
  }

  has(type: string): boolean {
    return this.plugins.has(type)
  }

  create<TOptions = unknown>(type: string, options?: TOptions): MembershipFilter {
    const plugin = this.plugins.get(type)
    if (!plugin) throw new Error(`unsupported Indicant filter type: ${type}`)
    return plugin.create(options)
  }

  createFromSpec(spec?: FilterSpec): MembershipFilter {
    if (!spec) return this.create('cuckoo')
    if (typeof spec === 'string') return this.create(spec)
    if (isMembershipFilter(spec)) return spec
    if (isFilterPlugin(spec)) return spec.create()
    return this.create(spec.type, spec.options)
  }

  loadSnapshot(snapshot: IndicantSnapshotEnvelope, existing?: MembershipFilter): MembershipFilter {
    if (snapshot.indicant !== 1) throw new Error('unsupported Indicant snapshot')
    const filter = existing?.type === snapshot.filter ? existing : this.create(snapshot.filter)
    filter.importPayload(snapshot.payload)
    return filter
  }

  types(): string[] {
    return [...this.plugins.keys()].sort()
  }
}

export function isMembershipFilter(value: unknown): value is MembershipFilter {
  const filter = value as Partial<MembershipFilter> | undefined
  return !!filter && typeof filter.type === 'string' && typeof filter.possible === 'function' &&
    typeof filter.exportPayload === 'function' && typeof filter.importPayload === 'function'
}

export function isFilterPlugin(value: unknown): value is IndicantFilterPlugin<any> {
  const plugin = value as Partial<IndicantFilterPlugin> | undefined
  return !!plugin && typeof plugin.type === 'string' && typeof plugin.create === 'function'
}

export function requireFilterAdd(filter: MembershipFilter): (key: RoomKey) => boolean {
  if (typeof filter.add !== 'function') throw new Error(`filter ${filter.type} does not support add`)
  return filter.add.bind(filter)
}

export function requireFilterDelete(filter: MembershipFilter): (key: RoomKey) => boolean {
  if (typeof filter.delete !== 'function') throw new Error(`filter ${filter.type} does not support delete`)
  return filter.delete.bind(filter)
}

export function clearFilter(filter: MembershipFilter): void {
  if (typeof filter.clear === 'function') filter.clear()
  else throw new Error(`filter ${filter.type} does not support clear`)
}

export function rebuildFilter(filter: MembershipFilter, keys: Iterable<RoomKey>): void {
  if (typeof filter.rebuild === 'function') filter.rebuild(keys)
  else {
    clearFilter(filter)
    const add = requireFilterAdd(filter)
    for (const key of keys) add(key)
  }
}

export function snapshotFilter(filter: MembershipFilter, generation: number, ttlMs: number): IndicantSnapshotEnvelope {
  const now = Date.now()
  return {
    indicant: 1,
    filter: filter.type,
    generation,
    createdAt: now,
    expiresAt: now + ttlMs,
    payload: filter.exportPayload()
  }
}

export function loadFilterSnapshot(filter: MembershipFilter, snapshot: IndicantSnapshotEnvelope): void {
  if (snapshot.indicant !== 1) throw new Error('unsupported Indicant snapshot')
  if (snapshot.filter !== filter.type) {
    throw new Error(`snapshot filter ${snapshot.filter} cannot be loaded into ${filter.type}`)
  }
  filter.importPayload(snapshot.payload)
}

export const defaultFilterRegistry = new FilterRegistry()

export function registerFilterPlugin<TOptions>(plugin: IndicantFilterPlugin<TOptions>): FilterRegistry {
  return defaultFilterRegistry.register(plugin)
}

export function createFilter(spec?: FilterSpec, registry = defaultFilterRegistry): MembershipFilter {
  return registry.createFromSpec(spec)
}

export { ExactSetFilter, exactSetFilterPlugin } from './exact-set.js'
export { BloomFilter, bloomFilterPlugin } from './bloom.js'
export { CountingBloomFilter, countingBloomFilterPlugin } from './counting-bloom.js'
export { CuckooFilter, cuckooFilterPlugin } from './cuckoo.js'

import { exactSetFilterPlugin } from './exact-set.js'
import { bloomFilterPlugin } from './bloom.js'
import { countingBloomFilterPlugin } from './counting-bloom.js'
import { cuckooFilterPlugin } from './cuckoo.js'

defaultFilterRegistry
  .register(cuckooFilterPlugin)
  .register(bloomFilterPlugin)
  .register(countingBloomFilterPlugin)
  .register(exactSetFilterPlugin)