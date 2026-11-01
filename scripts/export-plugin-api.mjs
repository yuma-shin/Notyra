import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const core = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const corePackage = JSON.parse(
  readFileSync(resolve(core, 'package.json'), 'utf8')
)
const roots = process.argv.slice(2)
if (!roots.length) throw new Error('Pass destination package directories')
for (const destination of roots) {
  const dir = resolve(destination)
  mkdirSync(resolve(dir, 'src'), { recursive: true })
  const api = readFileSync(
    resolve(core, 'src/shared/plugin/api.ts'),
    'utf8'
  ).replace("from '../types'", "from './notes.js'")
    .replaceAll("from './types'", "from './types.js'")
  const notes = readFileSync(
    resolve(core, 'src/shared/types.ts'),
    'utf8'
  ).match(/export interface MarkdownNoteMeta \{[\s\S]*?\n\}/)[0]
  const types = readFileSync(
    resolve(core, 'src/shared/plugin/types.ts'),
    'utf8'
  )
  const manifest = readFileSync(
    resolve(core, 'src/shared/plugin/manifest.ts'),
    'utf8'
  ).replaceAll("from './types'", "from './types.js'")
  const sources = {
    api,
    notes,
    types,
    manifest,
    index:
      "export type * from './api.js'\nexport type * from './types.js'\nimport type { NotyraPluginApi } from './api.js'\nexport declare const notyra: NotyraPluginApi\nexport default notyra\n",
  }
  for (const [name, source] of Object.entries(sources)) {
    sources[name] = source.replaceAll('\r\n', '\n')
    writeFileSync(resolve(dir, 'src', `${name}.ts`), sources[name])
  }
  const peers = Object.fromEntries(
    [
      'react',
      'react-dom',
      '@types/react',
      '@types/react-dom',
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
      '@codemirror/commands',
      '@lezer/highlight',
    ].map(name => [name, corePackage.dependencies[name] ?? corePackage.devDependencies[name]])
  )
  writeFileSync(
    resolve(dir, 'api-source.json'),
    `${JSON.stringify({
      apiVersion: corePackage.version,
      repository: 'https://github.com/yuma-shin/notyra',
      packageRepository: 'https://github.com/yuma-shin/notyra-plugin-api',
      dependencies: { semver: corePackage.dependencies.semver },
      peerDependencies: peers,
      files: Object.fromEntries(Object.entries(sources).map(([name, source]) => [
        `src/${name}.ts`, createHash('sha256').update(source).digest('hex'),
      ])),
    }, null, 2)}\n`
  )
  console.log(`Exported API ${corePackage.version} sources to ${dir}. Build and publish from notyra-plugin-api.`)
}
