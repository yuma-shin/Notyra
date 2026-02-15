import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings } from '@/shared/types'

interface AppContextType {
  settings: AppSettings
  updateSettings: (updates: Partial<AppSettings>) => void
  isLoading: boolean
  changeLanguage: (language: 'en' | 'ja') => void
}

const defaultSettings: AppSettings = {
  editorLayoutMode: 'split',
  theme: 'system',
  language: 'en',
  showSidebar: true,
  showNoteList: true,
}

const AppContext = createContext<AppContextType | undefined>(undefined)

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [isLoading, setIsLoading] = useState(true)
  const { i18n } = useTranslation()

  // localStorageから設定を読み込む
  useEffect(() => {
    const loadSettings = () => {
      try {
        const stored = localStorage.getItem('appSettings')
        if (stored) {
          const parsed = JSON.parse(stored)
          const mergedSettings = { ...defaultSettings, ...parsed }
          setSettings(mergedSettings)
          // 言語設定を反映
          if (mergedSettings.language) {
            i18n.changeLanguage(mergedSettings.language)
          }
        }
      } catch (error) {
        console.error('Failed to load settings:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadSettings()

    // 他のウィンドウでの設定変更を検知
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'appSettings' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue)
          const mergedSettings = { ...defaultSettings, ...parsed }
          setSettings(mergedSettings)
          if (mergedSettings.language) {
            i18n.changeLanguage(mergedSettings.language)
          }
        } catch (error) {
          console.error('Failed to sync settings:', error)
        }
      }
    }

    window.addEventListener('storage', handleStorageChange)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [i18n])

  // 設定を更新
  const updateSettings = (updates: Partial<AppSettings>) => {
    setSettings((prev: AppSettings) => {
      const newSettings = { ...prev, ...updates }
      try {
        const serialized = JSON.stringify(newSettings)
        localStorage.setItem('appSettings', serialized)
      } catch (error) {
        console.error('Failed to save settings:', error)
      }
      return newSettings
    })
  }

  // 言語を変更
  const changeLanguage = (language: 'en' | 'ja') => {
    i18n.changeLanguage(language)
    localStorage.setItem('appLanguage', language)
    updateSettings({ language })
  }

  return (
    <AppContext.Provider
      value={{ settings, updateSettings, isLoading, changeLanguage }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp must be used within AppProvider')
  }
  return context
}
