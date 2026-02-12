import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react'
import type { AppSettings } from '@/shared/types'

interface AppContextType {
  settings: AppSettings
  updateSettings: (updates: Partial<AppSettings>) => void
  isLoading: boolean
}

const defaultSettings: AppSettings = {
  editorLayoutMode: 'split',
  theme: 'system',
  showSidebar: true,
  showNoteList: true,
}

const AppContext = createContext<AppContextType | undefined>(undefined)

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [isLoading, setIsLoading] = useState(true)

  // localStorageから設定を読み込む
  useEffect(() => {
    const loadSettings = () => {
      try {
        const stored = localStorage.getItem('appSettings')
        if (stored) {
          const parsed = JSON.parse(stored)
          const mergedSettings = { ...defaultSettings, ...parsed }
          setSettings(mergedSettings)
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
        } catch (error) {
          console.error('Failed to sync settings:', error)
        }
      }
    }

    window.addEventListener('storage', handleStorageChange)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [])

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

  return (
    <AppContext.Provider value={{ settings, updateSettings, isLoading }}>
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
