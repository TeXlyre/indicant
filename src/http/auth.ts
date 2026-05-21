import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

export interface IndicantAuthOptions {
  secret?: string | Uint8Array
  maxSkewMs?: number
}

export function signIndicantRequest(secret: string | Uint8Array, method: string, path: string, timestamp: string, body: Uint8Array | string = ''): string {
  const h = createHmac('sha256', secret)
  h.update(method.toUpperCase())
  h.update('\n')
  h.update(path)
  h.update('\n')
  h.update(timestamp)
  h.update('\n')
  h.update(body)
  return `sha256=${h.digest('hex')}`
}

export function verifyIndicantRequest(
  req: IncomingMessage,
  path: string,
  body: Uint8Array,
  options: IndicantAuthOptions
): boolean {
  if (!options.secret) return true
  const timestamp = String(req.headers['x-indicant-timestamp'] ?? '')
  const signature = String(req.headers['x-indicant-signature'] ?? '')
  if (!timestamp || !signature) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  const skew = options.maxSkewMs ?? 60_000
  if (Math.abs(Date.now() - ts) > skew) return false
  const expected = signIndicantRequest(options.secret, req.method ?? 'GET', path, timestamp, body)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}
