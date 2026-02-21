import { useEffect } from 'react'
import { FiSun, FiMoon, FiMonitor } from 'react-icons/fi'
import { useTranslation } from 'react-i18next'
import { useApp } from '../contexts/AppContext'
import { SimpleTooltip } from './editor/Tooltip'
import type { AppSettings } from '@/shared/types'

export function ThemeToggle() {
  const { settings, updateSettings } = useApp()
  const { t } = useTranslation()

  useEffect(() => {
    const applyTheme = () => {
      const root = document.documentElement
      let isDark = false

      if (settings.theme === 'dark') {
        isDark = true
      } else if (settings.theme === 'light') {
        isDark = false
      } else {
        // system
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      }

      if (isDark) {
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
      }
    }

    applyTheme()

    // システム設定の変更を監視
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      if (settings.theme === 'system') {
        applyTheme()
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [settings.theme])

  const cycleTheme = () => {
    const themes: AppSettings['theme'][] = ['light', 'dark', 'system']
    const currentIndex = themes.indexOf(settings.theme)
    const nextTheme = themes[(currentIndex + 1) % themes.length]
    updateSettings({ theme: nextTheme })
  }

  const getIcon = () => {
    switch (settings.theme) {
      case 'light':
        return <FiSun size={16} />
      case 'dark':
        return <FiMoon size={16} />
      case 'system':
        return <FiMonitor size={16} />
    }
  }

  const getLabel = () => {
    switch (settings.theme) {
      case 'light':
        return t('theme.light')
      case 'dark':
        return t('theme.dark')
      case 'system':
        return t('theme.system')
    }
  }

  return (
    <SimpleTooltip content={getLabel()}>
      <button
        className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-white/15 transition-all duration-200 text-gray-600 dark:text-white"
        onClick={cycleTheme}
        type="button"
      >
        {getIcon()}
      </button>
    </SimpleTooltip>
  )
}
