import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, screen, cleanup, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../helpers/test-app-provider'
import { CustomTitleBar } from '@/renderer/components/CustomTitleBar'

const mockMinimize = vi.fn()
const mockMaximize = vi.fn()
const mockClose = vi.fn()
const mockIsMaximized = vi.fn().mockResolvedValue(false)

vi.mock('@/renderer/lib/tauriApi', () => ({
  tauriApi: {
    window: {
      minimize: (...args: unknown[]) => mockMinimize(...args),
      maximize: (...args: unknown[]) => mockMaximize(...args),
      close: (...args: unknown[]) => mockClose(...args),
      isMaximized: (...args: unknown[]) => mockIsMaximized(...args),
    },
    platform: 'Win32',
  },
}))

describe('CustomTitleBar', () => {
  it('toggles the plugin side panel and reflects its persisted open state', () => {
    const onToggleSidePanel = vi.fn()
    renderWithProviders(
      <CustomTitleBar showSidePanel onToggleSidePanel={onToggleSidePanel} />
    )
    const button = screen.getByRole('button', { pressed: true })
    fireEvent.click(button)
    expect(onToggleSidePanel).toHaveBeenCalledTimes(1)
  })
  it('omits the side panel toggle in windows without a handler', () => {
    renderWithProviders(<CustomTitleBar />)
    expect(screen.queryByRole('button', { name: /side panel/i })).toBeNull()
  })
  afterEach(() => {
    cleanup()
  })

  it('data-tauri-drag-region によるドラッグ領域を維持する', () => {
    renderWithProviders(<CustomTitleBar />)
    expect(
      document.querySelectorAll('[data-tauri-drag-region]').length
    ).toBeGreaterThan(0)
  })

  it('サイドバー・ノートリストのトグルボタンがハンドラーを呼ぶ', () => {
    const onToggleSidebar = vi.fn()
    const onToggleNoteList = vi.fn()
    renderWithProviders(
      <CustomTitleBar
        onToggleNoteList={onToggleNoteList}
        onToggleSidebar={onToggleSidebar}
        showNoteList
        showSidebar
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }))
    expect(onToggleSidebar).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle Note List' }))
    expect(onToggleNoteList).toHaveBeenCalledTimes(1)
  })

  it('tabBarを渡すとタブ一覧が表示され、タブ操作のコールバックが呼ばれる', () => {
    const onSelect = vi.fn()
    const onAdd = vi.fn()
    renderWithProviders(
      <CustomTitleBar
        tabBar={{
          tabs: [{ path: '/notes', name: 'notes', status: 'ok' }],
          activePath: '/notes',
          onSelect,
          onClose: vi.fn(),
          onReorder: vi.fn(),
          onAdd,
        }}
      />
    )

    expect(screen.getByText('notes')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add Root Folder' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('tabBarを渡さない場合はタブ領域を表示しない', () => {
    renderWithProviders(<CustomTitleBar />)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('タブ領域はmin-w-0とflex-1を持ち、幅超過時に自身のみが横スクロールする', () => {
    renderWithProviders(
      <CustomTitleBar
        tabBar={{
          tabs: [{ path: '/notes', name: 'notes', status: 'ok' }],
          activePath: '/notes',
          onSelect: vi.fn(),
          onClose: vi.fn(),
          onReorder: vi.fn(),
          onAdd: vi.fn(),
        }}
      />
    )

    const tabContainer = screen.getByTestId('titlebar-tab-container')
    expect(tabContainer).toHaveClass('min-w-0')
    expect(tabContainer).toHaveClass('flex-1')
  })

  it('タブ領域は明示的にh-fullを持ち、子のパーセンテージ高さ解決が壊れないようにする', () => {
    renderWithProviders(
      <CustomTitleBar
        tabBar={{
          tabs: [{ path: '/notes', name: 'notes', status: 'ok' }],
          activePath: '/notes',
          onSelect: vi.fn(),
          onClose: vi.fn(),
          onReorder: vi.fn(),
          onAdd: vi.fn(),
        }}
      />
    )

    const tabContainer = screen.getByTestId('titlebar-tab-container')
    expect(tabContainer).toHaveClass('h-full')
  })

  it('タブ領域はno-dragなので、タブ数に関わらず常時ドラッグ可能な余白を別途用意する', () => {
    renderWithProviders(
      <CustomTitleBar
        tabBar={{
          tabs: [{ path: '/notes', name: 'notes', status: 'ok' }],
          activePath: '/notes',
          onSelect: vi.fn(),
          onClose: vi.fn(),
          onReorder: vi.fn(),
          onAdd: vi.fn(),
        }}
      />
    )

    const tabContainer = screen.getByTestId('titlebar-tab-container')
    const spacer = screen.getByTestId('titlebar-drag-spacer')
    // タブのno-drag領域に飲み込まれないよう、タブコンテナの外側(兄弟)に置く
    expect(tabContainer.contains(spacer)).toBe(false)
    expect(spacer).toHaveAttribute('data-tauri-drag-region')
  })

  it('タブ領域はタイトルバー内で上下中央寄せされる', () => {
    renderWithProviders(
      <CustomTitleBar
        tabBar={{
          tabs: [{ path: '/notes', name: 'notes', status: 'ok' }],
          activePath: '/notes',
          onSelect: vi.fn(),
          onClose: vi.fn(),
          onReorder: vi.fn(),
          onAdd: vi.fn(),
        }}
      />
    )

    const tabContainer = screen.getByTestId('titlebar-tab-container')
    expect(tabContainer).not.toHaveClass('self-end')
  })

  it('タブが増えてもウィンドウ操作ボタン領域はflex-shrink-0で幅を維持する', () => {
    renderWithProviders(<CustomTitleBar />)

    const windowControls = screen.getByTestId('titlebar-window-controls')
    expect(windowControls).toHaveClass('flex-shrink-0')

    const secondaryControls = screen.getByTestId('titlebar-secondary-controls')
    expect(secondaryControls).toHaveClass('flex-shrink-0')
  })

  it('ウィンドウ操作ボタン（最小化・最大化・閉じる）が機能する', async () => {
    renderWithProviders(<CustomTitleBar />)

    await waitFor(() => expect(mockIsMaximized).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    expect(mockMinimize).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }))
    expect(mockMaximize).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(mockClose).toHaveBeenCalledTimes(1)
  })
})
