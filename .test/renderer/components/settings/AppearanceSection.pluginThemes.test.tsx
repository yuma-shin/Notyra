import { cleanup, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../../helpers/test-app-provider'
import { AppearanceSection } from '@/renderer/components/settings/AppearanceSection'
import { ColorThemeSelector } from '@/renderer/components/ColorThemeSelector'
import { fireEvent } from '@testing-library/react'
import type { PluginStateView } from '@/shared/plugin/types'

const mocks = vi.hoisted(() => ({
  state: null as PluginStateView | null,
  files: {} as Record<string, string>,
  listeners: [] as Array<(s: PluginStateView) => void>,
}))

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(async () => '3.2.0'),
}))

vi.mock('@/renderer/lib/tauriApi', () => ({
  tauriApi: {
    platform: 'Win32',
    plugins: {
      getState: vi.fn(async () => mocks.state),
      readText: vi.fn(async (id: string) => {
        const text = mocks.files[id]
        if (text === undefined) throw new Error('not found')
        return text
      }),
      onStateChanged: vi.fn((cb: (s: PluginStateView) => void) => {
        mocks.listeners.push(cb)
        return () => {
          mocks.listeners = mocks.listeners.filter(l => l !== cb)
        }
      }),
    },
  },
}))

const themeJson = (id: string, name: string) =>
  JSON.stringify({
    id,
    name,
    swatches: ['#112233'],
    swatchesDark: ['#445566'],
    light: { '--background': '#ffffff' },
    dark: { '--background': '#000000' },
  })

const themePlugin = (id: string, enabled = true) => ({
  id,
  version: '1.0.0',
  source: { type: 'github' as const, owner: 'o', repo: id },
  enabled,
  consentedPermissions: [],
  consentedDestinations: [],
  generation: 0,
  installedAt: '2026-01-01T00:00:00.000Z',
  packageJson: JSON.stringify({
    name: id,
    version: '1.0.0',
    notyra: {
      displayName: `Display ${id}`,
      type: 'theme',
      notyraVersion: '^3.0.0',
      theme: 'theme.json',
    },
  }),
})

const makeState = (enabled = true): PluginStateView => ({
  schemaVersion: 1,
  thirdPartyWarningAcknowledged: true,
  developerMode: false,
  plugins: [themePlugin('ocean-theme', enabled), themePlugin('dup-theme')],
})

describe('AppearanceSection の Plugin テーマ（設定ウィンドウ）', () => {
  it('rejects invalid plugin themes in the selector and removes disabled themes', async () => {
    mocks.files['dup-theme'] = '{"id":"invalid"}'
    renderWithProviders(<ColorThemeSelector />, { settings: { colorTheme: 'gray' } })
    fireEvent.click(screen.getByRole('button', { name: /Color Theme/i }))
    expect(await screen.findByText('Plugin Ocean')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Display dup-theme')
    expect(screen.queryByText('invalid')).toBeNull()
    for (const listener of mocks.listeners) listener(makeState(false))
    await vi.waitFor(() => expect(screen.queryByText('Plugin Ocean')).toBeNull())
  })
  beforeEach(() => {
    localStorage.clear()
    mocks.state = makeState()
    mocks.files = {
      'ocean-theme': themeJson('plugin-ocean', 'Plugin Ocean'),
      'dup-theme': themeJson('gray', 'Duplicate Gray'),
    }
    mocks.listeners = []
  })

  afterEach(() => {
    cleanup()
  })

  it('テーマ JSON を選択肢に追加し、ID 重複はエラーを表示して追加しない', async () => {
    renderWithProviders(<AppearanceSection />, {
      settings: { colorTheme: 'gray' },
    })

    expect(await screen.findByText('Plugin Ocean')).toBeInTheDocument()
    expect(screen.queryByText('Duplicate Gray')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Display dup-theme: Theme ID gray is already in use'
    )
    // Plugin のテーマには削除ボタンを出さない
    const option = screen.getByText('Plugin Ocean').closest('[role="option"]')
    expect(option?.querySelector('button')).toBeNull()
  })

  it('plugins:state-changed で無効化された Plugin のテーマを選択肢から外す', async () => {
    renderWithProviders(<AppearanceSection />, {
      settings: { colorTheme: 'gray' },
    })
    expect(await screen.findByText('Plugin Ocean')).toBeInTheDocument()

    for (const listener of mocks.listeners) listener(makeState(false))

    await vi.waitFor(() =>
      expect(screen.queryByText('Plugin Ocean')).not.toBeInTheDocument()
    )
  })
})
