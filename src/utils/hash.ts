const encoder = new TextEncoder()

export function fnv1a64(input: string | Uint8Array, seed = 0xcbf29ce484222325n): bigint {
  const data = typeof input === 'string' ? encoder.encode(input) : input
  let h = seed & 0xffffffffffffffffn
  for (const b of data) {
    h ^= BigInt(b)
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return h
}

export function hash64(input: string | Uint8Array, seed = 0): bigint {
  return fnv1a64(input, 0xcbf29ce484222325n ^ BigInt(seed >>> 0))
}

export function indexesFor(key: string, count: number, modulo: number): number[] {
  if (modulo <= 0) throw new Error('modulo must be positive')
  const h1 = hash64(key, 0x9e3779b9)
  const h2 = hash64(key, 0x85ebca6b) | 1n
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const value = (h1 + BigInt(i) * h2 + BigInt(i * i)) & 0xffffffffffffffffn
    out.push(Number(value % BigInt(modulo)))
  }
  return out
}

export function nextPowerOfTwo(value: number): number {
  if (value <= 1) return 1
  return 2 ** Math.ceil(Math.log2(value))
}
