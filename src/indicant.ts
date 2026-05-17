import {
  createFilter,
  defaultFilterRegistry,
  rebuildFilter,
  requireFilterAdd,
  requireFilterDelete,
  snapshotFilter,
  type FilterRegistry,
  type MembershipFilter
} from './filters/index.js'
import { RoomTracker } from './tracker.js'
import type {
  ConnectionId,
  EnterOptions,
  IndicantCheck,
  IndicantCheckStrategy,
  IndicantOptions,
  IndicantRole,
  IndicantSnapshotEnvelope,
  IndicantStats,
  RoomKey,
  SnapshotMeta
} from './types.js'
import { jsonBytes, parseJsonBytes } from './utils/base64.js'

export class Indicant {
  readonly role: IndicantRole
  readonly checkStrategy: IndicantCheckStrategy
  private _filter: MembershipFilter
  readonly tracker?: RoomTracker
  private readonly filterRegistry: FilterRegistry

  private generation = 0
  private dirty = true
  private currentSnapshot?: IndicantSnapshotEnvelope
  private currentSnapshotBytes?: Uint8Array
  private readonly snapshotTtlMs: number
  private readonly snapshotIntervalMs: number
  private lastSnapshotAt = 0

  get filter(): MembershipFilter {
    return this._filter
  }

  constructor(options: IndicantOptions = {}) {
    this.role = options.role ?? 'embedded'
    this.checkStrategy = options.checkStrategy ?? (this.role === 'embedded' ? 'hybrid' : 'filter')
    this.filterRegistry = options.filterRegistry ?? defaultFilterRegistry
    this._filter = createFilter(options.filter, this.filterRegistry)
    const trackerEnabled = options.tracker ?? this.role === 'embedded'
    if (trackerEnabled) this.tracker = new RoomTracker()
    this.snapshotTtlMs = options.snapshotTtlMs ?? 5_000
    this.snapshotIntervalMs = options.snapshotIntervalMs ?? 1_000
  }

  enter(room: RoomKey, connection: ConnectionId, options: EnterOptions = {}): void {
    this.requireTracker()
    const result = this.tracker.enter(room, connection, options)
    if (result.activated) {
      requireFilterAdd(this._filter)(room)
      this.bump()
    }
  }

  leave(room: RoomKey, connection: ConnectionId): void {
    this.requireTracker()
    const result = this.tracker.leave(room, connection)
    if (result.deactivated) {
      requireFilterDelete(this._filter)(room)
      this.bump()
    }
  }

  close(connection: ConnectionId): void {
    this.requireTracker()
    for (const room of this.tracker.close(connection)) {
      requireFilterDelete(this._filter)(room)
      this.bump()
    }
  }

  addRoom(room: RoomKey): void {
    requireFilterAdd(this._filter)(room)
    this.bump()
  }

  deleteRoom(room: RoomKey): void {
    requireFilterDelete(this._filter)(room)
    this.bump()
  }

  check(room: RoomKey, strategy: IndicantCheckStrategy = this.checkStrategy): IndicantCheck {
    if (strategy === 'exact') {
      if (!this.tracker) throw new Error('exact checks require tracker state')
      return { room, present: this.tracker.hasActive(room), source: 'exact' }
    }
    if (strategy === 'filter') {
      return { room, present: this._filter.possible(room), source: 'filter' }
    }
    if (this.tracker) return { room, present: this.tracker.hasActive(room), source: 'exact' }
    return { room, present: this._filter.possible(room), source: 'filter' }
  }

  checkMany(rooms: readonly RoomKey[], strategy: IndicantCheckStrategy = this.checkStrategy): IndicantCheck[] {
    return rooms.map((room) => this.check(room, strategy))
  }

  rebuildFromTracker(): void {
    this.requireTracker()
    rebuildFilter(this._filter, this.tracker.activeRooms())
    this.bump()
  }

  snapshot(force = false): Uint8Array {
    const now = Date.now()
    if (!force && this.currentSnapshotBytes && !this.dirty && now - this.lastSnapshotAt < this.snapshotIntervalMs) {
      return this.currentSnapshotBytes
    }
    this.currentSnapshot = snapshotFilter(this._filter, this.generation, this.snapshotTtlMs)
    this.currentSnapshotBytes = jsonBytes(this.currentSnapshot)
    this.lastSnapshotAt = now
    this.dirty = false
    return this.currentSnapshotBytes
  }

  snapshotEnvelope(force = false): IndicantSnapshotEnvelope {
    this.snapshot(force)
    return this.currentSnapshot!
  }

  loadSnapshot(bytes: Uint8Array): void {
    const snapshot = parseJsonBytes<IndicantSnapshotEnvelope>(bytes)
    this._filter = this.filterRegistry.loadSnapshot(snapshot, this._filter)
    this.currentSnapshot = snapshot
    this.currentSnapshotBytes = bytes
    this.generation = snapshot.generation
    this.lastSnapshotAt = Date.now()
    this.dirty = false
  }

  loadSnapshotEnvelope(snapshot: IndicantSnapshotEnvelope): void {
    this._filter = this.filterRegistry.loadSnapshot(snapshot, this._filter)
    this.currentSnapshot = snapshot
    this.currentSnapshotBytes = jsonBytes(snapshot)
    this.generation = snapshot.generation
    this.lastSnapshotAt = Date.now()
    this.dirty = false
  }

  snapshotFresh(): boolean {
    const snap = this.currentSnapshot
    return !!snap && Date.now() <= snap.expiresAt
  }

  snapshotMeta(): SnapshotMeta {
    const bytes = this.snapshot()
    const snap = this.currentSnapshot!
    return {
      filter: snap.filter,
      generation: snap.generation,
      createdAt: snap.createdAt,
      expiresAt: snap.expiresAt,
      bytes: bytes.byteLength
    }
  }

  stats(): IndicantStats {
    const out: IndicantStats = {
      role: this.role,
      checkStrategy: this.checkStrategy,
      generation: this.generation,
      filterType: this._filter.type,
      snapshotFresh: this.snapshotFresh(),
      snapshotExpiresAt: this.currentSnapshot?.expiresAt ?? 0
    }
    if (this.tracker) {
      out.activeRooms = this.tracker.activeRoomCount()
      out.activeConnections = this.tracker.activeConnectionCount()
    }
    return out
  }

  private bump(): void {
    this.generation++
    this.dirty = true
  }

  private requireTracker(): asserts this is this & { tracker: RoomTracker } {
    if (!this.tracker) throw new Error('this Indicant instance has no tracker; use addRoom/deleteRoom or loadSnapshot')
  }
}

export function createIndicant(options: IndicantOptions = {}): Indicant {
  return new Indicant(options)
}
