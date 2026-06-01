import { loadFilterSnapshot, defaultFilterRegistry, type FilterRegistry, type MembershipFilter } from './filters/index.js'
import type { Indicant } from './indicant.js'
import type { IndicantClient } from './client.js'
import type { IndicantSnapshotEnvelope, RoomKey } from './types.js'

export type ServerId = string

export interface LocateHit {
    serverId: ServerId
    origin: 'local' | 'remote'
}

interface RemoteView {
    filter: MembershipFilter
    snapshot: IndicantSnapshotEnvelope
}

export interface DistributorOptions {
    filterRegistry?: FilterRegistry
    ignoreExpired?: boolean
}

export class Distributor {
    readonly distributorId: string
    private readonly filterRegistry: FilterRegistry
    private readonly ignoreExpired: boolean
    private readonly local = new Map<ServerId, Indicant>()
    private readonly remote = new Map<ServerId, RemoteView>()

    constructor(distributorId: string, options: DistributorOptions = {}) {
        this.distributorId = distributorId
        this.filterRegistry = options.filterRegistry ?? defaultFilterRegistry
        this.ignoreExpired = options.ignoreExpired ?? true
    }

    addServer(serverId: ServerId, indicant: Indicant): void {
        this.local.set(serverId, indicant)
    }

    ownsServer(serverId: ServerId): boolean {
        return this.local.has(serverId)
    }

    createRoom(serverId: ServerId, room: RoomKey): void {
        const indicant = this.local.get(serverId)
        if (!indicant) throw new Error(`distributor ${this.distributorId} does not own server ${serverId}`)
        indicant.addRoom(room)
    }

    ingestRemote(serverId: ServerId, snapshot: Uint8Array | IndicantSnapshotEnvelope): void {
        if (this.local.has(serverId)) return
        const envelope = snapshot instanceof Uint8Array
            ? JSON.parse(new TextDecoder().decode(snapshot)) as IndicantSnapshotEnvelope
            : snapshot
        const filter = this.filterRegistry.create(envelope.filter)
        loadFilterSnapshot(filter, envelope)
        this.remote.set(serverId, { filter, snapshot: envelope })
    }

    ingestFrom(other: Distributor): number {
        let count = 0
        for (const [serverId, indicant] of other.local) {
            this.ingestRemote(serverId, indicant.snapshotEnvelope(true))
            count++
        }
        for (const [serverId, view] of other.remote) {
            this.ingestRemote(serverId, view.snapshot)
            count++
        }
        return count
    }

    locate(room: RoomKey): LocateHit[] {
        const now = Date.now()
        const hits: LocateHit[] = []
        for (const [serverId, indicant] of this.local) {
            if (indicant.check(room, 'filter').present) hits.push({ serverId, origin: 'local' })
        }
        for (const [serverId, view] of this.remote) {
            if (this.ignoreExpired && now > view.snapshot.expiresAt) continue
            if (view.filter.possible(room)) hits.push({ serverId, origin: 'remote' })
        }
        return hits
    }

    locateAny(room: RoomKey): boolean {
        return this.locate(room).length > 0
    }

    localServerIds(): ServerId[] {
        return [...this.local.keys()]
    }

    remoteServerIds(): ServerId[] {
        return [...this.remote.keys()]
    }
}

export interface SnapshotSource {
    serverId: ServerId
    client: IndicantClient
}

export async function pollSnapshots(distributor: Distributor, sources: readonly SnapshotSource[]): Promise<void> {
    await Promise.all(sources.map(async ({ serverId, client }) => {
        await client.refreshSnapshot()
        const snapshot = client.currentSnapshot()
        if (snapshot) distributor.ingestRemote(serverId, snapshot)
    }))
}
