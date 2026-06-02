# Indicant distribution dashboard

A real multi-process distribution cluster. Each embedded server runs in its own
worker thread with an HTTP listener; distributors federate by polling every
server's `GET /filter` over HTTP and answer `locate` from the snapshots they
have pulled. No shared in-memory state, no oracle.

## Run

```bash
npm install
npm run build
npm start
```

Then open `http://localhost:8788`.

`npm run build` compiles `../../src`, this server, and the worker to `dist/`.
The example runs as built JavaScript with `node` rather than through a TypeScript
loader, because Node worker threads do not inherit a loader such as `tsx`, and a
real distribution deployment ships compiled servers regardless.

## What is real

- Each server is a worker thread running `createIndicantHttpHandler` on its own port.
- Room creation calls the in-process signaling lifecycle hook (`indicant.enter`)
  inside the owning worker. The stock HTTP handler exposes no add-room route, so
  this matches how a signaling server registers presence.
- Federation is `pollSnapshots` over real HTTP via `IndicantClient`.
- A distributor owns no rooms locally, so every hit is a remote snapshot match;
  the UI labels it that way.
