import { bytesToBase64, base64ToBytes } from '../utils/base64.js'
import { hash64, nextPowerOfTwo } from '../utils/hash.js'
import type { IndicantFilterPlugin, MembershipFilter } from './index.js'
import type { RoomKey } from '../types.js'

export interface CuckooFilterOptions {
  capacity?: number
  bucketSize?: number
  fingerprintBits?: number
  maxKicks?: number
}

function u32Bytes(values: Uint32Array): Uint8Array {
  return new Uint8Array(values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength))
}

function bytesToU32(bytes: Uint8Array): Uint32Array {
  const copy = new Uint8Array(bytes)
  return new Uint32Array(copy.buffer)
}

export class CuckooFilter implements MembershipFilter {
  readonly type = 'cuckoo'
  readonly capabilities = { add: true, delete: true, clear: true, rebuild: true, export: true, import: true, estimateSize: true } as const
  private bucketCount: number
  private bucketSize: number
  private fingerprintBits: number
  private fingerprintMask: number
  private maxKicks: number
  private table: Uint32Array
  private itemCount = 0
  private keysForRepair = new Set<RoomKey>()

  constructor(options: CuckooFilterOptions = {}) {
    const capacity = Math.max(1, options.capacity ?? 100_000)
    this.bucketSize = options.bucketSize ?? 4
    this.fingerprintBits = options.fingerprintBits ?? 16
    if (this.fingerprintBits < 4 || this.fingerprintBits > 30) {
      throw new Error('fingerprintBits must be in 4..30')
    }
    this.fingerprintMask = (2 ** this.fingerprintBits) - 1
    this.maxKicks = options.maxKicks ?? 500
    this.bucketCount = nextPowerOfTwo(Math.ceil(capacity / (this.bucketSize * 0.84)))
    this.table = new Uint32Array(this.bucketCount * this.bucketSize)
  }

  add(key: RoomKey): boolean {
    if (this.possible(key)) {
      this.keysForRepair.add(key)
      return true
    }
    const fp = this.fingerprint(key)
    const i1 = this.index1(key)
    const i2 = this.index2(i1, fp)
    if (this.insertInBucket(i1, fp) || this.insertInBucket(i2, fp)) {
      this.itemCount++
      this.keysForRepair.add(key)
      return true
    }
    let index = (Number(hash64(key, 0xa5a5a5a5) & 1n) === 0) ? i1 : i2
    let cur = fp
    for (let kick = 0; kick < this.maxKicks; kick++) {
      const slot = this.bucketSlot(index, Number(hash64(`${key}:${kick}`, 0x51ed270b) % BigInt(this.bucketSize)))
      const evicted = this.table[slot]!
      this.table[slot] = cur
      cur = evicted
      index = this.index2(index, cur)
      if (this.insertInBucket(index, cur)) {
        this.itemCount++
        this.keysForRepair.add(key)
        return true
      }
    }
    this.growAndRebuild([...this.keysForRepair, key])
    return this.possible(key)
  }

  delete(key: RoomKey): boolean {
    const fp = this.fingerprint(key)
    const i1 = this.index1(key)
    const i2 = this.index2(i1, fp)
    const deleted = this.deleteFromBucket(i1, fp) || this.deleteFromBucket(i2, fp)
    this.keysForRepair.delete(key)
    if (deleted) this.itemCount = Math.max(0, this.itemCount - 1)
    return true
  }

  possible(key: RoomKey): boolean {
    const fp = this.fingerprint(key)
    const i1 = this.index1(key)
    const i2 = this.index2(i1, fp)
    return this.bucketContains(i1, fp) || this.bucketContains(i2, fp)
  }

  clear(): void {
    this.table.fill(0)
    this.itemCount = 0
    this.keysForRepair.clear()
  }

  rebuild(keys: Iterable<RoomKey>): void {
    const saved = [...keys]
    this.table.fill(0)
    this.itemCount = 0
    this.keysForRepair.clear()
    for (const key of saved) this.add(key)
  }

  exportPayload(): unknown {
    return {
      bucketCount: this.bucketCount,
      bucketSize: this.bucketSize,
      fingerprintBits: this.fingerprintBits,
      itemCount: this.itemCount,
      table: bytesToBase64(u32Bytes(this.table))
    }
  }

  importPayload(payload: unknown): void {
    const data = payload as {
      bucketCount: number
      bucketSize: number
      fingerprintBits: number
      itemCount?: number
      table: string
    }
    if (!Number.isInteger(data.bucketCount) || data.bucketCount <= 0) throw new Error('invalid cuckoo bucketCount')
    if (!Number.isInteger(data.bucketSize) || data.bucketSize <= 0) throw new Error('invalid cuckoo bucketSize')
    if (!Number.isInteger(data.fingerprintBits) || data.fingerprintBits < 4 || data.fingerprintBits > 30) {
      throw new Error('invalid cuckoo fingerprintBits')
    }
    this.bucketCount = data.bucketCount
    this.bucketSize = data.bucketSize
    this.fingerprintBits = data.fingerprintBits
    this.fingerprintMask = (2 ** this.fingerprintBits) - 1
    this.table = bytesToU32(base64ToBytes(data.table))
    this.itemCount = data.itemCount ?? 0
    this.keysForRepair.clear()
  }

  estimatedBytes(): number {
    return this.table.byteLength
  }

  private growAndRebuild(keys: RoomKey[]): void {
    this.bucketCount *= 2
    this.table = new Uint32Array(this.bucketCount * this.bucketSize)
    this.itemCount = 0
    this.keysForRepair.clear()
    for (const key of keys) this.add(key)
  }

  private fingerprint(key: RoomKey): number {
    const fp = Number(hash64(key, 0x27d4eb2d) & BigInt(this.fingerprintMask))
    return fp === 0 ? 1 : fp
  }

  private index1(key: RoomKey): number {
    return Number(hash64(key, 0x165667b1) & BigInt(this.bucketCount - 1))
  }

  private index2(index: number, fp: number): number {
    return Number((BigInt(index) ^ (hash64(String(fp), 0x9e3779b9) & BigInt(this.bucketCount - 1))) & BigInt(this.bucketCount - 1))
  }

  private bucketSlot(bucket: number, offset: number): number {
    return bucket * this.bucketSize + offset
  }

  private bucketContains(bucket: number, fp: number): boolean {
    for (let i = 0; i < this.bucketSize; i++) {
      if (this.table[this.bucketSlot(bucket, i)] === fp) return true
    }
    return false
  }

  private insertInBucket(bucket: number, fp: number): boolean {
    for (let i = 0; i < this.bucketSize; i++) {
      const slot = this.bucketSlot(bucket, i)
      if (this.table[slot] === 0) {
        this.table[slot] = fp
        return true
      }
    }
    return false
  }

  private deleteFromBucket(bucket: number, fp: number): boolean {
    for (let i = 0; i < this.bucketSize; i++) {
      const slot = this.bucketSlot(bucket, i)
      if (this.table[slot] === fp) {
        this.table[slot] = 0
        return true
      }
    }
    return false
  }
}

export const cuckooFilterPlugin: IndicantFilterPlugin<CuckooFilterOptions> = {
  type: 'cuckoo',
  create: (options?: CuckooFilterOptions) => new CuckooFilter(options)
}
