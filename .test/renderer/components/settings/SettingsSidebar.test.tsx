import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, screen, cleanup, render } from '@testing-library/react'
import { SettingsSidebar } from '@/renderer/components/settings/SettingsSidebar'
import type { SettingsSection } from '@/renderer/components/settings/SettingsSidebar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'settings.navigation': 'Settings navigation',
        'settings.appearance': 'Appearance',
        'settings.font': 'Font',
        'settings.language': 'Language',
        'settings.plugins': 'Plugins',
      }
      return translations[key] ?? key
    },
  }),
}))

describe('SettingsSidebar', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders all section navigation items', () => {
    const onSectionChange = vi.fn()
    render(<SettingsSidebar activeSection="appearance" onSectionChange={onSectionChange} />)

    expect(screen.getByText('Appearance')).toBeInTheDocument()
    expect(screen.getByText('Font')).toBeInTheDocument()
    expect(screen.getByText('Language')).toBeInTheDocument()
    expect(screen.getByText('Plugins')).toBeInTheDocument()
  })

  // Req 1.1: 「プラグイン」は末尾（「言語」の下）にアイコン付きで表示される
  it('renders the plugins item last, below language, with an icon', () => {
    const onSectionChange = vi.fn()
    render(<SettingsSidebar activeSection="appearance" onSectionChange={onSectionChange} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons.map(b => b.textContent)).toEqual([
      'Appearance',
      'Font',
      'Language',
      'Plugins',
    ])
    expect(buttons[3].querySelector('svg')).not.toBeNull()
  })

  it('calls onSectionChange with plugins when the plugins item is clicked', () => {
    const onSectionChange = vi.fn()
    render(<SettingsSidebar activeSection="appearance" onSectionChange={onSectionChange} />)

    fireEvent.click(screen.getByText('Plugins'))

    expect(onSectionChange).toHaveBeenCalledWith('plugins' satisfies SettingsSection)
  })

  it('highlights the active section with aria-current', () => {
    const onSectionChange = vi.fn()
    render(<SettingsSidebar activeSection="font" onSectionChange={onSectionChange} />)

    const fontButton = screen.getByText('Font').closest('button')
    const appearanceButton = screen.getByText('Appearance').closest('button')

    expect(fontButton).toHaveAttribute('aria-current', 'true')
    expect(appearanceButton).not.toHaveAttribute('aria-current')
  })

  it('calls onSectionChange when a section is clicked', () => {
    const onSectionChange = vi.fn()
    render(<SettingsSidebar activeSection="appearance" onSectionChange={onSectionChange} />)

    fireEvent.click(screen.getByText('Language'))

    expect(onSectionChange).toHaveBeenCalledWith('language')
  })

  it('renders a nav element with accessible label', () => {
    const onSectionChange = vi.fn()
    render(<SettingsSidebar activeSection="appearance" onSectionChange={onSectionChange} />)

    const nav = screen.getByRole('navigation', { name: 'Settings navigation' })
    expect(nav).toBeInTheDocument()
  })

  it('updates aria-current when activeSection prop changes', () => {
    const onSectionChange = vi.fn()
    const { rerender } = render(
      <SettingsSidebar activeSection="appearance" onSectionChange={onSectionChange} />
    )

    expect(screen.getByText('Appearance').closest('button')).toHaveAttribute('aria-current', 'true')

    rerender(<SettingsSidebar activeSection="language" onSectionChange={onSectionChange} />)

    expect(screen.getByText('Appearance').closest('button')).not.toHaveAttribute('aria-current')
    expect(screen.getByText('Language').closest('button')).toHaveAttribute('aria-current', 'true')
  })
})
