import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../../helpers/test-app-provider'
import { PluginsSection } from '@/renderer/components/settings/PluginsSection'
import type {
  InstalledPluginView,
  PluginErrorEntry,
  PluginStateView,
} from '@/shared/plugin/types'

const mocks = vi.hoisted(() => ({
  state: null as unknown as PluginStateView,
  errors: [] as PluginErrorEntry[],
  stateListeners: [] as Array<(s: PluginStateView) => void>,
  errorListeners: [] as Array<(e: PluginErrorEntry) => void>,
  api: {} as Record<string, ReturnType<typeof vi.fn>>,
}))

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(async () => '3.2.0'),
}))

vi.mock('@/renderer/lib/tauriApi', () => {
  const api = {
    getState: vi.fn(async () => mocks.state),
    getErrors: vi.fn(async () => mocks.errors),
    getKeybindingConflicts: vi.fn(async () => []),
    ackThirdPartyWarning: vi.fn(async () => {
      mocks.state = { ...mocks.state, thirdPartyWarningAcknowledged: true }
      return mocks.state
    }),
    checkUpdate: vi.fn(async () => ({ version: '1.1.0' })),
    fetchRegistry: vi.fn(async () =>
      JSON.stringify({
        schemaVersion: 1,
        plugins: [
          {
            id: 'registry-plugin',
            name: 'Registry Plugin',
            description: 'From the registry',
            author: 'Someone',
            repo: 'someone/registry-plugin',
          },
        ],
      })
    ),
    getSettings: vi.fn(async () => ({})),
    setSetting: vi.fn(async () => undefined),
    onStateChanged: vi.fn((cb: (s: PluginStateView) => void) => {
      mocks.stateListeners.push(cb)
      return () => {
        mocks.stateListeners = mocks.stateListeners.filter(l => l !== cb)
      }
    }),
    onError: vi.fn((cb: (e: PluginErrorEntry) => void) => {
      mocks.errorListeners.push(cb)
      return () => {
        mocks.errorListeners = mocks.errorListeners.filter(l => l !== cb)
      }
    }),
  }
  mocks.api = api
  return { tauriApi: { platform: 'Win32', shell: {}, plugins: api } }
})

const featurePlugin = (
  id: string,
  displayName: string,
  version = '1.0.0'
): InstalledPluginView => ({
  id,
  version,
  source: { type: 'github', owner: 'owner', repo: id },
  enabled: true,
  consentedPermissions: [],
  consentedDestinations: [],
  generation: 0,
  installedAt: '2026-01-01T00:00:00.000Z',
  packageJson: JSON.stringify({
    name: id,
    version,
    notyra: {
      displayName,
      type: 'feature',
      notyraVersion: '^3.0.0',
      main: 'dist/index.js',
      permissions: [],
    },
  }),
})

const makeState = (
  overrides: Partial<PluginStateView> = {}
): PluginStateView => ({
  schemaVersion: 1,
  thirdPartyWarningAcknowledged: true,
  developerMode: false,
  plugins: [featurePlugin('toc-plugin', 'Table of Contents')],
  ...overrides,
})

async function renderSection() {
  renderWithProviders(<PluginsSection />)
  await screen.findByTestId('installed-plugin-list')
}

describe('PluginsSection', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.state = makeState()
    mocks.errors = []
    mocks.stateListeners = []
    mocks.errorListeners = []
    for (const fn of Object.values(mocks.api)) fn.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  // Requirement 1.4, 1.5, 1.6, 1.7
  it('警告未確認の間はインストール操作を無効化し、了解後に有効化する', async () => {
    mocks.state = makeState({ thirdPartyWarningAcknowledged: false })
    await renderSection()

    const banner = screen.getByTestId('third-party-warning')
    const repoInput = screen.getByLabelText('GitHub repository')
    expect(repoInput).toBeDisabled()
    expect(
      within(screen.getByTestId('repo-install-form')).getByRole('button', {
        name: 'Install',
      })
    ).toBeDisabled()
    expect(
      await screen.findByTestId('registry-entry-install')
    ).toBeDisabled()
    expect(
      screen.getByRole('switch', { name: 'Enable developer mode' })
    ).toBeDisabled()

    fireEvent.click(within(banner).getByRole('button', { name: 'I understand' }))

    await vi.waitFor(() =>
      expect(screen.queryByTestId('third-party-warning')).not.toBeInTheDocument()
    )
    expect(mocks.api.ackThirdPartyWarning).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('GitHub repository')).toBeEnabled()
    expect(screen.getByTestId('registry-entry-install')).toBeEnabled()
    expect(
      screen.getByRole('switch', { name: 'Enable developer mode' })
    ).toBeEnabled()
  })

  // Requirement 10.1, 10.2, 10.4
  it('更新確認ボタンを押したときにのみ更新を確認する', async () => {
    await renderSection()
    // 表示時には通信しない
    await act(async () => {})
    expect(mocks.api.checkUpdate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('plugins-check-updates'))

    expect(await screen.findByTestId('plugins-update-notice')).toHaveTextContent(
      'Updates available: 1'
    )
    expect(mocks.api.checkUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.api.checkUpdate).toHaveBeenCalledWith('toc-plugin')
    expect(
      screen.getByTestId('installed-plugin-update-available')
    ).toHaveTextContent('Version 1.1.0 is available')
  })

  it('plugins:state-changed で一覧を更新する', async () => {
    await renderSection()
    expect(screen.getByText('Table of Contents')).toBeInTheDocument()

    act(() => {
      for (const listener of mocks.stateListeners) {
        listener(
          makeState({
            plugins: [
              featurePlugin('toc-plugin', 'Table of Contents'),
              featurePlugin('word-count', 'Word Count'),
            ],
          })
        )
      }
    })

    expect(await screen.findByText('Word Count')).toBeInTheDocument()
    // state-changed のたびにキーバインド重複を取り直す
    await vi.waitFor(() =>
      expect(mocks.api.getKeybindingConflicts).toHaveBeenCalledTimes(2)
    )
  })

  // Requirement 8.5, 8.14, 16.7
  it('plugins:error を受信するとセッション内エラーを表示する', async () => {
    await renderSection()
    expect(
      screen.queryByTestId('installed-plugin-errors')
    ).not.toBeInTheDocument()

    const entry: PluginErrorEntry = {
      pluginId: 'toc-plugin',
      source: 'activate',
      message: 'activate() threw: boom',
      windowLabel: 'main',
      at: '2026-01-01T00:00:01.000Z',
    }
    mocks.errors = [entry]
    act(() => {
      for (const listener of mocks.errorListeners) listener(entry)
    })

    const errors = await screen.findByTestId('installed-plugin-errors')
    expect(errors).toHaveTextContent('Activation: activate() threw: boom')
  })

  it('状態ファイルの破損を上部に表示する', async () => {
    mocks.state = makeState({
      plugins: [],
      startupError: { kind: 'corruptState', message: 'bad json' },
    })
    renderWithProviders(<PluginsSection />)

    expect(
      await screen.findByTestId('plugins-startup-error')
    ).toHaveTextContent('bad json')
  })
})
