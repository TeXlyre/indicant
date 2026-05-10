import type { IndicantFilterPlugin, MembershipFilter } from './index.js'
import type { RoomKey } from '../types.js'

export class ExactSetFilter implements MembershipFilter {
  readonly type = 'exact-set'
  readonly capabilities = { add: true, delete: true, clear: true, rebuild: true, export: true, import: true, estimateSize: true } as const
  private readonly set = new Set<RoomKey>()

  add(key: RoomKey): boolean {
    this.set.add(key)
    return true
  }

  delete(key: RoomKey): boolean {
    this.set.delete(key)
    return true
  }

  possible(key: RoomKey): boolean {
    return this.set.has(key)
  }

  clear(): void {
    this.set.clear()
  }

  rebuild(keys: Iterable<RoomKey>): void {
    this.clear()
    for (const key of keys) this.set.add(key)
  }

  exportPayload(): unknown {
    return { keys: [...this.set] }
  }

  importPayload(payload: unknown): void {
    const data = payload as { keys?: string[] }
    this.clear()
    for (const key of data.keys ?? []) this.set.add(key)
  }

  estimatedBytes(): number {
    const encoder = new TextEncoder()
    let total = 0
    for (const key of this.set) total += encoder.encode(key).length
    return total
  }
}

export const exactSetFilterPlugin: IndicantFilterPlugin = {
  type: 'exact-set',
  create: () => new ExactSetFilter()
}
