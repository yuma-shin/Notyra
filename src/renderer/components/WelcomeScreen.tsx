import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FiFolder, FiZap, FiFileText, FiHeart } from 'react-icons/fi'

interface WelcomeScreenProps {
  onSelect: (path: string) => void
}

export function WelcomeScreen({ onSelect }: WelcomeScreenProps) {
  const { t } = useTranslation()
  const [isSelecting, setIsSelecting] = useState(false)

  const handleSelectFolder = async () => {
    setIsSelecting(true)
    try {
      const path = await window.App.markdown.selectRootFolder()
      if (path) {
        onSelect(path)
      }
    } catch (error) {
      console.error('Failed to select folder:', error)
    } finally {
      setIsSelecting(false)
    }
  }

  // FlowMarkロゴSVG（大きめ）
  const FlowMarkLogo = () => (
    <svg
      fill="none"
      height="80"
      viewBox="0 0 80 80"
      width="80"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id="welcome-gradient"
          x1="0%"
          x2="100%"
          y1="0%"
          y2="100%"
        >
          <stop offset="0%" stopColor="#667eea" />
          <stop offset="50%" stopColor="#764ba2" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      {/* 流れるようなドキュメントの形 */}
      <path
        d="M20 6C16.6863 6 14 8.68629 14 12V68C14 71.3137 16.6863 74 20 74H60C63.3137 74 66 71.3137 66 68V26L46 6H20Z"
        fill="url(#welcome-gradient)"
        opacity="0.9"
      />
      <path
        d="M46 6V20C46 23.3137 48.6863 26 52 26H66"
        fill="url(#welcome-gradient)"
        opacity="0.6"
      />
      {/* マークダウン記号 */}
      <path
        d="M24 36H38M24 46H44M24 56H34"
        stroke="white"
        strokeLinecap="round"
        strokeWidth="4"
      />
      <circle cx="50" cy="46" fill="white" opacity="0.9" r="4" />
      <circle cx="56" cy="56" fill="white" opacity="0.7" r="3" />
    </svg>
  )

  return (
    <div
      className="flex-1 flex items-center justify-center overflow-auto"
      style={{
        background:
          'linear-gradient(135deg, rgba(102, 126, 234, 0.95) 0%, rgba(118, 75, 162, 0.95) 50%, rgba(167, 139, 250, 0.95) 100%)',
      }}
    >
      <div className="max-w-2xl w-full mx-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* メインコンテンツ */}
        <div className="text-center mb-8">
          {/* ロゴ */}
          <div className="flex justify-center mb-6">
            <FlowMarkLogo />
          </div>

          {/* タイトル */}
          <h1 className="text-5xl font-bold text-white mb-4 tracking-tight">
            {t('welcome.title')}
          </h1>
          <p className="text-xl text-white/90 mb-8 font-light">
            {t('welcome.subtitle')}
          </p>

          {/* 特徴カード */}
          <div className="grid grid-cols-3 gap-4 mb-10 px-8">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
              <FiZap className="text-white mx-auto mb-2" size={28} />
              <p className="text-white text-sm font-medium">
                {t('welcome.features.speed')}
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
              <FiFileText className="text-white mx-auto mb-2" size={28} />
              <p className="text-white text-sm font-medium">
                {t('welcome.features.preview')}
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-4 border border-white/20">
              <FiHeart className="text-white mx-auto mb-2" size={28} />
              <p className="text-white text-sm font-medium">
                {t('welcome.features.ui')}
              </p>
            </div>
          </div>

          {/* フォルダ選択ボタン */}
          <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl p-8 border border-white/30">
            <p className="text-gray-700 mb-6 text-lg">
              {t('welcome.selectFolderText')}
            </p>
            <button
              className="w-full flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 disabled:from-gray-400 disabled:to-gray-500 text-white rounded-xl font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-200 disabled:cursor-not-allowed"
              disabled={isSelecting}
              onClick={handleSelectFolder}
              type="button"
            >
              <FiFolder size={24} />
              {isSelecting
                ? t('welcome.selectButtonSelecting')
                : t('welcome.selectButtonText')}
            </button>
            <p className="text-gray-500 text-sm mt-4">
              {t('welcome.selectFolderHint')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
