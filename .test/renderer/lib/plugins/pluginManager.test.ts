import { describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import {
  featureArb,
  permissionsArb,
  destinationsArb,
  runs,
} from '../../../helpers/pluginArbitraries'
import { printManifest } from '@/shared/plugin/manifest'
import { computeDesiredPlugins } from '@/renderer/lib/plugins/reconcile'

// Feature: plugin-system, Property 6: 中止時の後始末
it('Property 6: aborts install and update without changing state and discards exactly once', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom(
        'manifest',
        'id',
        'duplicate',
        'range',
        'theme',
        'consent',
        'fetch'
      ),
      fc.boolean(),
      async (fault, updating) => {
        if (fault === 'duplicate') updating = false
        const existing = [
          plugin('other', featureJson('other')),
          ...(updating || fault === 'duplicate'
            ? [plugin('p', featureJson('p'))]
            : []),
        ]
        const release =
          fault === 'manifest'
            ? '{'
            : fault === 'range'
              ? featureJson('p', { range: '>99.0.0' })
              : fault === 'theme'
                ? themeJson('p')
                : featureJson(fault === 'id' ? 'wrong' : 'p', {
                    permissions: [{ name: 'clipboard' }],
                  })
        const s = setup({
          plugins: existing,
          release,
          consent: fault !== 'consent',
        })
        if (fault === 'fetch')
          s.api.fetchRelease.mockRejectedValueOnce(new Error('offline'))
        const before = await s.api.getState()
        const outcome = updating
          ? await s.manager.applyUpdate('p')
          : await s.manager.installFromRepo(
              'o/p',
              fault === 'id' ? 'p' : undefined
            )
        expect(outcome.status).not.toBe('installed')
        expect(outcome.status).not.toBe('updated')
        expect(await s.api.getState()).toEqual(before)
        expect(s.api.commitInstall).not.toHaveBeenCalled()
        expect(s.api.applyUpdate).not.toHaveBeenCalled()
        expect(s.api.discardStaging).toHaveBeenCalledTimes(
          fault === 'fetch' ? 0 : 1
        )
      }
    ),
    runs
  )
})

// Feature: plugin-system, Property 13: 同意の記録は宣言と一致する
it('Property 13: persists exactly the manifest consent after installation', async () => {
  await fc.assert(
    fc.asyncProperty(featureArb, async manifest => {
      const s = setup({
        release: printManifest({ ...manifest, notyraVersion: '*' }),
      })
      expect((await s.manager.installFromRepo('o/p')).status).toBe('installed')
      expect(s.api.commitInstall).toHaveBeenCalledWith(
        'stg',
        expect.objectContaining({
          consentedPermissions: manifest.permissions.map(p => p.name),
          consentedDestinations: manifest.networkDestinations,
        })
      )
    }),
    runs
  )
})

// Feature: plugin-system, Property 27: 更新時の同意差分
it('Property 27: prompts only for added capabilities and replaces consent after update', async () => {
  await fc.assert(
    fc.asyncProperty(
      permissionsArb,
      destinationsArb,
      featureArb,
      async (permissions, destinations, manifest) => {
        const next = {
          ...manifest,
          id: 'p',
          version: '2.0.0',
          notyraVersion: '*',
        }
        const s = setup({
          plugins: [
            plugin('p', featureJson('p'), {
              consentedPermissions: permissions,
              consentedDestinations: destinations,
            }),
          ],
          release: printManifest(next),
        })
        expect((await s.manager.applyUpdate('p')).status).toBe('updated')
        const ps = next.permissions.map(p => p.name)
        const ds = next.networkDestinations ?? []
        const added =
          ps.some(p => !permissions.includes(p)) ||
          ds.some(d => !destinations.includes(d))
        expect(s.requestConsent).toHaveBeenCalledTimes(added ? 1 : 0)
        expect(s.api.applyUpdate).toHaveBeenCalledWith(
          'p',
          'stg',
          expect.objectContaining({
            consentedPermissions: ps,
            consentedDestinations: ds,
          })
        )
      }
    ),
    runs
  )
})

// Feature: plugin-system, Property 28: 更新は有効/無効を維持する
it('Property 28: preserves enabled state and reconciles the new version', async () => {
  await fc.assert(
    fc.asyncProperty(fc.boolean(), async enabled => {
      const s = setup({
        plugins: [plugin('p', featureJson('p'), { enabled })],
        release: featureJson('p', { version: '2.0.0' }),
      })
      await s.manager.applyUpdate('p')
      const next = await s.api.getState()
      expect(next.plugins[0].enabled).toBe(enabled)
      expect(next.plugins[0].version).toBe('2.0.0')
      expect(
        computeDesiredPlugins(next, APP_VERSION, 'main').map(p => p.version)
      ).toEqual(enabled ? ['2.0.0'] : [])
    }),
    runs
  )
})
import {
  createPluginManager,
  type PluginManagerApi,
} from '@/renderer/lib/plugins/manager/pluginManager'
import { PluginApiError } from '@/shared/plugin/api'
import type {
  ConsentRequest,
  InstalledPluginView,
  InstallRecord,
  PluginStateView,
} from '@/shared/plugin/types'

const APP_VERSION = '3.2.0'

function featureJson(
  id: string,
  options: {
    version?: string
    range?: string
    permissions?: Array<{ name: string; purpose?: string }>
    destinations?: string[]
  } = {}
): string {
  return JSON.stringify({
    name: id,
    version: options.version ?? '1.0.0',
    author: { name: 'Jane' },
    notyra: {
      displayName: `Plugin ${id}`,
      type: 'feature',
      notyraVersion: options.range ?? '^3.0.0',
      main: 'dist/index.js',
      permissions: options.permissions ?? [],
      ...(options.destinations
        ? { networkDestinations: options.destinations }
        : {}),
    },
  })
}

function themeJson(id: string): string {
  return JSON.stringify({
    name: id,
    version: '1.0.0',
    notyra: {
      displayName: `Theme ${id}`,
      type: 'theme',
      notyraVersion: '^3.0.0',
      theme: 'theme.json',
    },
  })
}

function colorTheme(id: string) {
  return {
    id,
    name: id,
    nameJa: id,
    swatches: ['#000'],
    swatchesDark: ['#fff'],
    light: {},
    dark: {},
  }
}

function plugin(
  id: string,
  packageJson: string,
  overrides: Partial<InstalledPluginView> = {}
): InstalledPluginView {
  return {
    id,
    version: '1.0.0',
    source: { type: 'github', owner: 'o', repo: id },
    enabled: true,
    consentedPermissions: [],
    consentedDestinations: [],
    generation: 0,
    installedAt: '2026-01-01T00:00:00Z',
    packageJson,
    ...overrides,
  }
}

interface Setup {
  plugins?: InstalledPluginView[]
  developerMode?: boolean
  /** fetchRelease が返す package.json */
  release?: string
  /** staging / installed のファイル */
  files?: Record<string, string>
  consent?: boolean
  selectedTheme?: string
  devFolder?: { path: string; packageJson: string } | null
}

function setup(options: Setup = {}) {
  let state: PluginStateView = {
    schemaVersion: 1,
    thirdPartyWarningAcknowledged: true,
    developerMode: options.developerMode ?? false,
    plugins: options.plugins ?? [],
  }
  const files = options.files ?? {}
  const replace = (next: InstalledPluginView[]) => {
    state = { ...state, plugins: next }
    return state
  }

  const api = {
    getState: vi.fn(async () => state),
    fetchRelease: vi.fn(async (_owner: string, _repo: string) => ({
      stagingId: 'stg',
      packageJson: options.release ?? featureJson('p'),
      tag: 'v1.0.0',
    })),
    discardStaging: vi.fn(async (_id: string) => {}),
    commitInstall: vi.fn(async (_id: string, record: InstallRecord) =>
      replace([
        ...state.plugins,
        plugin(record.id, options.release ?? '', {
          version: record.version,
          source: record.source,
          consentedPermissions: record.consentedPermissions,
          consentedDestinations: record.consentedDestinations,
        }),
      ])
    ),
    checkUpdate: vi.fn(async (_id: string) => ({ version: '1.1.0' })),
    applyUpdate: vi.fn(
      async (id: string, _stagingId: string, record: InstallRecord) =>
        replace(
          state.plugins.map(p =>
            p.id === id
              ? {
                  ...p,
                  version: record.version,
                  consentedPermissions: record.consentedPermissions,
                  consentedDestinations: record.consentedDestinations,
                }
              : p
          )
        )
    ),
    setEnabled: vi.fn(async (id: string, enabled: boolean) =>
      replace(state.plugins.map(p => (p.id === id ? { ...p, enabled } : p)))
    ),
    uninstall: vi.fn(async (id: string) =>
      replace(state.plugins.filter(p => p.id !== id))
    ),
    setDeveloperMode: vi.fn(async (developerMode: boolean) => {
      state = { ...state, developerMode }
      return state
    }),
    selectDevFolder: vi.fn(async () =>
      options.devFolder === undefined ? null : options.devFolder
    ),
    registerDev: vi.fn(async (path: string, record: InstallRecord) =>
      replace([
        ...state.plugins,
        plugin(record.id, '', {
          source: { type: 'local', path },
          consentedPermissions: record.consentedPermissions,
          consentedDestinations: record.consentedDestinations,
        }),
      ])
    ),
    reloadDev: vi.fn(async (_id: string) => ({ packageJson: '' })),
    setDevConsent: vi.fn(async (id: string, record: InstallRecord) =>
      replace(
        state.plugins.map(p =>
          p.id === id
            ? {
                ...p,
                pendingConsent: undefined,
                consentedPermissions: record.consentedPermissions,
                consentedDestinations: record.consentedDestinations,
              }
            : p
        )
      )
    ),
    classifyDestinations: vi.fn(async (dests: string[]) =>
      dests.map(dest => ({
        dest,
        class: dest.startsWith('localhost')
          ? ('private' as const)
          : ('public' as const),
      }))
    ),
    readText: vi.fn(async (id: string, path: string) => {
      const text = files[`${id}/${path}`]
      if (text === undefined) throw new PluginApiError('notFound', path)
      return text
    }),
    readStagingText: vi.fn(async (stagingId: string, path: string) => {
      const text = files[`${stagingId}/${path}`]
      if (text === undefined) throw new PluginApiError('notFound', path)
      return text
    }),
  } satisfies PluginManagerApi

  const requestConsent = vi.fn(
    async (_r: ConsentRequest) => options.consent ?? true
  )
  const updateSettings = vi.fn()
  const manager = createPluginManager({
    api,
    appVersion: APP_VERSION,
    requestConsent,
    getSelectedThemeId: () => options.selectedTheme ?? 'gray',
    updateSettings,
    getReservedThemeIds: () => ['gray', 'purple'],
  })
  return { api, manager, requestConsent, updateSettings }
}

describe('installFromRepo', () => {
  it('does not fetch when the repository spec is invalid', async () => {
    const { api, manager } = setup()
    await expect(manager.installFromRepo('  ')).resolves.toEqual({
      status: 'failed',
      error: { kind: 'repoSpec', reason: 'empty' },
    })
    await expect(manager.installFromRepo('not a repo')).resolves.toEqual({
      status: 'failed',
      error: { kind: 'repoSpec', reason: 'format' },
    })
    expect(api.fetchRelease).not.toHaveBeenCalled()
  })

  it('installs after consent and records the declared permissions and destinations', async () => {
    const release = featureJson('p', {
      permissions: [{ name: 'network', purpose: 'API' }, { name: 'clipboard' }],
      destinations: ['api.example.com', 'localhost:8080'],
    })
    const { api, manager, requestConsent } = setup({ release })

    const outcome = await manager.installFromRepo(
      'https://github.com/someone/repo.git'
    )

    expect(outcome).toMatchObject({ status: 'installed', id: 'p' })
    expect(api.fetchRelease).toHaveBeenCalledWith('someone', 'repo', undefined)
    expect(requestConsent).toHaveBeenCalledWith({
      mode: 'install',
      displayName: 'Plugin p',
      author: 'Jane',
      source: { type: 'github', owner: 'someone', repo: 'repo' },
      permissions: [{ name: 'network', purpose: 'API' }, { name: 'clipboard' }],
      destinations: [
        { dest: 'api.example.com', class: 'public' },
        { dest: 'localhost:8080', class: 'private' },
      ],
    })
    expect(api.commitInstall).toHaveBeenCalledWith('stg', {
      id: 'p',
      version: '1.0.0',
      source: { type: 'github', owner: 'someone', repo: 'repo' },
      consentedPermissions: ['network', 'clipboard'],
      consentedDestinations: ['api.example.com', 'localhost:8080'],
    })
    expect(api.discardStaging).not.toHaveBeenCalled()
  })

  it('selects the registry plugin ID from a shared release', async () => {
    const { api, manager } = setup({ release: featureJson('notyra-toc') })
    await expect(
      manager.installFromRepo('yuma-shin/notyra-plugins', 'notyra-toc')
    ).resolves.toMatchObject({ status: 'installed', id: 'notyra-toc' })
    expect(api.fetchRelease).toHaveBeenCalledWith(
      'yuma-shin', 'notyra-plugins', 'notyra-toc'
    )
  })

  it('asks for consent even when no permission is declared', async () => {
    const { requestConsent, manager } = setup()
    await manager.installFromRepo('o/p')
    expect(requestConsent).toHaveBeenCalledWith(
      expect.objectContaining({ permissions: [], destinations: [] })
    )
  })

  it.each([
    [
      'cancelled consent',
      { consent: false },
      undefined,
      { status: 'cancelled' },
    ],
    [
      'invalid manifest',
      { release: '{' },
      undefined,
      {
        status: 'failed',
        error: { kind: 'manifestInvalid', errors: [expect.anything()] },
      },
    ],
    [
      'registry ID mismatch',
      {},
      'other',
      {
        status: 'failed',
        error: { kind: 'idMismatch', expected: 'other', actual: 'p' },
      },
    ],
    [
      'duplicate ID (developer plugin)',
      {
        plugins: [
          plugin('p', featureJson('p'), {
            source: { type: 'local', path: '/dev/p' },
          }),
        ],
      },
      undefined,
      { status: 'failed', error: { kind: 'alreadyInstalled', id: 'p' } },
    ],
    [
      'incompatible range',
      { release: featureJson('p', { range: '^4.0.0' }) },
      undefined,
      {
        status: 'failed',
        error: { kind: 'incompatible', range: '^4.0.0', current: APP_VERSION },
      },
    ],
    [
      'invalid theme',
      { release: themeJson('t'), files: { 'stg/theme.json': '{"id":""}' } },
      undefined,
      { status: 'failed', error: { kind: 'themeInvalid' } },
    ],
  ] as const)(
    'discards the staging exactly once on %s',
    async (_name, options, expectedId, expected) => {
      const { api, manager, requestConsent } = setup(options as Setup)
      const outcome = await manager.installFromRepo('o/p', expectedId)
      expect(outcome).toMatchObject(expected)
      expect(api.discardStaging).toHaveBeenCalledTimes(1)
      expect(api.discardStaging).toHaveBeenCalledWith('stg')
      expect(api.commitInstall).not.toHaveBeenCalled()
      if (expected.status === 'failed') {
        expect(requestConsent).not.toHaveBeenCalled()
      }
    }
  )

  it('reports GitHub errors without a staging to discard', async () => {
    const { api, manager } = setup()
    api.fetchRelease.mockRejectedValueOnce({ kind: 'repoNotFound' })
    const outcome = await manager.installFromRepo('o/p')
    expect(outcome).toMatchObject({
      status: 'failed',
      error: { kind: 'backend', error: { kind: 'repoNotFound' } },
    })
    expect(api.discardStaging).not.toHaveBeenCalled()
  })

  it('validates a theme plugin in the staging before consent', async () => {
    const { api, manager } = setup({
      release: themeJson('t'),
      files: { 'stg/theme.json': JSON.stringify(colorTheme('ocean')) },
    })
    const outcome = await manager.installFromRepo('o/t')
    expect(outcome).toMatchObject({ status: 'installed', id: 't' })
    expect(api.readStagingText).toHaveBeenCalledWith('stg', 'theme.json')
  })
})

describe('updates', () => {
  it('checks only GitHub plugins and detects newer versions', async () => {
    const { api, manager } = setup({
      plugins: [
        plugin('a', featureJson('a')),
        plugin('d', featureJson('d'), {
          source: { type: 'local', path: '/dev/d' },
        }),
      ],
    })
    expect(api.checkUpdate).not.toHaveBeenCalled()
    const results = await manager.checkUpdates()
    expect(api.checkUpdate).toHaveBeenCalledTimes(1)
    expect(results).toEqual([
      {
        id: 'a',
        status: 'checked',
        installedVersion: '1.0.0',
        latestVersion: '1.1.0',
        hasUpdate: true,
      },
    ])
  })

  it('asks for consent only for added permissions and records the new declaration', async () => {
    const { api, manager, requestConsent } = setup({
      plugins: [
        plugin('p', featureJson('p'), {
          consentedPermissions: ['clipboard', 'notes:read'],
        }),
      ],
      release: featureJson('p', {
        version: '1.1.0',
        permissions: [{ name: 'clipboard' }, { name: 'network' }],
        destinations: ['api.example.com'],
      }),
    })

    const outcome = await manager.applyUpdate('p')

    expect(outcome).toMatchObject({ status: 'updated', version: '1.1.0' })
    expect(api.fetchRelease).toHaveBeenCalledWith('o', 'p', 'p')
    expect(requestConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'update',
        permissions: [{ name: 'network' }],
        destinations: [{ dest: 'api.example.com', class: 'public' }],
      })
    )
    expect(api.applyUpdate).toHaveBeenCalledWith('p', 'stg', {
      id: 'p',
      version: '1.1.0',
      consentedPermissions: ['clipboard', 'network'],
      consentedDestinations: ['api.example.com'],
    })
  })

  it('updates without consent when nothing is added', async () => {
    const { api, manager, requestConsent } = setup({
      plugins: [plugin('p', featureJson('p'), { enabled: false })],
      release: featureJson('p', { version: '1.1.0' }),
    })
    await expect(manager.applyUpdate('p')).resolves.toMatchObject({
      status: 'updated',
    })
    expect(requestConsent).not.toHaveBeenCalled()
    expect(api.applyUpdate).toHaveBeenCalledTimes(1)
    expect(api.discardStaging).not.toHaveBeenCalled()
  })

  it('keeps the installed version when the update consent is cancelled', async () => {
    const { api, manager } = setup({
      plugins: [plugin('p', featureJson('p'))],
      release: featureJson('p', {
        version: '1.1.0',
        permissions: [{ name: 'clipboard' }],
      }),
      consent: false,
    })
    await expect(manager.applyUpdate('p')).resolves.toEqual({
      status: 'cancelled',
    })
    expect(api.applyUpdate).not.toHaveBeenCalled()
    expect(api.discardStaging).toHaveBeenCalledTimes(1)
  })
})

describe('enable / uninstall and the selected theme', () => {
  const themePlugin = () =>
    plugin('t', themeJson('t'), {
      source: { type: 'github', owner: 'o', repo: 't' },
    })
  const files = { 't/theme.json': JSON.stringify(colorTheme('ocean')) }

  it('switches to Gray when the selected theme plugin is disabled', async () => {
    const { api, manager, updateSettings } = setup({
      plugins: [themePlugin()],
      files,
      selectedTheme: 'ocean',
    })
    await expect(manager.setEnabled('t', false)).resolves.toMatchObject({
      status: 'done',
    })
    expect(api.setEnabled).toHaveBeenCalledWith('t', false, 'user')
    expect(updateSettings).toHaveBeenCalledWith({ colorTheme: 'gray' })
  })

  it('switches to Gray when the selected theme plugin is uninstalled', async () => {
    const { api, manager, updateSettings } = setup({
      plugins: [themePlugin()],
      files,
      selectedTheme: 'ocean',
    })
    await manager.uninstall('t')
    expect(api.uninstall).toHaveBeenCalledWith('t')
    expect(updateSettings).toHaveBeenCalledWith({ colorTheme: 'gray' })
  })

  it('keeps the theme when another theme is selected or the plugin is enabled', async () => {
    const { manager, updateSettings } = setup({
      plugins: [themePlugin()],
      files,
      selectedTheme: 'purple',
    })
    await manager.setEnabled('t', false)
    await manager.uninstall('t')
    expect(updateSettings).not.toHaveBeenCalled()

    const other = setup({
      plugins: [themePlugin()],
      files,
      selectedTheme: 'ocean',
    })
    await other.manager.setEnabled('t', true)
    expect(other.updateSettings).not.toHaveBeenCalled()
  })
})

describe('developer mode', () => {
  it('validates, checks duplicates and registers the selected folder after consent', async () => {
    const { api, manager, requestConsent } = setup({
      developerMode: true,
      devFolder: { path: '/dev/d', packageJson: featureJson('d') },
    })
    const outcome = await manager.loadDevFolder()
    expect(outcome).toMatchObject({ status: 'installed', id: 'd' })
    expect(requestConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'devLoad',
        source: { type: 'local', path: '/dev/d' },
      })
    )
    expect(api.registerDev).toHaveBeenCalledWith('/dev/d', {
      id: 'd',
      version: '1.0.0',
      source: { type: 'local', path: '/dev/d' },
      consentedPermissions: [],
      consentedDestinations: [],
    })
  })

  it('rejects a duplicate ID from the folder', async () => {
    const { api, manager } = setup({
      developerMode: true,
      plugins: [plugin('d', featureJson('d'))],
      devFolder: { path: '/dev/d', packageJson: featureJson('d') },
    })
    await expect(manager.loadDevFolder()).resolves.toEqual({
      status: 'failed',
      error: { kind: 'alreadyInstalled', id: 'd' },
    })
    expect(api.registerDev).not.toHaveBeenCalled()
  })

  it('does not open the folder dialog while developer mode is off', async () => {
    const { api, manager } = setup({ developerMode: false })
    await expect(manager.loadDevFolder()).resolves.toEqual({
      status: 'failed',
      error: { kind: 'developerModeDisabled' },
    })
    expect(api.selectDevFolder).not.toHaveBeenCalled()
  })

  it('keeps a reloaded plugin pending when the re-consent is cancelled', async () => {
    const next = featureJson('d', {
      version: '0.2.0',
      permissions: [{ name: 'network', purpose: 'sync' }],
      destinations: ['localhost'],
    })
    const s = setup({
      developerMode: true,
      plugins: [
        plugin('d', featureJson('d'), {
          source: { type: 'local', path: '/dev/d' },
          pendingConsent: {
            addedPermissions: ['network'],
            addedDestinations: ['localhost'],
          },
        }),
      ],
      consent: false,
    })
    s.api.reloadDev.mockResolvedValue({ packageJson: next })

    await expect(s.manager.reloadDev('d')).resolves.toEqual({
      status: 'pendingConsent',
      id: 'd',
    })
    expect(s.requestConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'devReload',
        permissions: [{ name: 'network', purpose: 'sync' }],
        destinations: [{ dest: 'localhost', class: 'private' }],
      })
    )
    expect(s.api.setDevConsent).not.toHaveBeenCalled()

    // 再度の再読み込みで同意すると、新しい宣言を記録して同意待ちを解除する
    s.requestConsent.mockResolvedValue(true)
    await expect(s.manager.reloadDev('d')).resolves.toMatchObject({
      status: 'reloaded',
    })
    expect(s.api.setDevConsent).toHaveBeenCalledWith('d', {
      id: 'd',
      version: '0.2.0',
      consentedPermissions: ['network'],
      consentedDestinations: ['localhost'],
    })
  })

  it('reloads without consent when nothing is added', async () => {
    const s = setup({
      developerMode: true,
      plugins: [
        plugin('d', featureJson('d'), {
          source: { type: 'local', path: '/dev/d' },
        }),
      ],
    })
    s.api.reloadDev.mockResolvedValue({ packageJson: featureJson('d') })
    await expect(s.manager.reloadDev('d')).resolves.toMatchObject({
      status: 'reloaded',
      id: 'd',
    })
    expect(s.requestConsent).not.toHaveBeenCalled()
  })

  it('persists the developer mode toggle', async () => {
    const { api, manager } = setup()
    await expect(manager.setDeveloperMode(true)).resolves.toMatchObject({
      status: 'done',
      state: { developerMode: true },
    })
    expect(api.setDeveloperMode).toHaveBeenCalledWith(true)
  })
})
