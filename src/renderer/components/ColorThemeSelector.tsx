import type React from 'react'
import { useState, useRef, useEffect } from 'react'
import { FiCheck, FiUpload, FiTrash2 } from 'react-icons/fi'
import { useTranslation } from 'react-i18next'
import { useApp } from '../contexts/AppContext'
import {
  builtinThemes,
  getThemeName,
  loadCustomThemes,
  addCustomTheme,
  removeCustomTheme,
  validateTheme,
  type ColorTheme,
} from '../lib/themeManager'
import { SimpleTooltip } from './editor/Tooltip'

export function ColorThemeSelector() {
  const { settings, updateSettings } = useApp()
  const { t, i18n } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [customThemes, setCustomThemes] = useState<ColorTheme[]>(() =>
    loadCustomThemes()
  )
  const [importError, setImportError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isDark = document.documentElement.classList.contains('dark')

  const allThemes = [...builtinThemes, ...customThemes]
  const currentTheme = allThemes.find(
    th => th.id === (settings.colorTheme ?? 'grayscale')
  )

  // クリック外で閉じる
  useEffect(() => {
    if (!isOpen) return
    const handlePointerDown = (e: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isOpen])

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
      updateSettings({ colorTheme: 'grayscale' })
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <input
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />
      <SimpleTooltip content={t('colorTheme.tooltip')}>
        <button
          aria-label={t('colorTheme.tooltip')}
          className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/15 transition-all duration-200 flex items-center gap-1"
          onClick={() => setIsOpen(v => !v)}
          type="button"
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
        </button>
      </SimpleTooltip>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 z-[200] w-56 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {t('colorTheme.title')}
            </p>
          </div>
          <div className="p-1.5 flex flex-col gap-0.5 max-h-64 overflow-y-auto">
            {allThemes.map(theme => {
              const isSelected =
                (settings.colorTheme ?? 'grayscale') === theme.id
              const isBuiltin = builtinThemes.some(b => b.id === theme.id)
              const swatches = isDark ? theme.swatchesDark : theme.swatches
              return (
                <div
                  aria-selected={isSelected}
                  className={`group/row w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-gray-100 dark:bg-white/10'
                      : 'hover:bg-gray-50 dark:hover:bg-white/5'
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
                  <span className="flex-1 text-sm text-gray-700 dark:text-gray-200 truncate">
                    {getThemeName(theme, i18n.language)}
                  </span>
                  {/* Selected checkmark */}
                  {isSelected && (
                    <FiCheck
                      className="text-gray-500 dark:text-gray-400 shrink-0"
                      size={13}
                    />
                  )}
                  {/* Delete button for custom themes */}
                  {!isBuiltin && (
                    <button
                      className="opacity-0 group-hover/row:opacity-100 p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 text-gray-400 dark:text-gray-500 shrink-0 transition-all"
                      onClick={e => handleDelete(theme.id, e)}
                      title={t('colorTheme.delete')}
                      type="button"
                    >
                      <FiTrash2 size={12} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <div className="px-3 py-1.5 border-t border-gray-100 dark:border-gray-800">
            {importError && (
              <p className="text-[10px] text-red-500 dark:text-red-400 mb-1.5">
                {importError}
              </p>
            )}
            <button
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
              onClick={handleImportClick}
              type="button"
            >
              <FiUpload size={11} />
              {t('colorTheme.import')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
