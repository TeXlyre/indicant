export type RoomKey = string
export type ConnectionId = string
export type PresenceRole = 'active' | 'observer'
export type IndicantRole = 'embedded' | 'distribution'
export type IndicantCheckStrategy = 'exact' | 'filter' | 'hybrid'

export interface EnterOptions {
  role?: PresenceRole
}

export interface IndicantCheck {
  room: RoomKey
  present: boolean
  source: 'exact' | 'filter'
}

export interface IndicantSnapshotEnvelope {
  indicant: 1
  filter: string
  generation: number
  createdAt: number
  expiresAt: number
  payload: unknown
}

export interface SnapshotMeta {
  filter: string
  generation: number
  createdAt: number
  expiresAt: number
  bytes: number
}

export interface IndicantOptions {
  role?: IndicantRole
  checkStrategy?: IndicantCheckStrategy
  ttlMs?: number
  snapshotTtlMs?: number
  snapshotIntervalMs?: number
  filter?: import('./filters/index.js').FilterSpec
  filterRegistry?: import('./filters/index.js').FilterRegistry
  tracker?: boolean
}

export interface IndicantStats {
  role: IndicantRole
  checkStrategy: IndicantCheckStrategy
  activeRooms?: number
  activeConnections?: number
  generation: number
  filterType: string
  snapshotFresh: boolean
  snapshotExpiresAt: number
}