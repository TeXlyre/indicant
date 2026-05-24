import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Indicant } from '../indicant.js'
import type { IndicantCheckStrategy, RoomKey } from '../types.js'
import { verifyIndicantRequest, type IndicantAuthOptions } from './auth.js'

export interface IndicantHttpOptions extends IndicantAuthOptions {
  basePath?: string
  allowPostChecks?: boolean
  exposeStats?: boolean
  exposeSnapshot?: boolean
  defaultCheckStrategy?: IndicantCheckStrategy
}

async function readBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<Uint8Array> {
  const chunks: any[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.byteLength
    if (total > maxBytes) throw new Error('request body too large')
    chunks.push(buf)
  }
  return Uint8Array.from(Buffer.concat(chunks))
}

function send(res: ServerResponse, status: number, body?: string | Uint8Array, headers: Record<string, string> = {}, method = 'GET'): void {
  res.writeHead(status, headers)
  if (body && method !== 'HEAD') res.end(body)
  else res.end()
}

function json(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8' })
}

function normalizeBase(basePath: string): string {
  if (!basePath || basePath === '/') return ''
  return basePath.startsWith('/') ? basePath.replace(/\/$/, '') : `/${basePath.replace(/\/$/, '')}`
}

function pathRoom(raw: string, base: string): RoomKey | undefined {
  const prefix = `${base}/rooms/`
  if (!raw.startsWith(prefix)) return undefined
  const encoded = raw.slice(prefix.length)
  if (!encoded) return undefined
  return decodeURIComponent(encoded)
}

export function createIndicantHttpHandler(indicant: Indicant, options: IndicantHttpOptions = {}) {
  const base = normalizeBase(options.basePath ?? '/indicant')
  const allowPostChecks = options.allowPostChecks ?? true
  const exposeStats = options.exposeStats ?? false
  const exposeSnapshot = options.exposeSnapshot ?? true
  const defaultCheckStrategy = options.defaultCheckStrategy

  return async function indicantHttpHandler(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://indicant.local')
    const path = url.pathname.replace(/\/$/, '') || '/'
    const method = req.method ?? 'GET'

    if (exposeSnapshot && method === 'GET' && path === `${base}/filter`) {
      const snap = indicant.snapshot()
      const meta = indicant.snapshotMeta()
      send(res, 200, snap, {
        'content-type': 'application/vnd.indicant.snapshot+json',
        'cache-control': 'max-age=1, stale-while-revalidate=5',
        etag: `"indicant-${meta.generation}"`,
        'x-indicant-generation': String(meta.generation),
        'x-indicant-expires-at': String(meta.expiresAt)
      }, method)
      return true
    }

    if (exposeStats && method === 'GET' && path === `${base}/stats`) {
      json(res, 200, indicant.stats())
      return true
    }

    const room = pathRoom(path, base)
    if (room && (method === 'GET' || method === 'HEAD')) {
      try {
        const result = indicant.check(room, defaultCheckStrategy)
        send(res, result.present ? 204 : 404, undefined, {}, method)
      } catch (err) {
        json(res, 500, {
          error: err instanceof Error ? err.message : 'Indicant check failed'
        })
      }
      return true
    }

    if (allowPostChecks && method === 'POST' && path === `${base}/check`) {
      let body: Uint8Array
      try {
        body = await readBody(req)
      } catch (err) {
        json(res, 413, { error: err instanceof Error ? err.message : 'request too large' })
        return true
      }
      if (!verifyIndicantRequest(req, path, body, options)) {
        json(res, 401, { error: 'invalid Indicant signature' })
        return true
      }
      let parsed: { room?: string; rooms?: string[] }
      try {
        parsed = JSON.parse(Buffer.from(body).toString('utf8')) as { room?: string; rooms?: string[] }
      } catch {
        json(res, 400, { error: 'invalid json body' })
        return true
      }
      if (parsed.room) {
        const result = indicant.check(parsed.room, defaultCheckStrategy)
        send(res, result.present ? 204 : 404, undefined, {}, method)
        return true
      }
      if (Array.isArray(parsed.rooms)) {
        const checks = indicant.checkMany(parsed.rooms, defaultCheckStrategy)
        json(res, 200, { maybe: checks.filter((x) => x.present).map((x) => x.room), source: checks[0]?.source ?? 'filter' })
        return true
      }
      json(res, 400, { error: 'expected room or rooms' })
      return true
    }

    if (method === 'PUT' && path === `${base}/filter`) {
      let body: Uint8Array
      try {
        body = await readBody(req, 16 * 1024 * 1024)
      } catch (err) {
        json(res, 413, { error: err instanceof Error ? err.message : 'request too large' })
        return true
      }
      if (!verifyIndicantRequest(req, path, body, options)) {
        json(res, 401, { error: 'invalid Indicant signature' })
        return true
      }
      try {
        indicant.loadSnapshot(body)
        send(res, 204, undefined, {}, method)
      } catch (err) {
        json(res, 400, { error: err instanceof Error ? err.message : 'invalid snapshot' })
      }
      return true
    }

    return false
  }
}