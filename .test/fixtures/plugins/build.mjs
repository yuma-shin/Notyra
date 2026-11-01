import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { transformWithOxc } from 'vite'

const source = readFileSync(new URL('./typescript/src/index.ts', import.meta.url), 'utf8')
const { code } = await transformWithOxc(source, 'index.ts')
mkdirSync(new URL('./typescript/dist/', import.meta.url), { recursive: true })
writeFileSync(fileURLToPath(new URL('./typescript/dist/index.js', import.meta.url)),
  code.replaceAll('@notyra/plugin-api', '/fixture-typescript/@notyra/api.js'))
