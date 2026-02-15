import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@/locales/en.json'
import ja from '@/locales/ja.json'
import { createMockWindowApp } from './window-app-mock'

// i18n setup for tests
if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      ja: { translation: ja },
    },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  })
}

beforeEach(() => {
  window.App = createMockWindowApp()
})
