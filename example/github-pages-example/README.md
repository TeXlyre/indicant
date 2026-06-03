# GitHub Pages Demo for Indicant

A browser-only demo of Indicant's multi-distributor room discovery. Each embedded
server runs in its own Web Worker that owns a real Indicant instance; distributors
federate by polling each worker for its snapshot through `IndicantClient` and
answer `locate` from the snapshots they have pulled.

The snapshot bytes, serialization, ingestion, and expiry are the real library.
The only unreal part is the transport: a worker `postMessage` stands in for the
HTTP socket, because a static page cannot open ports.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Build for GitHub Pages

```bash
npm run build
```

Emits to `dist/` with `publicPath: /indicant/`, matching
`https://texlyre.github.io/indicant/`.

## Difference from the server example

`example/dashboard/` runs the same logic as real worker-thread HTTP servers
federated over actual HTTP — the deployment shape Indicant targets. This page
runs the library client-side so it can be hosted as a static site.
