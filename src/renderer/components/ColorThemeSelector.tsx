import { useState, useRef, useEffect } from 'react'
import { FiCheck } from 'react-icons/fi'
import { useTranslation } from 'react-i18next'
import { useApp } from '../contexts/AppContext'
import { builtinThemes, getThemeName } from '../lib/themeManager'
import { SimpleTooltip } from './editor/Tooltip'

export function ColorThemeSelector() {
  const { settings, updateSettings } = useApp()
  const { t, i18n } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const isDark = document.documentElement.classList.contains('dark')

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

  const currentTheme = builtinThemes.find(
    t => t.id === (settings.colorTheme ?? 'grayscale')
  )

  return (
    <div className="relative" ref={containerRef}>
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
        <div className="absolute right-0 top-full mt-1 z-[200] w-52 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {t('colorTheme.title')}
            </p>
          </div>
          <div className="p-1.5 flex flex-col gap-0.5">
            {builtinThemes.map(theme => {
              const isSelected =
                (settings.colorTheme ?? 'grayscale') === theme.id
              const swatches = isDark ? theme.swatchesDark : theme.swatches
              return (
                <button
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors ${
                    isSelected
                      ? 'bg-gray-100 dark:bg-white/10'
                      : 'hover:bg-gray-50 dark:hover:bg-white/5'
                  }`}
                  key={theme.id}
                  onClick={() => handleSelect(theme.id)}
                  type="button"
                >
                  {/* Color swatches */}
                  <span className="flex gap-0.5 shrink-0">
                    {swatches.map(color => (
                      <span
                        className="block rounded-sm"
                        key={color}
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
                  <span className="flex-1 text-sm text-gray-700 dark:text-gray-200">
                    {getThemeName(theme, i18n.language)}
                  </span>
                  {/* Selected checkmark */}
                  {isSelected && (
                    <FiCheck
                      className="text-gray-500 dark:text-gray-400 shrink-0"
                      size={13}
                    />
                  )}
                </button>
              )
            })}
          </div>
          <div className="px-3 py-1.5 border-t border-gray-100 dark:border-gray-800">
            <p className="text-[10px] text-gray-400 dark:text-gray-600">
              {t('colorTheme.hint')}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
