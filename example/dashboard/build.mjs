import { build } from 'esbuild'
import { cp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'dist')

await rm(OUT, { recursive: true, force: true })

await build({
  entryPoints: [join(HERE, 'server.ts'), join(HERE, 'server-worker.ts')],
  outdir: OUT,
  format: 'esm',
  platform: 'node',
  bundle: true,
  packages: 'external',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }
})

await cp(join(HERE, 'src'), join(OUT, 'ui'), { recursive: true })
console.log('Built dashboard to dist/. Run: node dist/server.js')
