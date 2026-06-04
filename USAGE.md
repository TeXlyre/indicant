# Indicant Usage Reference

## HTTP routes

The default base path is `/indicant`.

### Room check

```http
HEAD /indicant/rooms/:roomKey
GET  /indicant/rooms/:roomKey
```

- `204 No Content` means active or possibly active
- `404 Not Found` means not known active 

The route uses the handler's check strategy, so an embedded server on `exact` or `hybrid` responds from tracked state, while a filter-only server responds from the filter.

### POST check

```http
POST /indicant/check
Content-Type: application/json

{ "room": "hashed-room" }
```

Returns `204` or `404`. The batch form takes `{ "rooms": ["a", "b", "c"] }` and returns the rooms that are possibly present:

```json
{ "maybe": ["a", "c"], "source": "filter" }
```

### Snapshot

`GET /indicant/filter` returns a JSON snapshot holding a serialized filter, not a room list. `PUT /indicant/filter` loads a snapshot into a distribution instance. Sign this route with HMAC when the publisher and the server are separate processes.

## IndicantClient

```ts
import { IndicantClient } from 'indicant/client'

const client = new IndicantClient({ baseUrl: 'https://signal.example.com/indicant' })
```

- `check(room)`: one-room `HEAD`. Returns `true`, `false`, or `undefined` when the server reports unknown.
- `checkStrict(room)`: `POST` check. Returns a boolean.
- `checkMany(rooms)`: batch `POST`. Returns a `Set` of the rooms that are possibly present.
- `refreshSnapshot()` then `checkSnapshot(room)`: download a snapshot once, then check locally with no further requests. `checkSnapshot` returns `undefined` when there is no fresh snapshot.
- `publishSnapshot(bytes)`: push a snapshot to a server. Set `secret` on the client when the target verifies signatures.

`check` and `checkSnapshot` return `undefined` when the result is unknown. Treat `undefined` as a signal to fall back to a real join.

## Distributor

```ts
import { Distributor } from 'indicant/distributor'

const dist = new Distributor('dist-a', { ignoreExpired: true })
dist.addServer('server-1', indicant)
```

- `addServer(serverId, indicant)`: register a local embedded server.
- `createRoom(serverId, roomKey)`: add a room to one of the distributor's own servers.
- `ingestRemote(serverId, snapshot)`: record a snapshot from a server owned by someone else.
- `ingestFrom(other)`: copy every local and remote view from another distributor. Returns the number copied.
- `locate(roomKey)`: returns `LocateHit[]`, one entry per server that possibly holds the room. Each hit has `serverId` and `origin` (`'local'` or `'remote'`).
- `locateAny(roomKey)`: `true` when at least one server possibly holds the room.
- `localServerIds()` / `remoteServerIds()`: the server ids on each side.

With `ignoreExpired: true` (the default) `locate` skips remote views whose snapshot has expired.

## Filter plugin contract

A filter exports a factory returning an object that implements `MembershipFilter`:

```ts
import type { IndicantFilterPlugin, MembershipFilter, RoomKey } from 'indicant'

class MyFilter implements MembershipFilter {
  readonly type = 'my-filter'

  add(key: RoomKey): boolean { return true }
  delete(key: RoomKey): boolean { return true }
  possible(key: RoomKey): boolean { return false }
  clear(): void {}
  rebuild(keys: Iterable<RoomKey>): void {
    this.clear()
    for (const key of keys) this.add(key)
  }
  exportPayload(): unknown { return {} }
  importPayload(payload: unknown): void {}
}

export const myFilterPlugin: IndicantFilterPlugin<{ size: number }> = {
  type: 'my-filter',
  create: (options) => new MyFilter()
}
```

Register the plugin once at startup:

```ts
import { registerFilterPlugin, createIndicant } from 'indicant'
import { myFilterPlugin } from './filters/my-filter.js'

registerFilterPlugin(myFilterPlugin)

const indicant = createIndicant({
  filter: { type: 'my-filter', options: { size: 4096 } }
})
```

A distribution server that only receives snapshots needs the plugin registered but no tracking state. When `loadSnapshot(...)` receives a snapshot whose `filter` field is `my-filter`, Indicant asks the registry to create that filter and imports the payload.

Required members:

- `type`: stable type string written into snapshots.
- `possible(key)`: membership test. `false` is definitely absent, `true` is possibly present.
- `exportPayload()` / `importPayload(payload)`: snapshot serialization.

Optional members:

- `add(key)`: needed when the filter is fed lifecycle events or direct `addRoom`.
- `delete(key)`: needed for direct deletes.
- `clear()` and `rebuild(keys)`: used for tracker repair and resizing.
- `estimatedBytes()`: used for stats and reporting.
- `capabilities`: self-description for tooling.

Indicant checks capabilities at runtime and throws when a deployment calls a method the filter does not support.

## Scenarios

### Embedded in a signaling server

Use when Indicant runs in the same process as the signaling server. The server calls the lifecycle hooks directly when connections join and leave, so positives can be exact.

```ts
import http from 'node:http'
import { createIndicant, createIndicantHttpHandler } from 'indicant'

const indicant = createIndicant({
  role: 'embedded',
  checkStrategy: 'hybrid',
  filter: { type: 'cuckoo', options: { capacity: 100_000 } }
})

function onJoin(roomKey: string, socketId: string) { indicant.enter(roomKey, socketId) }
function onPart(roomKey: string, socketId: string) { indicant.leave(roomKey, socketId) }
function onDisconnect(socketId: string) { indicant.close(socketId) }

const handleIndicant = createIndicantHttpHandler(indicant, { basePath: '/indicant' })

http.createServer(async (req, res) => {
  if (await handleIndicant(req, res)) return
  res.writeHead(404).end()
}).listen(8787)
```

`hybrid` responds from tracked state when the tracker is present and falls back to the filter otherwise. Use `exact` to reject filter answers, or `filter` to skip connection tracking entirely.

### Filter-only distribution server

Use on a host that should respond to checks without holding room data. It keeps no room repository. A trusted publisher pushes filter snapshots, and the server responds from the current filter alone.

```ts
import { createIndicant, CuckooFilter } from 'indicant'

const indicant = createIndicant({
  role: 'distribution',
  tracker: false,
  checkStrategy: 'filter',
  filter: new CuckooFilter()
})

const handler = createIndicantHttpHandler(indicant, {
  basePath: '/indicant',
  secret: process.env.INDICANT_SECRET,
  defaultCheckStrategy: 'filter'
})
```

Sign `PUT /indicant/filter` and `POST /indicant/check` when those routes are not public. The publisher is an `IndicantClient` with the same secret:

```ts
const publisher = new IndicantClient({ baseUrl: 'https://edge.example.com/indicant', secret })
await publisher.publishSnapshot(embedded.snapshot(true))
```

### Client-side snapshot checks

Use when a client checks many rooms repeatedly. Download the filter once and check locally instead of making one request per room.

```ts
const client = new IndicantClient({ baseUrl: 'https://signal.example.com/indicant' })

await client.refreshSnapshot()
for (const room of candidateRooms) {
  if (client.checkSnapshot(room)) {
    // possibly active, worth a real join attempt
  }
}
```

Refresh on a timer, with a small random delay so clients do not all refresh at once. Once a snapshot expires, `checkSnapshot` returns `undefined` until the next refresh.

### Federated distributors

Use when several distributors each own a few servers and need to respond for the whole cluster. They share read-only views, so any distributor can report which servers possibly hold a room from a key it cannot reverse.

```ts
const a = new Distributor('dist-a', { ignoreExpired: false })
const b = new Distributor('dist-b', { ignoreExpired: false })

a.addServer('a-1', serverA1)
b.addServer('b-1', serverB1)

a.ingestFrom(b)
b.ingestFrom(a)

a.locate(roomKey)  // hits across a-1 (local) and b-1 (remote)
```

`example/dashboard/` runs this as a Node server with server-side state. `example/github-pages-example/` runs the same logic in the browser as a static site.

## HMAC authentication

Set a shared secret on both the handler and the client, then sign each request with:

- `x-indicant-timestamp`: Unix epoch milliseconds.
- `x-indicant-signature`: `sha256=<hex hmac>`.

The HMAC covers `METHOD\nPATH\nTIMESTAMP\nBODY`. The signed `PATH` is the full request path including the base, for example `/indicant/filter`. Requests outside the allowed clock skew are rejected.