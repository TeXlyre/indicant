import { bytesToBase64, base64ToBytes } from '../utils/base64.js'
import { indexesFor } from '../utils/hash.js'
import type { IndicantFilterPlugin, MembershipFilter } from './index.js'
import type { RoomKey } from '../types.js'

export interface CountingBloomFilterOptions {
  expectedItems?: number
  falsePositiveRate?: number
  counters?: number
  hashes?: number
  counterBits?: 8 | 16
}

function optimalCounters(n: number, p: number): number {
  return Math.max(8, Math.ceil(-(n * Math.log(p)) / (Math.LN2 ** 2)))
}

function optimalHashes(counters: number, n: number): number {
  return Math.max(1, Math.round((counters / Math.max(1, n)) * Math.LN2))
}

function u16ToBytes(values: Uint16Array): Uint8Array {
  return new Uint8Array(values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength))
}

function bytesToU16(bytes: Uint8Array): Uint16Array {
  const copy = new Uint8Array(bytes)
  return new Uint16Array(copy.buffer)
}

/**
 * Counting Bloom filter.
 *
 * Supports incremental deletes without retaining keys inside the filter
 * artifact. As with any counting Bloom filter, deletes are safe only when the
 * caller deletes keys that were actually added through the same lifecycle. Indicant
 * enforces that in embedded mode with tracker transitions.
 */
export class CountingBloomFilter implements MembershipFilter {
  readonly type = 'counting-bloom'
  readonly capabilities = {
    add: true,
    delete: true,
    clear: true,
    rebuild: true,
    export: true,
    import: true,
    estimateSize: true
  } as const

  private counterCount: number
  private hashes: number
  private counterBits: 8 | 16
  private counters: Uint8Array | Uint16Array
  private itemCount = 0

  constructor(options: CountingBloomFilterOptions = {}) {
    const expectedItems = options.expectedItems ?? 100_000
    const fpr = options.falsePositiveRate ?? 0.001
    this.counterCount = options.counters ?? optimalCounters(expectedItems, fpr)
    this.hashes = options.hashes ?? optimalHashes(this.counterCount, expectedItems)
    this.counterBits = options.counterBits ?? 8
    this.counters = this.counterBits === 8 ? new Uint8Array(this.counterCount) : new Uint16Array(this.counterCount)
  }

  add(key: RoomKey): boolean {
    for (const idx of indexesFor(key, this.hashes, this.counterCount)) {
      const value = this.counters[idx]!
      if (value < this.maxCounter()) this.counters[idx] = value + 1
    }
    this.itemCount++
    return true
  }

  delete(key: RoomKey): boolean {
    for (const idx of indexesFor(key, this.hashes, this.counterCount)) {
      const value = this.counters[idx]!
      if (value > 0) this.counters[idx] = value - 1
    }
    this.itemCount = Math.max(0, this.itemCount - 1)
    return true
  }

  possible(key: RoomKey): boolean {
    for (const idx of indexesFor(key, this.hashes, this.counterCount)) {
      if (this.counters[idx] === 0) return false
    }
    return true
  }

  clear(): void {
    this.counters.fill(0)
    this.itemCount = 0
  }

  rebuild(keys: Iterable<RoomKey>): void {
    this.clear()
    for (const key of keys) this.add(key)
  }

  exportPayload(): unknown {
    const raw = this.counterBits === 8 ? this.counters as Uint8Array : u16ToBytes(this.counters as Uint16Array)
    return {
      counterCount: this.counterCount,
      hashes: this.hashes,
      counterBits: this.counterBits,
      itemCount: this.itemCount,
      data: bytesToBase64(raw)
    }
  }

  importPayload(payload: unknown): void {
    const data = payload as {
      counterCount: number
      hashes: number
      counterBits?: 8 | 16
      itemCount?: number
      data: string
    }

    if (!Number.isSafeInteger(data.counterCount) || data.counterCount <= 0) {
      throw new Error('invalid counting-bloom counterCount')
    }

    if (data.counterCount > 100_000_000) {
      throw new Error('counting-bloom counterCount too large')
    }

    if (!Number.isSafeInteger(data.hashes) || data.hashes <= 0 || data.hashes > 64) {
      throw new Error('invalid counting-bloom hashes')
    }

    if (data.counterBits !== 8 && data.counterBits !== 16) {
      throw new Error('invalid counting-bloom counterBits')
    }

    const bytes = base64ToBytes(data.data)

    const expectedBytes = data.counterBits === 8
      ? data.counterCount
      : data.counterCount * 2

    if (bytes.byteLength !== expectedBytes) {
      throw new Error('invalid counting-bloom data length')
    }

    if (
      data.itemCount !== undefined &&
      (!Number.isSafeInteger(data.itemCount) || data.itemCount < 0)
    ) {
      throw new Error('invalid counting-bloom itemCount')
    }

    this.counterCount = data.counterCount
    this.hashes = data.hashes
    this.counterBits = data.counterBits
    this.counters = this.counterBits === 8 ? bytes : bytesToU16(bytes)
    this.itemCount = data.itemCount ?? 0
  }

  estimatedBytes(): number {
    return this.counters.byteLength
  }

  private maxCounter(): number {
    return this.counterBits === 8 ? 0xff : 0xffff
  }
}

export const countingBloomFilterPlugin: IndicantFilterPlugin<CountingBloomFilterOptions> = {
  type: 'counting-bloom',
  create: (options?: CountingBloomFilterOptions) => new CountingBloomFilter(options)
}
