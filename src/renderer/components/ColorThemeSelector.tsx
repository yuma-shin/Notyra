import type React from 'react'
import { useState, useRef } from 'react'
import { LuCheck, LuUpload, LuTrash2 } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import { useApp } from '../contexts/AppContext'
import { usePluginColorThemes } from '../hooks/usePluginColorThemes'
import { formatPluginThemeError } from '../lib/plugins/pluginThemeErrorMessage'
import {
  builtinThemes,
  getThemeName,
  loadCustomThemes,
  addCustomTheme,
  mergeThemes,
  removeCustomTheme,
  validateTheme,
  type ColorTheme,
} from '../lib/themeManager'
import { Popover } from './ui/popover'
import { Button } from './ui/button'

export function ColorThemeSelector() {
  const { settings, updateSettings } = useApp()
  const { t, i18n } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [customThemes, setCustomThemes] = useState<ColorTheme[]>(() =>
    loadCustomThemes()
  )
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Plugin_Host_Window では PluginThemeRegistry、設定ウィンドウではテーマ JSON を読み込んだ一覧
  const { themes: pluginThemes, errors: pluginThemeErrors } =
    usePluginColorThemes()

  const isDark = document.documentElement.classList.contains('dark')

  const allThemes = mergeThemes(builtinThemes, customThemes, pluginThemes)
  const currentTheme = allThemes.find(
    th => th.id === (settings.colorTheme ?? 'gray')
  )

  const handleSelect = (themeId: string) => {
    updateSettings({ colorTheme: themeId })
    setIsOpen(false)
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
    <>
      <input
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />
      <Popover
        onOpenChange={setIsOpen}
        open={isOpen}
        placement="bottom-end"
        trigger={
          <Button
            aria-label={t('colorTheme.tooltip')}
            className="flex items-center gap-1"
            size="icon"
            variant="ghost"
          >
            {/* Mini swatch preview */}
            <span className="flex gap-0.5 items-center">
              {(isDark ? currentTheme?.swatchesDark : currentTheme?.swatches)
                ?.slice(0, 3)
                .map((color, i) => (
                  <span
                    className="block rounded-full"
                    key={color}
                    style={{
                      width: i === 0 ? 8 : 6,
                      height: i === 0 ? 8 : 6,
                      background: color,
                      border: '1px solid rgba(128,128,128,0.3)',
                    }}
                  />
                ))}
            </span>
          </Button>
        }
      >
        <div className="w-56 overflow-hidden">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-caption font-semibold text-muted-foreground uppercase tracking-wider">
              {t('colorTheme.title')}
            </p>
          </div>
          <div className="p-1.5 flex flex-col gap-0.5 max-h-64 overflow-y-auto">
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
                  className={`group/row w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer transition-colors ${
                    isSelected ? 'bg-accent' : 'hover:bg-accent/60'
                  }`}
                  key={theme.id}
                  onClick={() => handleSelect(theme.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ')
                      handleSelect(theme.id)
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
          <div className="px-3 py-1.5 border-t border-border">
            {pluginThemeErrors.length > 0 && (
              <ul className="mb-1.5" role="alert">
                {pluginThemeErrors.map(error => (
                  <li
                    className="text-[10px] text-destructive"
                    key={error.pluginId}
                  >
                    {formatPluginThemeError(t, error)}
                  </li>
                ))}
              </ul>
            )}
            {importError && (
              <p className="text-[10px] text-destructive mb-1.5">
                {importError}
              </p>
            )}
            <button
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-accent transition-colors"
              onClick={handleImportClick}
              type="button"
            >
              <LuUpload size={11} />
              {t('colorTheme.import')}
            </button>
          </div>
        </div>
      </Popover>
    </>
  )
}
