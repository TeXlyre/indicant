import { bytesToBase64, base64ToBytes } from '../utils/base64.js'
import { indexesFor } from '../utils/hash.js'
import type { IndicantFilterPlugin, MembershipFilter } from './index.js'
import type { RoomKey } from '../types.js'

export interface BloomFilterOptions {
  expectedItems?: number
  falsePositiveRate?: number
  bits?: number
  hashes?: number
}

function optimalBits(n: number, p: number): number {
  return Math.max(8, Math.ceil(-(n * Math.log(p)) / (Math.LN2 ** 2)))
}

function optimalHashes(bits: number, n: number): number {
  return Math.max(1, Math.round((bits / Math.max(1, n)) * Math.LN2))
}

export class BloomFilter implements MembershipFilter {
  readonly type = 'bloom'
  readonly capabilities = { add: true, delete: true, clear: true, rebuild: true, export: true, import: true, estimateSize: true } as const
  private bitLength: number
  private hashes: number
  private bytes: Uint8Array
  private keysForRebuild = new Set<RoomKey>()

  constructor(options: BloomFilterOptions = {}) {
    const expectedItems = options.expectedItems ?? 100_000
    const fpr = options.falsePositiveRate ?? 0.001
    this.bitLength = options.bits ?? optimalBits(expectedItems, fpr)
    this.hashes = options.hashes ?? optimalHashes(this.bitLength, expectedItems)
    this.bytes = new Uint8Array(Math.ceil(this.bitLength / 8))
  }

  add(key: RoomKey): boolean {
    this.keysForRebuild.add(key)
    for (const idx of indexesFor(key, this.hashes, this.bitLength)) this.setBit(idx)
    return true
  }

  delete(key: RoomKey): boolean {
    this.keysForRebuild.delete(key)
    this.rebuild(this.keysForRebuild)
    return true
  }

  possible(key: RoomKey): boolean {
    for (const idx of indexesFor(key, this.hashes, this.bitLength)) {
      if (!this.getBit(idx)) return false
    }
    return true
  }

  clear(): void {
    this.bytes.fill(0)
    this.keysForRebuild.clear()
  }

  rebuild(keys: Iterable<RoomKey>): void {
    const saved = [...keys]
    this.bytes.fill(0)
    this.keysForRebuild = new Set(saved)
    for (const key of saved) {
      for (const idx of indexesFor(key, this.hashes, this.bitLength)) this.setBit(idx)
    }
  }

  exportPayload(): unknown {
    return { bitLength: this.bitLength, hashes: this.hashes, data: bytesToBase64(this.bytes) }
  }

  importPayload(payload: unknown): void {
    const data = payload as { bitLength: number; hashes: number; data: string }
    if (!Number.isInteger(data.bitLength) || data.bitLength <= 0) throw new Error('invalid bloom bitLength')
    if (!Number.isInteger(data.hashes) || data.hashes <= 0) throw new Error('invalid bloom hashes')
    this.bitLength = data.bitLength
    this.hashes = data.hashes
    this.bytes = base64ToBytes(data.data)
    this.keysForRebuild.clear()
  }

  estimatedBytes(): number {
    return this.bytes.byteLength
  }

  private setBit(index: number): void {
    const byte = index >>> 3
    const mask = 1 << (index & 7)
    this.bytes[byte]! |= mask
  }

  private getBit(index: number): boolean {
    const byte = index >>> 3
    const mask = 1 << (index & 7)
    return (this.bytes[byte]! & mask) !== 0
  }
}

export const bloomFilterPlugin: IndicantFilterPlugin<BloomFilterOptions> = {
  type: 'bloom',
  create: (options?: BloomFilterOptions) => new BloomFilter(options)
}
