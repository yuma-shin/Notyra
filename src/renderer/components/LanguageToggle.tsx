import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FiGlobe } from 'react-icons/fi'
import { useApp } from '../contexts/AppContext'

export function LanguageToggle() {
  const { settings, changeLanguage } = useApp()
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const languages = [
    { code: 'en', name: 'English' },
    { code: 'ja', name: '日本語' },
  ] as const

  return (
    <div className="relative" ref={menuRef}>
      <button
        className="px-2 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-white/15 transition-all duration-200 text-gray-600 dark:text-white flex items-center justify-center"
        onClick={() => setIsOpen(!isOpen)}
        title={t('common.language')}
        type="button"
      >
        <FiGlobe size={16} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-32 bg-white dark:bg-white/10 rounded-md shadow-lg overflow-hidden z-50">
          {languages.map(lang => (
            <button
              className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-white/20 transition-colors ${
                settings.language === lang.code
                  ? 'bg-blue-100 dark:bg-blue-600 text-blue-900 dark:text-white'
                  : 'text-gray-700 dark:text-white'
              }`}
              key={lang.code}
              onClick={() => {
                changeLanguage(lang.code)
                setIsOpen(false)
              }}
              type="button"
            >
              {lang.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
