import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en.json'
import ja from '../locales/ja.json'

const resources = {
  en: { translation: en },
  ja: { translation: ja },
}

// ブラウザ/システムの言語設定から初期言語を決定
const getInitialLanguage = (): string => {
  // 1. ローカルストレージで保存された言語設定を優先
  const stored = localStorage.getItem('appLanguage')
  if (stored && (stored === 'en' || stored === 'ja')) {
    return stored
  }

  // 2. ブラウザ/システムの言語設定を確認
  const systemLang = navigator.language.toLowerCase()
  
  // 日本語のバリエーション（ja, ja-JP, ja-JP-u-ca-japanese など）
  if (systemLang.startsWith('ja') || systemLang.includes('ja')) {
    return 'ja'
  }
  
  // デフォルトは英語
  return 'en'
}

i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

export default i18n
