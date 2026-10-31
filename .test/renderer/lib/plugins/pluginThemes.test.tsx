import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../../helpers/test-app-provider'
import { usePluginThemeSync } from '@/renderer/hooks/usePluginThemeSync'
import {
  createRegistries,
  PLUGIN_STYLE_ATTRIBUTE,
  type Registries,
} from '@/renderer/lib/plugins/host/registries'
import {
  loadPluginThemes,
  SettingsWindowThemeStore,
  type SettingsThemeApi,
} from '@/renderer/lib/plugins/settingsWindowThemes'
import {
  applyColorTheme,
  builtinThemes,
  type ColorTheme,
  listAllThemes,
  registerPluginThemeSource,
} from '@/renderer/lib/themeManager'
import type {
  InstalledPluginView,
  PluginStateView,
} from '@/shared/plugin/types'

const theme = (id: string, background = 'rgb(1, 2, 3)'): ColorTheme => ({
  id,
  name: `Theme ${id}`,
  nameJa: `テーマ ${id}`,
  swatches: ['#000000'],
  swatchesDark: ['#ffffff'],
  light: { '--background': background },
  dark: { '--background': background },
})

const themePackageJson = (id: string, range = '^3.0.0') =>
  JSON.stringify({
    name: id,
    version: '1.0.0',
    notyra: {
      displayName: `Display ${id}`,
      type: 'theme',
      notyraVersion: range,
      theme: 'theme.json',
    },
  })

const featurePackageJson = (id: string) =>
  JSON.stringify({
    name: id,
    version: '1.0.0',
    notyra: {
      displayName: id,
      type: 'feature',
      notyraVersion: '^3.0.0',
      main: 'dist/index.js',
      permissions: [],
    },
  })

const plugin = (
  id: string,
  overrides: Partial<InstalledPluginView> = {}
): InstalledPluginView => ({
  id,
  version: '1.0.0',
  source: { type: 'github', owner: 'o', repo: id },
  enabled: true,
  consentedPermissions: [],
  consentedDestinations: [],
  generation: 0,
  installedAt: '2026-01-01T00:00:00.000Z',
  packageJson: themePackageJson(id),
  ...overrides,
})

const state = (plugins: InstalledPluginView[]): PluginStateView => ({
  schemaVersion: 1,
  thirdPartyWarningAcknowledged: true,
  developerMode: false,
  plugins,
})

const background = () =>
  document.documentElement.style.getPropertyValue('--background')

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('style')
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.removeAttribute('style')
})

describe('themeManager の Plugin テーマ', () => {
  it('登録した取得元のテーマを listAllThemes と applyColorTheme が参照し、解除で外れる', () => {
    const themes = [theme('plugin-ocean')]
    const unregister = registerPluginThemeSource(() => themes)

    expect(listAllThemes().map(t => t.id)).toContain('plugin-ocean')
    applyColorTheme('plugin-ocean', false)
    expect(background()).toBe('rgb(1, 2, 3)')

    unregister()
    unregister() // 冪等
    expect(listAllThemes().map(t => t.id)).not.toContain('plugin-ocean')
    applyColorTheme('plugin-ocean', false)
    expect(background()).toBe(builtinThemes[0].light['--background'])
  })

  it('テーマ ID が重複する場合は組み込み・カスタムを優先する', () => {
    const unregister = registerPluginThemeSource(() => [
      theme(builtinThemes[0].id, 'rgb(9, 9, 9)'),
    ])
    const all = listAllThemes()
    expect(all.filter(t => t.id === builtinThemes[0].id)).toHaveLength(1)
    expect(all.find(t => t.id === builtinThemes[0].id)).toBe(builtinThemes[0])
    unregister()
  })
})

describe('loadPluginThemes（設定ウィンドウ）', () => {
  const files: Record<string, string> = {
    'ok-a': JSON.stringify(theme('plugin-a')),
    'ok-b': JSON.stringify(theme('plugin-b')),
    'dup-builtin': JSON.stringify(theme(builtinThemes[0].id)),
    'dup-plugin': JSON.stringify(theme('plugin-a')),
    invalid: JSON.stringify({ id: 'x' }),
    disabled: JSON.stringify(theme('plugin-disabled')),
    incompat: JSON.stringify(theme('plugin-incompat')),
  }
  const readText = vi.fn(async (id: string, path: string) => {
    expect(path).toBe('theme.json')
    const text = files[id]
    if (text === undefined) throw new Error(`read failed: ${id}`)
    return text
  })

  it('読み込み対象の Theme_Plugin だけを検証して追加し、失敗はエラーとして返す', async () => {
    const result = await loadPluginThemes({
      state: state([
        plugin('ok-a'),
        plugin('dup-builtin'),
        plugin('dup-plugin'),
        plugin('invalid'),
        plugin('missing'),
        plugin('disabled', { enabled: false }),
        plugin('incompat', { packageJson: themePackageJson('incompat', '^9') }),
        plugin('feature', { packageJson: featurePackageJson('feature') }),
        plugin('ok-b'),
      ]),
      appVersion: '3.2.0',
      readText,
      reservedThemeIds: builtinThemes.map(t => t.id),
    })

    expect(result.themes.map(t => t.id)).toEqual(['plugin-a', 'plugin-b'])
    expect(result.errors).toEqual([
      {
        pluginId: 'dup-builtin',
        displayName: 'Display dup-builtin',
        reason: 'duplicateId',
        themeId: builtinThemes[0].id,
      },
      {
        pluginId: 'dup-plugin',
        displayName: 'Display dup-plugin',
        reason: 'duplicateId',
        themeId: 'plugin-a',
      },
      expect.objectContaining({ pluginId: 'invalid', reason: 'invalidTheme' }),
      expect.objectContaining({ pluginId: 'missing', reason: 'readFailed' }),
    ])
    // 無効・非互換・Feature_Plugin のファイルは読まない
    const readIds = readText.mock.calls.map(([id]) => id)
    expect(readIds).not.toContain('disabled')
    expect(readIds).not.toContain('incompat')
    expect(readIds).not.toContain('feature')
  })

  it('状態の形式が不正なら何も追加しない', async () => {
    const result = await loadPluginThemes({
      state: [] as unknown as PluginStateView,
      appVersion: '3.2.0',
      readText,
      reservedThemeIds: [],
    })
    expect(result).toEqual({ themes: [], errors: [] })
  })
})

describe('SettingsWindowThemeStore', () => {
  it('購読で読み込み、plugins:state-changed で選択肢を更新し、購読解除で停止する', async () => {
    let emit: ((s: PluginStateView) => void) | null = null
    const unlisten = vi.fn()
    const api: SettingsThemeApi = {
      getState: vi.fn(async () => state([plugin('ok-a')])),
      readText: vi.fn(async () => JSON.stringify(theme('plugin-a'))),
      onStateChanged: vi.fn(cb => {
        emit = cb
        return unlisten
      }),
    }
    const store = new SettingsWindowThemeStore({
      getApi: () => api,
      getAppVersion: async () => '3.2.0',
      getReservedThemeIds: () => [],
    })
    const listener = vi.fn()

    const unsubscribe = store.subscribe(listener)
    await vi.waitFor(() =>
      expect(store.getThemes().map(t => t.id)).toEqual(['plugin-a'])
    )
    expect(listener).toHaveBeenCalled()

    // 無効化されたら選択肢から外れる（Requirement 11.6）
    emit?.(state([plugin('ok-a', { enabled: false })]))
    await vi.waitFor(() => expect(store.getThemes()).toEqual([]))

    unsubscribe()
    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it('tauriApi.plugins が無い環境では何もしない', () => {
    const store = new SettingsWindowThemeStore({
      getApi: () => null,
      getAppVersion: async () => '3.2.0',
    })
    const unsubscribe = store.subscribe(() => {})
    expect(store.getThemes()).toEqual([])
    unsubscribe()
  })
})

describe('usePluginThemeSync（Plugin_Host_Window）', () => {
  function Sync({ registries }: { registries: Registries }) {
    usePluginThemeSync(registries)
    return null
  }

  it('後から登録された選択中の Plugin テーマを適用し、追加CSSは選択中のテーマのものだけ有効にする', async () => {
    const registries = createRegistries({ platform: 'other' })
    renderWithProviders(<Sync registries={registries} />, {
      settings: { colorTheme: 'plugin-ocean' },
    })
    await vi.waitFor(() =>
      expect(registries.styles.getActiveThemeId()).toBe('plugin-ocean')
    )
    // Plugin の読み込み前は既定テーマにフォールバックしている
    expect(background()).toBe(builtinThemes[0].light['--background'])

    let disposeTheme: (() => void) | undefined
    act(() => {
      const result = registries.themes.register('ocean', theme('plugin-ocean'))
      if (result.ok) disposeTheme = () => result.disposable.dispose()
      registries.styles.add('ocean', '.ocean{}', { whenThemeId: 'plugin-ocean' })
      registries.styles.add('other', '.other{}', { whenThemeId: 'plugin-other' })
    })

    expect(background()).toBe('rgb(1, 2, 3)')
    const applied = [
      ...document.head.querySelectorAll(`style[${PLUGIN_STYLE_ATTRIBUTE}]`),
    ].map(el => el.getAttribute(PLUGIN_STYLE_ATTRIBUTE))
    expect(applied).toEqual(['ocean'])

    // Plugin_Stop でテーマが外れたら既定テーマに戻る
    act(() => disposeTheme?.())
    expect(background()).toBe(builtinThemes[0].light['--background'])
  })
})
