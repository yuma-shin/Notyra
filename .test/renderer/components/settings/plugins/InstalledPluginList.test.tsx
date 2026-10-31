import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
  waitFor,
} from '@testing-library/react'
import {
  InstalledPluginList,
  type InstalledPluginListProps,
} from '@/renderer/components/settings/plugins/InstalledPluginList'
import type { InstalledPluginView } from '@/shared/plugin/types'

const APP_VERSION = '1.2.0'

function featureJson(
  id: string,
  overrides: { displayName?: string; range?: string; author?: string } = {}
): string {
  return JSON.stringify({
    name: id,
    version: '1.0.0',
    author: overrides.author ?? 'Jane Doe',
    notyra: {
      displayName: overrides.displayName ?? `Plugin ${id}`,
      type: 'feature',
      notyraVersion: overrides.range ?? '^1.0.0',
      main: 'dist/index.js',
      permissions: [],
      settings: [
        { key: 'depth', title: 'Depth', type: 'number', default: 3 },
      ],
    },
  })
}

function plugin(
  id: string,
  overrides: Partial<InstalledPluginView> = {}
): InstalledPluginView {
  return {
    id,
    version: '1.0.0',
    source: { type: 'github', owner: 'someone', repo: id },
    enabled: true,
    consentedPermissions: [],
    consentedDestinations: [],
    generation: 0,
    installedAt: '2026-01-01T00:00:00.000Z',
    packageJson: featureJson(id),
    ...overrides,
  }
}

function renderList(props: Partial<InstalledPluginListProps> = {}) {
  const handlers = {
    onToggleEnabled: vi.fn(),
    onUninstall: vi.fn(),
    onUpdate: vi.fn(),
    onReloadDev: vi.fn(),
  }
  render(
    <InstalledPluginList
      appVersion={APP_VERSION}
      developerMode={false}
      loadSettings={async () => ({})}
      plugins={[]}
      saveSetting={async () => {}}
      {...handlers}
      {...props}
    />
  )
  return handlers
}

function item(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-plugin-id="${id}"]`)
  if (!el) throw new Error(`item ${id} not found`)
  return el
}

describe('InstalledPluginList', () => {
  afterEach(() => {
    cleanup()
  })

  it('0件なら空の表示を出す', () => {
    renderList()
    expect(screen.getByTestId('installed-plugins-empty')).toBeInTheDocument()
  })

  it('表示名・バージョン・作者・取得元と有効切替を表示し、切替で onToggleEnabled を呼ぶ', () => {
    const { onToggleEnabled } = renderList({ plugins: [plugin('toc')] })
    const el = item('toc')
    expect(within(el).getByTestId('installed-plugin-name')).toHaveTextContent(
      'Plugin toc'
    )
    expect(within(el).getByText('Version 1.0.0')).toBeInTheDocument()
    expect(within(el).getByTestId('installed-plugin-author')).toHaveTextContent(
      'By Jane Doe'
    )
    expect(within(el).getByTestId('installed-plugin-source')).toHaveTextContent(
      'GitHub: someone/toc'
    )
    const toggle = within(el).getByRole('switch', {
      name: 'Enable or disable Plugin toc',
    })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    expect(onToggleEnabled).toHaveBeenCalledWith('toc', false)
  })

  it('Plugin 由来の文言を翻訳・HTML 解釈せずに表示する', () => {
    renderList({
      plugins: [
        plugin('x', {
          packageJson: featureJson('x', {
            displayName: 'plugins.installed.title',
            author: '<img src=x onerror=alert(1)>',
          }),
        }),
      ],
    })
    const el = item('x')
    expect(within(el).getByTestId('installed-plugin-name')).toHaveTextContent(
      'plugins.installed.title'
    )
    expect(within(el).getByTestId('installed-plugin-author')).toHaveTextContent(
      '<img src=x onerror=alert(1)>'
    )
    expect(el.querySelector('img')).toBeNull()
  })

  it('package.json が読めない場合は Plugin_ID を表示名にし、その旨を表示する', () => {
    renderList({
      plugins: [plugin('broken', { packageJson: null }), plugin('bad', { packageJson: '{' })],
    })
    for (const id of ['broken', 'bad']) {
      const el = item(id)
      expect(within(el).getByTestId('installed-plugin-name')).toHaveTextContent(
        id
      )
      expect(
        within(el).getByTestId('installed-plugin-manifest-unreadable')
      ).toBeInTheDocument()
    }
  })

  it('非互換の Plugin は範囲と現在バージョンを表示し、有効切替を操作不可にする', () => {
    const { onToggleEnabled } = renderList({
      plugins: [
        plugin('old', { packageJson: featureJson('old', { range: '^0.5.0' }) }),
      ],
    })
    const el = item('old')
    expect(
      within(el).getByTestId('installed-plugin-incompatible')
    ).toHaveTextContent('supported: ^0.5.0, current: 1.2.0')
    const toggle = within(el).getByRole('switch')
    expect(toggle).toBeDisabled()
    fireEvent.click(toggle)
    expect(onToggleEnabled).not.toHaveBeenCalled()
  })

  it('アンインストールは確認ダイアログで確定したときだけ onUninstall を呼ぶ', async () => {
    const { onUninstall } = renderList({ plugins: [plugin('toc')] })
    fireEvent.click(within(item('toc')).getByRole('button', { name: 'Uninstall' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Uninstall "Plugin toc"?')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onUninstall).not.toHaveBeenCalled()

    fireEvent.click(within(item('toc')).getByRole('button', { name: 'Uninstall' }))
    const again = await screen.findByRole('dialog')
    fireEvent.click(within(again).getByRole('button', { name: 'Uninstall' }))
    expect(onUninstall).toHaveBeenCalledWith('toc')
  })

  it('更新があれば新しいバージョンと更新ボタンを表示し、更新確認の失敗はエラーを表示する', () => {
    const { onUpdate } = renderList({
      plugins: [plugin('a'), plugin('b'), plugin('c')],
      updateChecks: new Map([
        ['a', { id: 'a', status: 'checked', installedVersion: '1.0.0', latestVersion: '1.1.0', hasUpdate: true }],
        ['b', { id: 'b', status: 'checked', installedVersion: '1.0.0', latestVersion: '1.0.0', hasUpdate: false }],
        ['c', { id: 'c', status: 'failed', error: { kind: 'notInstalled', id: 'c' } }],
      ]),
      formatError: e => `formatted:${e.kind}`,
    })
    expect(
      within(item('a')).getByTestId('installed-plugin-update-available')
    ).toHaveTextContent('Version 1.1.0 is available')
    fireEvent.click(within(item('a')).getByRole('button', { name: 'Update' }))
    expect(onUpdate).toHaveBeenCalledWith('a')

    expect(within(item('b')).queryByRole('button', { name: 'Update' })).toBeNull()
    expect(
      within(item('c')).getByTestId('installed-plugin-update-error')
    ).toHaveTextContent('formatted:notInstalled')
  })

  it('Developer_Plugin は開発者モードがオフなら表示しない', () => {
    renderList({
      plugins: [
        plugin('dev', { source: { type: 'local', path: 'C:/dev/plugin' } }),
      ],
    })
    expect(document.querySelector('[data-plugin-id="dev"]')).toBeNull()
    expect(screen.getByTestId('installed-plugins-empty')).toBeInTheDocument()
  })

  it('開発者モードがオンなら開発中表示・同意待ち・再読み込みボタンを表示する', () => {
    const { onReloadDev } = renderList({
      developerMode: true,
      plugins: [
        plugin('dev', {
          source: { type: 'local', path: 'C:/dev/plugin' },
          pendingConsent: { addedPermissions: ['clipboard'], addedDestinations: [] },
        }),
      ],
    })
    const el = item('dev')
    expect(within(el).getByTestId('installed-plugin-dev-badge')).toBeInTheDocument()
    expect(
      within(el).getByTestId('installed-plugin-pending-consent')
    ).toBeInTheDocument()
    expect(within(el).getByTestId('installed-plugin-source')).toHaveTextContent(
      'Local folder: C:/dev/plugin'
    )
    fireEvent.click(within(el).getByRole('button', { name: 'Reload' }))
    expect(onReloadDev).toHaveBeenCalledWith('dev')
  })

  it('セッション内エラーとキーバインド重複を該当 Plugin にだけ表示する', () => {
    renderList({
      plugins: [plugin('a'), plugin('b')],
      errors: [
        { pluginId: 'a', source: 'activate', message: 'boom', windowLabel: 'main', at: '2026-01-01T00:00:00Z' },
      ],
      keybindingConflicts: [
        { pluginId: 'a', key: 'Ctrl-b', command: 'a:bold', with: 'builtin' },
        { pluginId: 'a', key: 'Ctrl-k', command: 'a:link', with: { pluginId: 'b' } },
      ],
    })
    const a = item('a')
    expect(within(a).getByTestId('installed-plugin-errors')).toHaveTextContent(
      'boom'
    )
    const conflicts = within(a).getByTestId('installed-plugin-keybinding-conflicts')
    expect(conflicts).toHaveTextContent('Ctrl-b (a:bold)')
    expect(conflicts).toHaveTextContent('keybinding of plugin Plugin b')
    expect(within(item('b')).queryByTestId('installed-plugin-errors')).toBeNull()
    expect(
      within(item('b')).queryByTestId('installed-plugin-keybinding-conflicts')
    ).toBeNull()
  })

  it('無効な Plugin でも設定ボタンから Plugin_Settings フォームを開ける', async () => {
    renderList({ plugins: [plugin('toc', { enabled: false })] })
    const button = within(item('toc')).getByRole('button', { name: 'Settings' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(
      await within(item('toc')).findByLabelText('Depth')
    ).toBeInTheDocument()
  })

  it('操作中は各ボタンと切替を無効化する', () => {
    renderList({
      plugins: [plugin('toc')],
      busy: new Map([['toc', 'toggle']]),
    })
    const el = item('toc')
    expect(within(el).getByRole('switch')).toBeDisabled()
    expect(within(el).getByRole('button', { name: 'Uninstall' })).toBeDisabled()
  })
})
