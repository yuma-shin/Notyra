import { describe, it, expect, vi, afterEach } from 'vitest'
const mockPluginHost = vi.hoisted(() => vi.fn())
vi.mock('@/renderer/lib/plugins/host/pluginHost', () => ({
  PluginHost: mockPluginHost,
}))
import { screen, cleanup, fireEvent, within } from '@testing-library/react'
import { renderWithProviders } from '../../helpers/test-app-provider'
import { SettingsScreen } from '@/renderer/screens/settings'
import { useMediaQuery } from '@/renderer/hooks/useMediaQuery'

// Mock tauriApi with platform 'Win32' (Windows behavior by default)
vi.mock('@/renderer/lib/tauriApi', () => ({
  tauriApi: {
    window: {
      minimize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      isMaximized: vi.fn().mockResolvedValue(false),
      openSettingsWindow: vi.fn().mockResolvedValue(true),
    },
    platform: 'Win32',
  },
}))

// Mock useSystemFonts to avoid Tauri font calls
vi.mock('@/renderer/hooks/useSystemFonts', () => ({
  useSystemFonts: () => ({
    fonts: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

// Mock useMediaQuery to control responsive behavior
vi.mock('@/renderer/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(() => true), // default: desktop
}))

describe('SettingsScreen', () => {
  it('does not start PluginHost in the settings window', () => {
    renderWithProviders(<SettingsScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Plugins' }))
    expect(mockPluginHost).not.toHaveBeenCalled()
  })
  afterEach(() => {
    cleanup()
    vi.mocked(useMediaQuery).mockReturnValue(true) // reset to desktop
  })

  it('renders SettingsTitlebar with data-tauri-drag-region', () => {
    renderWithProviders(<SettingsScreen />)

    // The titlebar div has data-tauri-drag-region attribute
    const titlebar = screen
      .getByText('Settings')
      .closest('[data-tauri-drag-region]')
    expect(titlebar).toBeInTheDocument()
  })

  it('displays two-column layout at desktop width (>=640px)', () => {
    vi.mocked(useMediaQuery).mockReturnValue(true)
    const { container } = renderWithProviders(<SettingsScreen />)

    // Sidebar with w-48 class should exist
    const sidebar = container.querySelector('.w-48')
    expect(sidebar).toBeInTheDocument()

    // SettingsSidebar navigation should be present
    expect(screen.getByRole('navigation')).toBeInTheDocument()
  })

  it('displays single-column layout at mobile width (<640px)', () => {
    vi.mocked(useMediaQuery).mockReturnValue(false)
    const { container } = renderWithProviders(<SettingsScreen />)

    // No sidebar in mobile layout
    expect(container.querySelector('.w-48')).not.toBeInTheDocument()

    // All sections should be rendered stacked
    // AppearanceSection renders "Theme Mode" heading
    expect(screen.getByText('Theme Mode')).toBeInTheDocument()
    // FontSection renders "Font" heading via t('settings.font')
    expect(screen.getByText('Font')).toBeInTheDocument()
    // LanguageSection renders "Language" heading via t('settings.language')
    expect(screen.getByText('Language')).toBeInTheDocument()
  })

  // Req 1.1, 1.2: サイドバーの「プラグイン」を選択すると Plugins_Tab を表示する
  it('shows the plugins section when the plugins item is selected', () => {
    vi.mocked(useMediaQuery).mockReturnValue(true)
    renderWithProviders(<SettingsScreen />)

    expect(
      screen.queryByRole('region', { name: 'Plugins' })
    ).not.toBeInTheDocument()

    fireEvent.click(
      within(screen.getByRole('navigation')).getByRole('button', {
        name: 'Plugins',
      })
    )

    expect(screen.getByRole('region', { name: 'Plugins' })).toBeInTheDocument()
  })

  it('includes the plugins section in the single-column layout', () => {
    vi.mocked(useMediaQuery).mockReturnValue(false)
    renderWithProviders(<SettingsScreen />)

    expect(screen.getByRole('region', { name: 'Plugins' })).toBeInTheDocument()
  })

  it('shows minimize and close buttons on Windows', () => {
    renderWithProviders(<SettingsScreen />)

    expect(screen.getByRole('button', { name: 'Minimize' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('hides window control buttons on macOS', async () => {
    // Re-mock tauriApi with darwin platform
    const { tauriApi } = await import('@/renderer/lib/tauriApi')
    const originalPlatform = tauriApi.platform
    Object.defineProperty(tauriApi, 'platform', {
      value: 'darwin',
      writable: true,
      configurable: true,
    })

    renderWithProviders(<SettingsScreen />)

    expect(
      screen.queryByRole('button', { name: 'Minimize' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Close' })
    ).not.toBeInTheDocument()

    // Restore platform
    Object.defineProperty(tauriApi, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    })
  })

  it('does NOT include main-window-specific elements', () => {
    renderWithProviders(<SettingsScreen />)

    // No Notyra logo SVG
    expect(screen.queryByTestId('notyra-logo')).not.toBeInTheDocument()

    // No sidebar toggle button
    expect(
      screen.queryByRole('button', { name: 'Toggle Sidebar' })
    ).not.toBeInTheDocument()

    // No note list toggle button
    expect(
      screen.queryByRole('button', { name: 'Toggle Note List' })
    ).not.toBeInTheDocument()

    // No tab bar (RootFolderTabBar)
    expect(screen.queryByTestId('root-folder-tab-bar')).not.toBeInTheDocument()
  })
})
