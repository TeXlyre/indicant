# Indicant

Indicant is a room-presence layer that lets clients check whether a room is active before joining a signaling server.

A signaling server reports when connections enter and leave rooms. Indicant stores that activity in a membership index and uses it to report whether a room is active. Clients check before joining and skip the join when the room is inactive. The index is approximate, so a positive result means "active, or possibly active" and a negative result means "not known to be active."

## Install

```bash
npm install indicant
```

## API

### createIndicant(options)

Creates an Indicant instance.

```ts
import { createIndicant } from 'indicant'

const indicant = createIndicant({ role: 'embedded', checkStrategy: 'hybrid' })
```

Options: `role` (`embedded` | `distribution`), `checkStrategy` (`exact` | `filter` | `hybrid`), `filter` (a filter spec or instance), `tracker` (lifecycle tracking; on by default for embedded).

Lifecycle and queries:

```ts
indicant.enter(roomKey, connectionId)   // a connection joined a room
indicant.leave(roomKey, connectionId)   // a connection left a room
indicant.close(connectionId)            // a connection dropped entirely

const result = indicant.check(roomKey)  // { room, present, source }
```

`check` returns an `IndicantCheck`. `present` is the result; `source` is `'exact'` when it came from tracked state and `'filter'` when it came from the membership index. A `present: true` from `'exact'` is certain. A `present: true` from `'filter'` can be a false positive, at the filter's configured rate.

### createIndicantHttpHandler(indicant, options)

Returns an async `(req, res) => Promise<boolean>` handler. It handles Indicant routes and returns `false` for everything else, so you can add it to an existing server.

```ts
import http from 'node:http'
import { createIndicant, createIndicantHttpHandler } from 'indicant'

const indicant = createIndicant({
  role: 'embedded',
  checkStrategy: 'hybrid',
  filter: { type: 'cuckoo', options: { capacity: 100_000 } }
})

const handleIndicant = createIndicantHttpHandler(indicant, { basePath: '/indicant' })

http.createServer(async (req, res) => {
  if (await handleIndicant(req, res)) return
  res.writeHead(404).end()
}).listen(8787)
```

Options: `basePath`, `secret` (turns on HMAC verification), `exposeStats`, `exposeSnapshot`, `defaultCheckStrategy`. Routes: `HEAD`/`GET /rooms/:room`, `POST /check`, `GET`/`PUT /filter`.

A client checks a room with `HEAD /indicant/rooms/:room`. `204` means active or possibly active; `404` means not known active.

### IndicantClient

Sends requests to a remote Indicant server. Pass a `secret` when the target server verifies signatures.

```ts
import { IndicantClient } from 'indicant/client'

const client = new IndicantClient({ baseUrl: 'https://signal.example.com/indicant' })

await client.check('hashed-room')        // true | false | undefined
await client.checkStrict('hashed-room')  // boolean
await client.checkMany(['a', 'b', 'c'])  // Set<RoomKey>

await client.refreshSnapshot()
client.checkSnapshot('hashed-room')      // boolean | undefined when no fresh snapshot

await client.publishSnapshot(snapshotBytes)
```

`check` does a one-room `HEAD` and returns `undefined` when the server reports unknown. `checkStrict` does a `POST` and returns a plain boolean. `checkMany` batches. `checkSnapshot` runs against a snapshot the client downloaded earlier, with no network call.

### Distributor

A distributor sits in front of several embedded servers and reports which of them possibly holds a room, using only filter snapshots.

```ts
import { Distributor } from 'indicant/distributor'

const dist = new Distributor('dist-a')
dist.addServer('server-1', indicant)

dist.locate(roomKey)     // LocateHit[]  -> [{ serverId, origin }]
dist.locateAny(roomKey)  // boolean
```

`locate` returns one `LocateHit` per server that possibly holds the room; `origin` is `'local'` for a server the distributor owns and `'remote'` for one it learned about through federation. `locateAny` returns a single boolean instead of the list.

### Filter plugins

A filter implements `MembershipFilter` and registers as an `IndicantFilterPlugin`. Registration makes the type available to embedded servers, distribution servers, and clients loading snapshots of that type. Built-in types: `cuckoo`, `bloom`, `counting-bloom`, `exact-set`.

```ts
import { registerFilterPlugin, type IndicantFilterPlugin } from 'indicant'

export const myFilterPlugin: IndicantFilterPlugin<{ size: number }> = {
  type: 'my-filter',
  create: (options) => new MyFilter(options)
}

registerFilterPlugin(myFilterPlugin)
```

The membership test is `possible(key)`: `false` means definitely absent, `true` means possibly present. See [USAGE.md](USAGE.md) for the full contract.

## How it works

Indicant keeps room tracking separate from membership checking:

```text
signaling server hooks
  -> Indicant tracker (optional)
  -> pluggable membership filter
  -> HTTP / client check strategies
```

The signaling server only reports `enter`, `leave`, and `close`. It does not need to know which filter is installed or where a result came from.

- **Tracker** (optional): maps connections to rooms and rooms to connections, with `active` and `observer` roles. Observers are kept for cleanup but stay out of the presence count, so a probe client does not count as real presence
- **Filter**: the membership index. Cuckoo is the default and supports deletes; counting Bloom deletes without keeping keys; plain Bloom rebuilds from known keys to delete; exact-set is for tests and trusted local use
- **Checker**: picks a result by strategy. `exact` reads tracker state, `filter` reads the index only, `hybrid` prefers the tracker and falls back to the filter. An untrusted distribution server should use `filter` and run without a tracker
- **Snapshot**: a serialized copy of the filter. Serve it to clients or push it to a distribution server so they can respond to queries while holding no room data of their own

## Examples

Runnable servers are in [`example/`](example):

```bash
npx tsx example/simple-indicant-server.ts    # one embedded server
npx tsx example/dashboard/server.ts          # distributor demo with double-hashed keys
```

The dashboard on `http://localhost:8788` puts several embedded servers on one distributor. The browser hashes a room UUID locally, and the distributor reports which servers possibly hold it while only seeing the hashed key.

See [USAGE.md](USAGE.md) for the full HTTP and client reference, deployment scenarios, and the filter plugin contract.

## License

MIT License. See [LICENSE](LICENSE) for details.