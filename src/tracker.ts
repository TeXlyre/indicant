import type { ConnectionId, EnterOptions, PresenceRole, RoomKey } from './types.js'

export class RoomTracker {
  private readonly roomActiveConnections = new Map<RoomKey, Set<ConnectionId>>()
  private readonly roomObserverConnections = new Map<RoomKey, Set<ConnectionId>>()
  private readonly connectionRooms = new Map<ConnectionId, Map<RoomKey, PresenceRole>>()

  enter(room: RoomKey, connection: ConnectionId, options: EnterOptions = {}): { activated: boolean } {
    const role = options.role ?? 'active'
    const perConn = this.connectionRooms.get(connection) ?? new Map<RoomKey, PresenceRole>()
    const prior = perConn.get(room)
    if (prior === role) return { activated: false }
    if (prior) this.leave(room, connection)

    perConn.set(room, role)
    this.connectionRooms.set(connection, perConn)

    if (role === 'observer') {
      const observers = this.roomObserverConnections.get(room) ?? new Set<ConnectionId>()
      observers.add(connection)
      this.roomObserverConnections.set(room, observers)
      return { activated: false }
    }

    const active = this.roomActiveConnections.get(room) ?? new Set<ConnectionId>()
    const wasInactive = active.size === 0
    active.add(connection)
    this.roomActiveConnections.set(room, active)
    return { activated: wasInactive }
  }

  leave(room: RoomKey, connection: ConnectionId): { deactivated: boolean } {
    const perConn = this.connectionRooms.get(connection)
    const role = perConn?.get(room)
    if (!role) return { deactivated: false }
    perConn!.delete(room)
    if (perConn!.size === 0) this.connectionRooms.delete(connection)

    if (role === 'observer') {
      const observers = this.roomObserverConnections.get(room)
      observers?.delete(connection)
      if (observers?.size === 0) this.roomObserverConnections.delete(room)
      return { deactivated: false }
    }

    const active = this.roomActiveConnections.get(room)
    active?.delete(connection)
    const deactivated = !active || active.size === 0
    if (deactivated) this.roomActiveConnections.delete(room)
    return { deactivated }
  }

  close(connection: ConnectionId): RoomKey[] {
    const perConn = this.connectionRooms.get(connection)
    if (!perConn) return []
    const deactivated: RoomKey[] = []
    for (const room of [...perConn.keys()]) {
      const result = this.leave(room, connection)
      if (result.deactivated) deactivated.push(room)
    }
    return deactivated
  }

  hasActive(room: RoomKey): boolean {
    return (this.roomActiveConnections.get(room)?.size ?? 0) > 0
  }

  activeRooms(): Iterable<RoomKey> {
    return this.roomActiveConnections.keys()
  }

  activeRoomCount(): number {
    return this.roomActiveConnections.size
  }

  activeConnectionCount(): number {
    return this.connectionRooms.size
  }
}
