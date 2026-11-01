import { useTranslation } from 'react-i18next'
import { LuPalette, LuType, LuGlobe, LuPuzzle } from 'react-icons/lu'
import { cn } from '../../lib/utils'

export type SettingsSection = 'appearance' | 'font' | 'language' | 'plugins'

interface SettingsSidebarProps {
  activeSection: SettingsSection
  onSectionChange: (section: SettingsSection) => void
}

const SECTIONS: Array<{
  id: SettingsSection
  icon: React.ComponentType<{ size?: number }>
  labelKey: string
}> = [
  { id: 'appearance', icon: LuPalette, labelKey: 'settings.appearance' },
  { id: 'font', icon: LuType, labelKey: 'settings.font' },
  { id: 'language', icon: LuGlobe, labelKey: 'settings.language' },
  { id: 'plugins', icon: LuPuzzle, labelKey: 'settings.plugins' },
]

export function SettingsSidebar({
  activeSection,
  onSectionChange,
}: SettingsSidebarProps) {
  const { t } = useTranslation()

  return (
    <nav aria-label={t('settings.navigation')}>
      <ul className="flex flex-col gap-1">
        {SECTIONS.map(({ id, icon: Icon, labelKey }) => {
          const isActive = activeSection === id
          return (
            <li key={id}>
              <button
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground'
                )}
                onClick={() => onSectionChange(id)}
                type="button"
              >
                <Icon size={16} />
                <span>{t(labelKey)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
