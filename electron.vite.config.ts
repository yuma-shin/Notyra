import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import { resolve, normalize, dirname } from 'node:path'
import tailwindcss from '@tailwindcss/vite'

import injectProcessEnvPlugin from 'rollup-plugin-inject-process-env'
import tsconfigPathsPlugin from 'vite-tsconfig-paths'
import reactPlugin from '@vitejs/plugin-react'

import { settings } from './src/lib/electron-router-dom'
import { main, resources } from './package.json'

const [nodeModules, devFolder] = normalize(dirname(main)).split(/\/|\\/g)
const devPath = [nodeModules, devFolder].join('/')

const tsconfigPaths = tsconfigPathsPlugin({
  projects: [resolve('tsconfig.json')],
})

export default defineConfig({
  main: {
    mode: 'es2022',
    plugins: [tsconfigPaths, externalizeDepsPlugin()],

    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
        },

        output: {
          dir: resolve(devPath, 'main'),
          format: 'es',
        },
      },
    },
  },

  preload: {
    mode: 'es2022',
    plugins: [tsconfigPaths, externalizeDepsPlugin()],

    build: {
      rollupOptions: {
        output: {
          dir: resolve(devPath, 'preload'),
        },
      },
    },
  },

  renderer: {
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
      'process.platform': JSON.stringify(process.platform),
    },

    server: {
      port: settings.port,
    },

    plugins: [
      tsconfigPaths,
      tailwindcss(),
      ...(process.env.NODE_ENV !== 'production'
        ? [
            codeInspectorPlugin({
              bundler: 'vite',
              hotKeys: ['altKey'],
              hideConsole: true,
            }),
          ]
        : []),
      reactPlugin(),
    ],

    publicDir: resolve(resources, 'public'),

    build: {
      outDir: resolve(devPath, 'renderer'),

      rollupOptions: {
        plugins: [
          injectProcessEnvPlugin({
            NODE_ENV: 'production',
            platform: process.platform,
          }),
        ],

        input: {
          index: resolve('src/renderer/index.html'),
        },

        output: {
          dir: resolve(devPath, 'renderer'),
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('mermaid')) return 'chunk-mermaid'
            if (
              id.includes('@codemirror') ||
              id.includes('@uiw/react-codemirror') ||
              id.includes('@lezer')
            )
              return 'chunk-editor'
            if (
              id.includes('remark') ||
              id.includes('rehype') ||
              id.includes('unified') ||
              id.includes('mdast') ||
              id.includes('hast') ||
              id.includes('micromark') ||
              id.includes('highlight.js')
            )
              return 'chunk-markdown'
            return undefined
          },
        },
      },
    },
  },
})
