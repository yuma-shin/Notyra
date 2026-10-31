import type React from 'react'
import { useState, useRef } from 'react'
import {
  LuSun,
  LuMoon,
  LuMonitor,
  LuCheck,
  LuUpload,
  LuTrash2,
} from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import { useApp } from '../../contexts/AppContext'
import { usePluginColorThemes } from '../../hooks/usePluginColorThemes'
import { formatPluginThemeError } from '../../lib/plugins/pluginThemeErrorMessage'
import {
  builtinThemes,
  getThemeName,
  loadCustomThemes,
  addCustomTheme,
  mergeThemes,
  removeCustomTheme,
  validateTheme,
  type ColorTheme,
} from '../../lib/themeManager'
import { cn } from '../../lib/utils'
import type { AppSettings } from '@/shared/types'

const themeModes: {
  mode: AppSettings['theme']
  icon: typeof LuSun
  labelKey: string
}[] = [
  { mode: 'light', icon: LuSun, labelKey: 'theme.light' },
  { mode: 'dark', icon: LuMoon, labelKey: 'theme.dark' },
  { mode: 'system', icon: LuMonitor, labelKey: 'theme.system' },
]

export function AppearanceSection() {
  const { settings, updateSettings } = useApp()
  const { t, i18n } = useTranslation()
  const [customThemes, setCustomThemes] = useState<ColorTheme[]>(() =>
    loadCustomThemes()
  )
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 設定ウィンドウでは Theme_Plugin のテーマ JSON をデータとして読み込む（コードは実行しない）
  const { themes: pluginThemes, errors: pluginThemeErrors } =
    usePluginColorThemes()

  const isDark = document.documentElement.classList.contains('dark')

  const allThemes = mergeThemes(builtinThemes, customThemes, pluginThemes)

  const handleThemeModeChange = (mode: AppSettings['theme']) => {
    updateSettings({ theme: mode })
  }

  const handleSelect = (themeId: string) => {
    updateSettings({ colorTheme: themeId })
  }

  const handleImportClick = () => {
    setImportError(null)
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target?.result as string) as Record<
          string,
          unknown
        >
        if (!validateTheme(data)) {
          setImportError(t('colorTheme.importError'))
          return
        }
        if (builtinThemes.some(b => b.id === data.id)) {
          setImportError(t('colorTheme.importDuplicate'))
          return
        }
        const theme: ColorTheme = {
          ...(data as unknown as ColorTheme),
          nameJa:
            typeof data.nameJa === 'string'
              ? data.nameJa
              : (data.name as string),
        }
        addCustomTheme(theme)
        setCustomThemes(loadCustomThemes())
        setImportError(null)
      } catch {
        setImportError(t('colorTheme.importError'))
      }
    }
    reader.readAsText(file)
    // 同じファイルを再インポートできるようにリセット
    e.target.value = ''
  }

  const handleDelete = (themeId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    removeCustomTheme(themeId)
    setCustomThemes(loadCustomThemes())
    if (settings.colorTheme === themeId) {
      updateSettings({ colorTheme: 'gray' })
    }
  }

  return (
    <section className="flex flex-col gap-6">
      {/* Theme Mode Selection */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-foreground">
          {t('theme.title', 'Theme Mode')}
        </h3>
        <div className="flex gap-1">
          {themeModes.map(({ mode, icon: Icon, labelKey }) => (
            <button
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                settings.theme === mode
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/60'
              )}
              key={mode}
              onClick={() => handleThemeModeChange(mode)}
              type="button"
            >
              <Icon size={16} />
              <span>{t(labelKey)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Color Theme Selection */}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-foreground">
          {t('colorTheme.title', 'Color Theme')}
        </h3>
        <div className="flex flex-col gap-0.5 max-h-64 overflow-y-auto rounded-md border border-border p-1.5">
          {allThemes.map(theme => {
            const isSelected = (settings.colorTheme ?? 'gray') === theme.id
            // 削除できるのはカスタムテーマだけ（Plugin のテーマは Plugins_Tab で管理する）
            const isCustom =
              !builtinThemes.some(b => b.id === theme.id) &&
              customThemes.some(c => c.id === theme.id)
            const swatches = isDark ? theme.swatchesDark : theme.swatches
            return (
              <div
                aria-selected={isSelected}
                className={cn(
                  'group/row w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer transition-colors',
                  isSelected ? 'bg-accent' : 'hover:bg-accent/60'
                )}
                key={theme.id}
                onClick={() => handleSelect(theme.id)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') handleSelect(theme.id)
                }}
                role="option"
                tabIndex={0}
              >
                {/* Color swatches */}
                <span className="flex gap-0.5 shrink-0">
                  {swatches.map((color, i) => (
                    <span
                      className="block rounded-sm"
                      // biome-ignore lint/suspicious/noArrayIndexKey: swatches may have duplicate colors
                      key={i}
                      style={{
                        width: 10,
                        height: 16,
                        background: color,
                        border: '1px solid rgba(128,128,128,0.25)',
                      }}
                    />
                  ))}
                </span>
                {/* Theme name */}
                <span className="flex-1 text-sm text-foreground truncate">
                  {getThemeName(theme, i18n.language)}
                </span>
                {/* Selected checkmark */}
                {isSelected && (
                  <LuCheck
                    className="text-muted-foreground shrink-0"
                    size={13}
                  />
                )}
                {/* Delete button for custom themes */}
                {isCustom && (
                  <button
                    className="opacity-0 group-hover/row:opacity-100 p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 text-muted-foreground shrink-0 transition-all"
                    onClick={e => handleDelete(theme.id, e)}
                    title={t('colorTheme.delete')}
                    type="button"
                  >
                    <LuTrash2 size={12} />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Theme_Plugin のテーマを選択肢に追加できなかった理由（Requirement 11.3、11.4） */}
        {pluginThemeErrors.length > 0 && (
          <ul className="flex flex-col gap-0.5" role="alert">
            {pluginThemeErrors.map(error => (
              <li className="text-xs text-destructive" key={error.pluginId}>
                {formatPluginThemeError(t, error)}
              </li>
            ))}
          </ul>
        )}

        {/* Import section */}
        <div className="flex flex-col gap-1.5">
          {importError && (
            <p className="text-xs text-destructive">{importError}</p>
          )}
          <button
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-accent transition-colors"
            onClick={handleImportClick}
            type="button"
          >
            <LuUpload size={12} />
            {t('colorTheme.import')}
          </button>
        </div>
      </div>

      {/* Hidden file input for theme import */}
      <input
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />
    </section>
  )
}
