/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: <> */
import type { Configuration } from 'electron-builder'

import {
  main,
  name,
  version,
  resources,
  displayName,
  author as _author,
} from './package.json'

import { getDevFolder } from './src/lib/electron-app/release/utils/path'

const author = _author?.name ?? _author
const currentYear = new Date().getFullYear()
const authorInKebabCase = author.replace(/\s+/g, '-')
const appId = `com.${authorInKebabCase}.${name}`.toLowerCase()

const artifactName = [`${name}-v${version}`, '-${os}.${ext}'].join('')

export default {
  appId,
  productName: displayName,
  copyright: `Copyright © ${currentYear} — ${author}`,

  files: [
    '**/*',
    '!sample-notes/**/*',
    '!**/*.map',
  ],

  // 不要な Chromium ロケールを除外（en-US と ja のみ残す）
  electronLanguages: ['en-US', 'ja'],

  directories: {
    app: getDevFolder(main),
    output: `dist/v${version}`,
  },

  mac: {
    artifactName,
    icon: `${resources}/build/icons/icon.icns`,
    category: 'public.app-category.utilities',
    target: ['zip', 'dmg', 'dir'],
  },

  win: {
    icon: `${resources}/build/icons/dark/win/icon.ico`,
    target: [
      {
        target: 'nsis',
        arch: ['x64'],
      },
      {
        target: 'zip',
        arch: ['x64'],
      },
      {
        target: 'portable',
        arch: ['x64'],
      },
    ]
  },

  nsis: {
    oneClick: true,
    perMachine: false,
    allowToChangeInstallationDirectory: false,
    artifactName: `${name}-v${version}-\${os}-setup.\${ext}`,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: displayName,
  },

  portable: {
    artifactName: `${name}-v${version}-\${os}-portable.\${ext}`,
  },

  publish: [
    {
      provider: 'github',
      releaseType: 'release',
    },
  ],
} satisfies Configuration
