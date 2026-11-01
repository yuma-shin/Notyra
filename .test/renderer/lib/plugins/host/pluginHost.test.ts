import { afterEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { parseManifest } from '@/shared/plugin/manifest'
import { runs } from '../../../../helpers/pluginArbitraries'

function registerKind(api: NotyraPluginApi, kind: number, id: string) {
  switch (kind % 10) {
    case 0:
      return api.styles.add(`.p-${id} { color: red; }`)
    case 1:
      return api.commands.register({ id, title: id, run: () => {} })
    case 2:
      return api.sidePanel.registerView({
        id,
        title: id,
        icon: '<svg/>',
        render: () => {},
      })
    case 3:
      return api.markdown.registerRemarkPlugin(() => () => {})
    case 4:
      return api.markdown.registerRehypePlugin(() => () => {})
    case 5:
      return api.editor.registerExtension([])
    case 6:
      return api.toolbar.addButton({
        command: 'cmd',
        icon: '<svg/>',
        tooltip: id,
      })
    case 7:
      return api.keymaps.add({ key: 'Ctrl-Shift-y', command: 'cmd' })
    case 8:
      return api.events.onActiveNoteChange(() => {})
    default:
      return api.settings.onDidChange(() => {})
  }
}
function registrySnapshot(r: Registries) {
  return [
    r.styles.store,
    r.themes.store,
    r.commands.store,
    r.sidePanel.store,
    r.markdown.remarkStore,
    r.markdown.rehypeStore,
    r.editorExtensions.store,
    r.toolbar.store,
    r.keymaps.store,
    r.activeNote.store,
    r.settings.store,
  ].map(store => [...store.getSnapshot()])
}

// Feature: plugin-system, Property 20: activate() 失敗時の巻き戻し
it('Property 20: rolls back generated registration sequences on every activation failure', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.integer({ min: 0, max: 9 }), { maxLength: 20 }),
      fc.constantFrom('throw', 'reject', 'timeout'),
      async (kinds, failure) => {
        vi.useFakeTimers()
        const s = setup(state([plugin('bad', featureJson('bad'))]), {
          modules: {
            bad: {
              activate: () => {
                kinds.forEach((kind, i) =>
                  registerKind(s.apiFor('bad'), kind, `item-${i}`)
                )
                if (failure === 'throw') throw new Error('bad activation')
                return failure === 'reject'
                  ? Promise.reject(new Error('bad activation'))
                  : new Promise<void>(() => {})
              },
            },
          },
        })
        s.registries.commands.register('other', {
          id: 'cmd',
          title: 'Other',
          run: () => {},
        })
        const before = registrySnapshot(s.registries)
        const started = s.host.start()
        await vi.advanceTimersByTimeAsync(10_000)
        await started
        expect(registrySnapshot(s.registries)).toEqual(before)
        expect(s.backend.setEnabled).toHaveBeenCalledWith(
          'bad',
          false,
          'activateFailed'
        )
        expect(s.backend.reportError).toHaveBeenCalled()
        await s.host.dispose()
        vi.useRealTimers()
      }
    ),
    runs
  )
})

// Feature: plugin-system, Property 21: 有効化 → 無効化で登録状態が元に戻る
it('Property 21: stops all registration types and keeps other plugins intact', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.tuple(fc.integer({ min: 0, max: 9 }), fc.boolean()), {
        maxLength: 25,
      }),
      fc.boolean(),
      async (operations, theme) => {
        const s = setup(
          state([plugin('p', theme ? themeJson('p') : featureJson('p'))]),
          {
            modules: {
              p: {
                activate: () => {
                  for (let kind = 0; kind < 10; kind++)
                    registerKind(s.apiFor('p'), kind, `activate-${kind}`)
                },
              },
            },
          }
        )
        if (theme)
          s.backend.readText.mockImplementation(async (_id, path) =>
            path.endsWith('.json')
              ? JSON.stringify({
                  id: 'ocean',
                  name: 'Ocean',
                  nameJa: '海',
                  swatches: ['#000'],
                  swatchesDark: ['#fff'],
                  light: {},
                  dark: {},
                })
              : 'body { color: blue }'
          )
        s.registries.commands.register('other', {
          id: 'cmd',
          title: 'Other',
          run: () => {},
        })
        const before = registrySnapshot(s.registries)
        await s.host.start()
        if (!theme)
          operations.forEach(([kind, remove], i) => {
            const d = registerKind(s.apiFor('p'), kind, `later-${i}`)
            if (remove) d.dispose()
          })
        s.emitState(state([]))
        await s.host.whenIdle()
        expect(registrySnapshot(s.registries)).toEqual(before)
        await s.host.dispose()
      }
    ),
    runs
  )
})

// Feature: plugin-system, Property 22: 失敗の隔離
it('Property 22: isolates load, activate and deactivate failures across plugin sequences', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.constantFrom('load', 'activate', 'deactivate', 'ok'), {
        minLength: 1,
        maxLength: 10,
      }),
      async outcomes => {
        const modules: Record<string, PluginModule> = {}
        outcomes.forEach((outcome, i) => {
          if (outcome === 'load') return
          modules[`p-${i}`] = {
            activate: () => {
              if (outcome === 'activate') throw new Error('activate failed')
            },
            deactivate: () => {
              if (outcome === 'deactivate') throw new Error('deactivate failed')
            },
          }
        })
        const s = setup(
          state(
            outcomes.map((_, i) => plugin(`p-${i}`, featureJson(`p-${i}`)))
          ),
          { modules }
        )
        await expect(s.host.start()).resolves.toBeUndefined()
        expect(
          s.host
            .getLoadedPlugins()
            .filter(p => p.activated)
            .map(p => p.id)
        ).toEqual(
          outcomes.flatMap((outcome, i) =>
            outcome === 'ok' || outcome === 'deactivate' ? [`p-${i}`] : []
          )
        )
        await expect(s.host.dispose()).resolves.toBeUndefined()
      }
    ),
    runs
  )
})
import {
  buildPluginFileUrl,
  PLUGIN_HOST_GLOBAL,
  PluginHost,
  type PluginHostBackend,
  pluginProtocolBase,
  SHARED_MODULES_GLOBAL,
} from '@/renderer/lib/plugins/host/pluginHost'
import {
  createRegistries,
  PLUGIN_STYLE_ATTRIBUTE,
  type Registries,
} from '@/renderer/lib/plugins/host/registries'
import type { NotyraPluginApi, PluginModule } from '@/shared/plugin/api'
import type {
  InstalledPluginView,
  PluginStateView,
  SettingsChangedPayload,
  StopRequestPayload,
} from '@/shared/plugin/types'

const APP_VERSION = '3.2.0'

function featureJson(id: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: id,
    version: '1.0.0',
    notyra: {
      displayName: `Plugin ${id}`,
      type: 'feature',
      notyraVersion: '^3.0.0',
      main: 'dist/index.js',
      permissions: [],
      ...extra,
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
      themeCss: 'theme.css',
    },
  })
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

function state(plugins: InstalledPluginView[]): PluginStateView {
  return {
    schemaVersion: 1,
    thirdPartyWarningAcknowledged: true,
    developerMode: false,
    plugins,
  }
}

function createBackend(initial: PluginStateView) {
  const stateListeners = new Set<(s: PluginStateView) => void>()
  const settingsListeners = new Set<(e: SettingsChangedPayload) => void>()
  const stopListeners = new Set<(e: StopRequestPayload) => void>()
  const on =
    <T>(set: Set<(e: T) => void>) =>
    (cb: (e: T) => void) => {
      set.add(cb)
      return () => {
        set.delete(cb)
      }
    }

  const backend = {
    clipboardRead: vi.fn(async () => ''),
    clipboardWrite: vi.fn(async () => {}),
    openExternal: vi.fn(async () => {}),
    httpRequest: vi.fn(),
    notes: {
      resolveRoot: vi.fn(),
      listRoots: vi.fn(async () => []),
      list: vi.fn(async () => []),
      read: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      rename: vi.fn(),
      move: vi.fn(),
      delete: vi.fn(),
    },
    getState: vi.fn(async () => initial),
    setEnabled: vi.fn(async () => initial),
    readText: vi.fn(async (_id: string, _path: string) => ''),
    getSettings: vi.fn(async (_id: string) => ({}) as Record<string, unknown>),
    reportError: vi.fn(async () => {}),
    reportKeybindingConflicts: vi.fn(async () => {}),
    ackStop: vi.fn(async () => {}),
    registerSharedModules: vi.fn(async () => {}),
    onStateChanged: vi.fn(on(stateListeners)),
    onSettingsChanged: vi.fn(on(settingsListeners)),
    onStopRequest: vi.fn(on(stopListeners)),
  }

  return {
    backend: backend as unknown as PluginHostBackend & typeof backend,
    emitState: (s: PluginStateView) => {
      for (const cb of stateListeners) cb(s)
    },
    emitSettings: (e: SettingsChangedPayload) => {
      for (const cb of settingsListeners) cb(e)
    },
    emitStop: (e: StopRequestPayload) => {
      for (const cb of stopListeners) cb(e)
    },
  }
}

interface SetupOptions {
  loader?: (url: string) => Promise<PluginModule>
  modules?: Record<string, PluginModule | (() => PluginModule)>
  windowKind?: 'main' | 'note'
  timeoutMs?: number
}

function setup(initial: PluginStateView, options: SetupOptions = {}) {
  const fake = createBackend(initial)
  const registries: Registries = createRegistries({
    platform: 'other',
    document,
    getReservedThemeIds: () => ['gray', 'purple'],
  })
  const toast = { error: vi.fn() }
  const globalObject: Record<string, unknown> = {}
  const imported: string[] = []
  const importModule = vi.fn(async (url: string) => {
    imported.push(url)
    if (options.loader) return options.loader(url)
    const id = url.split('/')[3]
    const entry = options.modules?.[id]
    if (!entry) throw new Error(`module not found: ${url}`)
    return typeof entry === 'function' ? entry() : entry
  })
  const host = new PluginHost({
    api: fake.backend,
    windowKind: options.windowKind ?? 'main',
    appVersion: APP_VERSION,
    toast,
    registries,
    protocolBase: 'http://notyra-plugin.localhost',
    importModule,
    createNonce: () => 'n1',
    lifecycleTimeoutMs: options.timeoutMs,
    globalObject,
  })
  const apiFor = (id: string): NotyraPluginApi =>
    (
      globalObject[PLUGIN_HOST_GLOBAL] as {
        getPluginApi(id: string): NotyraPluginApi
      }
    ).getPluginApi(id)
  return { ...fake, host, registries, toast, globalObject, imported, apiFor }
}

afterEach(() => {
  for (const el of document.head.querySelectorAll(
    `style[${PLUGIN_STYLE_ATTRIBUTE}]`
  )) {
    el.remove()
  }
  vi.useRealTimers()
})

it('loads the distributed TypeScript and handwritten ESM fixtures through the host module loader', async () => {
  for (const folder of ['typescript', 'esm']) {
    const root = resolve('.test/fixtures/plugins', folder)
    const packageJson = readFileSync(resolve(root, 'package.json'), 'utf8')
    const parsed = parseManifest(packageJson)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok || parsed.value.type !== 'feature')
      throw new Error('invalid fixture manifest')
    const manifest = parsed.value
    const s = setup(state([plugin(manifest.id, packageJson)]), {
      loader: async url => {
        expect(url).toContain(`/${manifest.id}/n1/${manifest.main}`)
        const virtual = `export const notyra = globalThis.__NOTYRA_FIXTURE_HOST__.getPluginApi(${JSON.stringify(manifest.id)});`
        const virtualUrl = `data:text/javascript;base64,${Buffer.from(virtual).toString('base64')}`
        const source = readFileSync(
          resolve(root, manifest.main),
          'utf8'
        ).replace(`/${manifest.id}/@notyra/api.js`, virtualUrl)
        // Native ESM evaluation substitutes only protocol transport, not module behavior.
        const native = createRequire(import.meta.url)(
          resolve('.test/fixtures/plugins/native-loader.cjs')
        ) as {
          load(
            url: string,
            host: { getPluginApi: typeof s.apiFor }
          ): Promise<PluginModule>
        }
        return native.load(
          `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`,
          { getPluginApi: s.apiFor }
        )
      },
    })
    try {
      await s.host.start()
      expect(s.backend.reportError.mock.calls).toEqual([])
      expect(s.host.getLoadedPlugins()[0]).toMatchObject({
        id: manifest.id,
        activated: true,
      })
      expect(s.registries.commands.getCommands()[0].id).toBe(
        `${manifest.id}:hello`
      )
      expect(s.registries.styles.store.getSnapshot()).toHaveLength(1)
      expect(s.backend.reportError).not.toHaveBeenCalled()
      await s.host.dispose()
      expect(s.registries.commands.getCommands()).toEqual([])
    } finally {
      await s.host.dispose()
    }
  }
})

describe('helpers', () => {
  it('builds plugin file URLs under <base>/<id>/<nonce>/<path>', () => {
    expect(
      buildPluginFileUrl(pluginProtocolBase(true), 'toc', 'n1', 'dist/a b.js')
    ).toBe('http://notyra-plugin.localhost/toc/n1/dist/a%20b.js')
    expect(
      buildPluginFileUrl(pluginProtocolBase(false), 'toc', 'n1', 'index.js')
    ).toBe('notyra-plugin://localhost/toc/n1/index.js')
  })
})

describe('PluginHost.start', () => {
  it('defines the globals, registers shared modules and activates enabled plugins', async () => {
    const activate = vi.fn()
    const s = setup(state([plugin('a', featureJson('a'))]), {
      modules: { a: { activate } },
    })
    await s.host.start()

    expect(s.backend.registerSharedModules).toHaveBeenCalledTimes(1)
    expect(s.globalObject[SHARED_MODULES_GLOBAL]).toBeDefined()
    const descriptor = Object.getOwnPropertyDescriptor(
      s.globalObject,
      PLUGIN_HOST_GLOBAL
    )
    expect(descriptor?.writable).toBe(false)
    expect(descriptor?.configurable).toBe(false)
    expect(s.imported).toEqual([
      'http://notyra-plugin.localhost/a/n1/dist/index.js',
    ])
    expect(activate).toHaveBeenCalledTimes(1)
    expect(s.host.getLoadedPlugins()).toEqual([
      { id: 'a', loadKey: 'a@1.0.0#0', activated: true, failed: false },
    ])
  })

  it('does not load disabled or incompatible plugins', async () => {
    const s = setup(
      state([
        plugin('a', featureJson('a'), { enabled: false }),
        plugin('b', featureJson('b', { notyraVersion: '^4.0.0' })),
      ]),
      { modules: { a: {}, b: {} } }
    )
    await s.host.start()
    expect(s.imported).toEqual([])
    expect(s.host.getLoadedPlugins()).toEqual([])
  })

  it('loads settings before importing the entry module', async () => {
    let seen: unknown
    const s = setup(state([plugin('a', featureJson('a'))]), {
      modules: {
        a: () => ({
          activate: () => {
            seen = s.registries.settings.getValues('a')
          },
        }),
      },
    })
    s.backend.getSettings.mockResolvedValue({ depth: '3' })
    await s.host.start()
    expect(seen).toEqual({ depth: '3' })
  })
})

describe('PluginHost: failures', () => {
  it.each(['entry', 'dependency'] as const)('bounds native ESM top-level await in the %s module', async location => {
    vi.useFakeTimers()
    let release!: () => void
    let evaluated!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const evaluating = new Promise<void>(resolve => { evaluated = resolve })
    const activateA = vi.fn(), activateB = vi.fn()
    const dataUrl = (code: string) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
    const waiting = `const host = globalThis.__NOTYRA_FIXTURE_HOST__;
      host.getPluginApi('a').styles.add('body { color: red }');
      host.evaluated(); await host.gate;`
    const code = location === 'entry'
      ? `${waiting}\nexport function activate() { host.activate() }`
      : `import ${JSON.stringify(dataUrl(waiting))};
         const host = globalThis.__NOTYRA_FIXTURE_HOST__;
         export function activate() { host.activate() }`
    const native = createRequire(import.meta.url)(resolve('.test/fixtures/plugins/native-loader.cjs')) as {
      load(url: string, host: object): Promise<PluginModule>
    }
    let imported: Promise<PluginModule> | undefined
    const s = setup(state([plugin('a', featureJson('a')), plugin('b', featureJson('b'))]), {
      loader: async url => {
        if (url.includes('/b/')) return { activate: activateB }
        imported = native.load(dataUrl(code), { getPluginApi: s.apiFor, gate, evaluated, activate: activateA })
        return imported
      },
    })
    const started = s.host.start()
    try {
      await evaluating
      await vi.advanceTimersByTimeAsync(10_000)
      expect(activateB).toHaveBeenCalledOnce()
      await started
      expect(s.registries.styles.store.getSnapshot()).toEqual([])
      expect(s.host.getLoadedPlugins()[0]).toMatchObject({ id: 'a', failed: true, activated: false })
      expect(() => s.apiFor('a').styles.add('body{}')).toThrow()
      release()
      await imported
      expect(activateA).not.toHaveBeenCalled()
    } finally {
      release()
      await imported?.catch(() => {})
      await started
      await s.host.dispose()
    }
  })

  it.each(['resolve', 'reject'] as const)('times out module evaluation and drains startup, stop and reconcile queues despite a late %s', async late => {
    vi.useFakeTimers()
    let finish!: (module: PluginModule) => void
    let reject!: (error: Error) => void
    const lateActivate = vi.fn()
    const activateB = vi.fn()
    const s = setup(state([plugin('a', featureJson('a')), plugin('b', featureJson('b'))]), {
      loader: async url => {
        if (url.includes('/b/')) return { activate: activateB }
        s.apiFor('a').styles.add('body { color: red }')
        return new Promise<PluginModule>((resolve, fail) => { finish = resolve; reject = fail })
      },
    })
    const started = s.host.start()
    try {
      await vi.advanceTimersByTimeAsync(1)
      s.emitStop({ id: 'a', requestId: 'stop-a' })
      s.emitState(state([plugin('b', featureJson('b'))]))
      await vi.advanceTimersByTimeAsync(9_999)
      expect(activateB).toHaveBeenCalledOnce()
      await started
      await s.host.whenIdle()
      expect(s.registries.styles.store.getSnapshot()).toEqual([])
      expect(s.backend.reportError).toHaveBeenCalledWith('a', 'load', expect.stringContaining('Timed out'))
      expect(s.backend.ackStop).toHaveBeenCalledWith('stop-a')
      expect(s.host.getLoadedPlugins().map(p => p.id)).toEqual(['b'])
      expect(() => s.apiFor('a').styles.add('body{}')).toThrow()
      if (late === 'resolve') finish({ activate: lateActivate })
      else reject(new Error('late import rejection'))
      await vi.advanceTimersByTimeAsync(0)
      expect(lateActivate).not.toHaveBeenCalled()
    } finally {
      finish?.({})
      await started
      await s.host.dispose()
    }
  })

  it('rolls back registrations, disables and reports when activate() throws', async () => {
    const s = setup(state([plugin('a', featureJson('a'))]), {
      modules: {
        a: () => ({
          activate: () => {
            s.apiFor('a').styles.add('body { color: red }')
            throw new Error('boom')
          },
        }),
      },
    })
    await s.host.start()

    expect(s.registries.styles.store.getSnapshot()).toEqual([])
    expect(s.backend.setEnabled).toHaveBeenCalledWith(
      'a',
      false,
      'activateFailed'
    )
    expect(s.backend.reportError).toHaveBeenCalledWith('a', 'activate', 'boom')
    expect(s.toast.error).toHaveBeenCalledTimes(1)
    expect(s.host.getLoadedPlugins()[0]).toMatchObject({
      activated: false,
      failed: true,
    })
  })

  it('treats activate() that does not finish within the timeout as a failure', async () => {
    vi.useFakeTimers()
    const s = setup(state([plugin('a', featureJson('a'))]), {
      modules: { a: { activate: () => new Promise<void>(() => {}) } },
      timeoutMs: 10_000,
    })
    const started = s.host.start()
    await vi.advanceTimersByTimeAsync(10_000)
    await started
    expect(s.backend.setEnabled).toHaveBeenCalledWith(
      'a',
      false,
      'activateFailed'
    )
  })

  it('does not call activate() when the entry module fails to load, and keeps loading others', async () => {
    const activateB = vi.fn()
    const s = setup(
      state([plugin('a', featureJson('a')), plugin('b', featureJson('b'))]),
      { modules: { b: { activate: activateB } } }
    )
    await s.host.start()

    expect(s.backend.reportError).toHaveBeenCalledWith(
      'a',
      'load',
      expect.stringContaining('module not found')
    )
    expect(s.backend.setEnabled).not.toHaveBeenCalled()
    expect(activateB).toHaveBeenCalledTimes(1)
  })

  it('reports to Plugins_Tab even when the toast fails, and vice versa', async () => {
    const s = setup(state([]))
    s.toast.error.mockImplementation(() => {
      throw new Error('toast broken')
    })
    s.host.reportError('a', 'command', new Error('x'))
    expect(s.backend.reportError).toHaveBeenCalledWith('a', 'command', 'x')

    s.toast.error.mockReset()
    s.backend.reportError.mockImplementation(() => {
      throw new Error('ipc broken')
    })
    s.host.reportError('a', 'command', new Error('y'))
    expect(s.toast.error).toHaveBeenCalledTimes(1)
  })
})

describe('PluginHost: stop', () => {
  it('does not deactivate an activation that timed out, including a late completion', async () => {
    vi.useFakeTimers()
    let complete!: () => void
    const deactivate = vi.fn()
    const s = setup(state([plugin('a', featureJson('a'))]), { modules: { a: { activate: () => new Promise<void>(resolve => { complete = resolve }), deactivate } } })
    const started = s.host.start()
    await vi.advanceTimersByTimeAsync(10_000)
    await started
    complete()
    await Promise.resolve()
    s.emitState(state([]))
    await s.host.whenIdle()
    expect(deactivate).not.toHaveBeenCalled()
    await s.host.dispose()
  })
  it('waits ten seconds for deactivate and then removes registrations', async () => {
    vi.useFakeTimers()
    const s = setup(state([plugin('a', featureJson('a'))]), { modules: { a: { activate: () => { s.apiFor('a').styles.add('body {}') }, deactivate: () => new Promise<void>(() => {}) } } })
    await s.host.start()
    s.emitState(state([]))
    const stopped = vi.fn()
    const idle = s.host.whenIdle().then(stopped)
    await vi.advanceTimersByTimeAsync(9_999)
    expect(stopped).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await idle
    expect(s.registries.styles.store.getSnapshot()).toEqual([])
    expect(s.backend.reportError).toHaveBeenCalledWith('a', 'deactivate', expect.any(String))
    await s.host.dispose()
  })
  it('calls deactivate() and removes registrations when the plugin is disabled', async () => {
    const deactivate = vi.fn()
    const initial = state([plugin('a', featureJson('a'))])
    const s = setup(initial, {
      modules: {
        a: () => ({
          activate: () => {
            s.apiFor('a').styles.add('body { color: red }')
          },
          deactivate,
        }),
      },
    })
    await s.host.start()
    expect(s.registries.styles.store.getSnapshot()).toHaveLength(1)

    s.emitState(state([plugin('a', featureJson('a'), { enabled: false })]))
    await s.host.whenIdle()

    expect(deactivate).toHaveBeenCalledTimes(1)
    expect(s.registries.styles.store.getSnapshot()).toEqual([])
    expect(s.host.getLoadedPlugins()).toEqual([])
    await expect(async () =>
      s.apiFor('a').styles.add('x')
    ).rejects.toMatchObject({ kind: 'pluginNotActive' })
  })

  it('continues removing registrations when deactivate() throws', async () => {
    const s = setup(state([plugin('a', featureJson('a'))]), {
      modules: {
        a: () => ({
          activate: () => {
            s.apiFor('a').styles.add('p { margin: 0 }')
          },
          deactivate: () => {
            throw new Error('bye')
          },
        }),
      },
    })
    await s.host.start()
    s.emitState(state([]))
    await s.host.whenIdle()

    expect(s.backend.reportError).toHaveBeenCalledWith('a', 'deactivate', 'bye')
    expect(s.registries.styles.store.getSnapshot()).toEqual([])
  })

  it('stops the plugin and acknowledges a stop request', async () => {
    const deactivate = vi.fn()
    const s = setup(state([plugin('a', featureJson('a'))]), {
      modules: { a: { activate: () => {}, deactivate } },
    })
    await s.host.start()

    s.emitStop({ id: 'a', requestId: 'r1' })
    s.emitStop({ id: 'missing', requestId: 'r2' })
    await s.host.whenIdle()

    expect(deactivate).toHaveBeenCalledTimes(1)
    expect(s.backend.ackStop).toHaveBeenNthCalledWith(1, 'r1')
    expect(s.backend.ackStop).toHaveBeenNthCalledWith(2, 'r2')
    expect(s.host.getLoadedPlugins()).toEqual([])
  })

  it.each(['update', 'uninstall', 'rollback'] as const)('keeps an acknowledged plugin stopped until %s finishes in every window', async operation => {
    const initial = state([plugin('a', featureJson('a')), plugin('b', featureJson('b'))])
    const activate = vi.fn()
    const fast = setup(initial, {
      modules: { a: { activate }, b: { activate: () => {} } },
    })
    let finish!: () => void
    const slow = setup(initial, {
      modules: {
        a: { activate: () => {}, deactivate: vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve })) },
        b: { activate: () => {} },
      },
    })
    await fast.host.start()
    await slow.host.start()
    const request = { id: 'a', requestId: 'operation-a' }
    fast.emitStop(request)
    slow.emitStop(request)
    await fast.host.whenIdle()
    expect(fast.backend.ackStop).toHaveBeenCalledWith(request.requestId)
    expect(slow.backend.ackStop).not.toHaveBeenCalled()

    // Another plugin publishes the old enabled generation while a window stops.
    const intermediate = state([initial.plugins[0], { ...initial.plugins[1], enabled: false }])
    fast.emitState(intermediate)
    slow.emitState(intermediate)
    await fast.host.whenIdle()
    expect(fast.host.getLoadedPlugins()).toEqual([])
    expect(activate).toHaveBeenCalledTimes(1)
    finish()
    await slow.host.whenIdle()

    const completed: PluginStateView = {
      ...state(operation === 'uninstall' ? [] : [
        { ...initial.plugins[0], generation: operation === 'update' ? 1 : 0 },
      ]),
      completedStopRequest: request,
    }
    fast.emitState(completed)
    slow.emitState(completed)
    await fast.host.whenIdle()
    await slow.host.whenIdle()
    expect(activate).toHaveBeenCalledTimes(operation === 'uninstall' ? 1 : 2)
    expect(fast.host.getLoadedPlugins().map(p => p.loadKey)).toEqual(
      operation === 'uninstall' ? [] : [`a@1.0.0#${operation === 'update' ? 1 : 0}`]
    )
    await fast.host.dispose()
    await slow.host.dispose()
  })

  it('does not load a stop target from a reconcile already awaiting another plugin', async () => {
    let finish!: () => void
    const activate = vi.fn()
    const a = plugin('a', featureJson('a'))
    const b = plugin('b', featureJson('b'))
    const s = setup(state([{ ...a, enabled: false }, b]), {
      modules: {
        a: { activate },
        b: { activate: () => {}, deactivate: () => new Promise<void>(resolve => { finish = resolve }) },
      },
    })
    await s.host.start()
    s.emitState(state([a, { ...b, enabled: false }]))
    await Promise.resolve()
    s.emitStop({ id: 'a', requestId: 'r1' })
    finish()
    await s.host.whenIdle()
    expect(activate).not.toHaveBeenCalled()
    expect(s.backend.ackStop).toHaveBeenCalledWith('r1')
    await s.host.dispose()
  })

  it('ignores completion notifications for an earlier stop request', async () => {
    const initial = state([plugin('a', featureJson('a'))])
    const activate = vi.fn()
    const s = setup(initial, { modules: { a: { activate } } })
    await s.host.start()
    s.emitStop({ id: 'a', requestId: 'r1' })
    await s.host.whenIdle()
    s.emitStop({ id: 'a', requestId: 'r2' })
    await s.host.whenIdle()
    s.emitState({ ...initial, completedStopRequest: { id: 'a', requestId: 'r1' } })
    await s.host.whenIdle()
    expect(activate).toHaveBeenCalledTimes(1)
    await s.host.reconcile({ ...initial, completedStopRequest: { id: 'a', requestId: 'r2' } })
    expect(activate).toHaveBeenCalledTimes(2)
    await s.host.dispose()
  })

  it('reloads the plugin when the generation changes', async () => {
    const activate = vi.fn()
    const deactivate = vi.fn()
    const s = setup(state([plugin('a', featureJson('a'))]), {
      modules: { a: { activate, deactivate } },
    })
    await s.host.start()
    s.emitState(state([plugin('a', featureJson('a'), { generation: 1 })]))
    await s.host.whenIdle()

    expect(deactivate).toHaveBeenCalledTimes(1)
    expect(activate).toHaveBeenCalledTimes(2)
    expect(s.host.getLoadedPlugins()[0].loadKey).toBe('a@1.0.0#1')
  })
})

describe('PluginHost: settings', () => {
  it('updates the settings cache and notifies subscribers on settings-changed', async () => {
    const listener = vi.fn()
    const s = setup(
      state([
        plugin(
          'a',
          featureJson('a', {
            settings: [
              { key: 'depth', title: 'Depth', type: 'number', default: 2 },
            ],
          })
        ),
      ]),
      {
        modules: {
          a: () => ({
            activate: () => {
              s.apiFor('a').settings.onDidChange(listener)
            },
          }),
        },
      }
    )
    await s.host.start()
    expect(s.apiFor('a').settings.get('depth')).toBe(2)

    s.emitSettings({ id: 'a', values: { depth: 4 } })
    expect(listener).toHaveBeenCalledWith({ depth: 4 })
    expect(s.apiFor('a').settings.get('depth')).toBe(4)
  })
})

describe('PluginHost: theme plugins', () => {
  const colorTheme = (id: string) => ({
    id,
    name: 'Ocean',
    nameJa: 'オーシャン',
    swatches: ['#000'],
    swatchesDark: ['#fff'],
    light: {},
    dark: {},
  })

  it('registers the theme and its CSS conditioned on the theme', async () => {
    const s = setup(state([plugin('t', themeJson('t'))]))
    s.backend.readText.mockImplementation(async (_id, path) =>
      path === 'theme.json' ? JSON.stringify(colorTheme('ocean')) : 'body{}'
    )
    await s.host.start()

    expect(s.registries.themes.find('ocean')?.pluginId).toBe('t')
    expect(s.registries.styles.store.getSnapshot()[0].item).toEqual({
      css: 'body{}',
      whenThemeId: 'ocean',
    })
    expect(s.imported).toEqual([])

    s.emitState(state([]))
    await s.host.whenIdle()
    expect(s.registries.themes.find('ocean')).toBeUndefined()
    expect(s.registries.styles.store.getSnapshot()).toEqual([])
  })

  it.each(['disable', 'remove', 'update'] as const)('recovers a conflicting theme after the owner is resolved by %s', async operation => {
    const a = plugin('a', themeJson('a'))
    const b = plugin('b', themeJson('b'))
    const initial = state([a, b])
    const s = setup(initial)
    let updated = false
    s.backend.readText.mockImplementation(async (id, path) =>
      path === 'theme.json'
        ? JSON.stringify(colorTheme(id === 'a' && updated ? 'forest' : 'ocean'))
        : `/* ${id} */`
    )
    await s.host.start()
    expect(s.registries.themes.find('ocean')?.pluginId).toBe('a')
    expect(s.host.getLoadedPlugins().find(p => p.id === 'b')?.failed).toBe(true)
    const reads = s.backend.readText.mock.calls.length
    await s.host.reconcile(initial)
    expect(s.backend.readText).toHaveBeenCalledTimes(reads)

    updated = operation === 'update'
    const next = operation === 'remove' ? [b] : [
      { ...a, enabled: operation !== 'disable', generation: updated ? 1 : 0 }, b,
    ]
    s.emitState(state(next))
    await s.host.whenIdle()
    expect(s.registries.themes.find('ocean')?.pluginId).toBe('b')
    expect(s.host.getLoadedPlugins().find(p => p.id === 'b')).toMatchObject({
      failed: false, activated: true,
    })
    expect(s.registries.styles.store.getByPlugin('b')).toHaveLength(1)
    await s.host.dispose()
  })

  it('retries conflicting themes in load order without retrying the remaining conflict', async () => {
    const themes = ['a', 'b', 'c'].map(id => plugin(id, themeJson(id)))
    const s = setup(state(themes))
    s.backend.readText.mockImplementation(async (_id, path) =>
      path === 'theme.json' ? JSON.stringify(colorTheme('ocean')) : 'body{}'
    )
    await s.host.start()
    const cReads = s.backend.readText.mock.calls.filter(([id]) => id === 'c').length
    await s.host.reconcile(state(themes.slice(1)))
    expect(s.registries.themes.find('ocean')?.pluginId).toBe('b')
    expect(s.backend.readText.mock.calls.filter(([id]) => id === 'c')).toHaveLength(cReads)
    await s.host.reconcile(state(themes.slice(2)))
    expect(s.registries.themes.find('ocean')?.pluginId).toBe('c')
    await s.host.dispose()
  })

  it('does not retry malformed or reserved themes on unrelated state notifications', async () => {
    const initial = state(['invalid', 'reserved'].map(id => plugin(id, themeJson(id))))
    const s = setup(initial)
    s.backend.readText.mockImplementation(async id =>
      id === 'invalid' ? 'invalid json' : JSON.stringify(colorTheme('gray'))
    )
    await s.host.start()
    expect(s.backend.readText).toHaveBeenCalledTimes(2)
    await s.host.reconcile(initial)
    await s.host.reconcile(initial)
    expect(s.backend.readText).toHaveBeenCalledTimes(2)
    await s.host.dispose()
  })

  it('reports an invalid or duplicate theme without registering it', async () => {
    const s = setup(state([plugin('t', themeJson('t'))]))
    s.backend.readText.mockImplementation(async (_id, path) =>
      path === 'theme.json' ? JSON.stringify(colorTheme('gray')) : ''
    )
    await s.host.start()
    expect(s.registries.themes.getThemes()).toEqual([])
    expect(s.backend.reportError).toHaveBeenCalledWith(
      't',
      'theme',
      expect.stringContaining('gray')
    )
  })
})

describe('PluginHost: keybinding conflicts', () => {
  it('reports conflicts from the main window', async () => {
    const s = setup(
      state([plugin('a', featureJson('a')), plugin('b', featureJson('b'))]),
      {
        modules: {
          a: () => ({
            activate: () => {
              s.apiFor('a').keymaps.add({ key: 'Alt-q', command: 'x' })
            },
          }),
          b: () => ({
            activate: () => {
              s.apiFor('b').keymaps.add({ key: 'Alt-q', command: 'y' })
            },
          }),
        },
      }
    )
    await s.host.start()
    await Promise.resolve()

    const calls = s.backend.reportKeybindingConflicts.mock.calls
    expect(calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ pluginId: 'b', with: { pluginId: 'a' } }),
    ])
  })

  it('does not report conflicts from note windows', async () => {
    const s = setup(state([]), { windowKind: 'note' })
    await s.host.start()
    await Promise.resolve()
    expect(s.backend.reportKeybindingConflicts).not.toHaveBeenCalled()
  })
})
