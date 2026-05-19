declare const Buffer: {
  from(input: string | Uint8Array | ArrayBuffer, encoding?: string): any
  concat(chunks: any[]): any
  isBuffer(value: unknown): boolean
  byteLength(value: string): number
}

declare module 'node:crypto' {
  export function createHash(algorithm: string): { update(data: string | Uint8Array): any; digest(encoding: 'hex'): string }
  export function createHmac(algorithm: string, key: string | Uint8Array): { update(data: string | Uint8Array): any; digest(encoding: 'hex'): string }
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean
}

declare module 'node:http' {
  export interface IncomingMessage extends AsyncIterable<any> {
    url?: string
    method?: string
    headers: Record<string, string | string[] | undefined>
  }
  export interface ServerResponse {
    writeHead(statusCode: number, headers?: Record<string, string>): this
    end(data?: string | Uint8Array): this
  }
}
