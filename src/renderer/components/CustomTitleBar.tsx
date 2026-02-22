import { useEffect, useState } from 'react'
import {
  FiMinus,
  FiMaximize,
  FiMinimize,
  FiX,
  FiFolder,
  FiSidebar,
  FiList,
} from 'react-icons/fi'
import { useTranslation } from 'react-i18next'
import { useApp } from '../contexts/AppContext'
import { SimpleTooltip } from './editor/Tooltip'
import { ThemeToggle } from './ThemeToggle'
import { LanguageToggle } from './LanguageToggle'

const { App } = window

interface CustomTitleBarProps {
  onChangeRootFolder?: () => void
  showSidebar?: boolean
  showNoteList?: boolean
  onToggleSidebar?: () => void
  onToggleNoteList?: () => void
}

export function CustomTitleBar({
  onChangeRootFolder,
  showSidebar,
  showNoteList,
  onToggleSidebar,
  onToggleNoteList,
}: CustomTitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false)
  const { settings } = useApp()
  const { t } = useTranslation()

  useEffect(() => {
    // Electron環境でのみ実行
    if (window.App?.window) {
      App.window.isMaximized().then(setIsMaximized)
    }
  }, [])

  const handleMinimize = async () => {
    if (!window.App?.window) return
    await App.window.minimize()
  }

  const handleMaximize = async () => {
    if (!window.App?.window) return
    await App.window.maximize()
    const maximized = await App.window.isMaximized()
    setIsMaximized(maximized)
  }

  const handleClose = async () => {
    if (!window.App?.window) return
    await App.window.close()
  }

  // ルートフォルダ名を取得
  const getRootFolderName = () => {
    if (!settings.rootDir) return ''
    const parts = settings.rootDir.split(/[\\/]/)
    return parts[parts.length - 1]
  }

  // NotyraロゴSVG
  const NotyraLogo = () => (
    <svg
      fill="none"
      height="24"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient
          id="notyra-gradient"
          x1="0%"
          x2="100%"
          y1="0%"
          y2="100%"
        >
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#c084fc" />
        </linearGradient>
      </defs>
      {/* 流れるようなドキュメントの形 */}
      <path
        className="fill-gray-200 dark:fill-white"
        d="M6 2C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2H6Z"
        fillOpacity="0.95"
      />
      <path
        className="fill-gray-200 dark:fill-white"
        d="M14 2V6C14 7.10457 14.8954 8 16 8H20"
        fillOpacity="0.7"
      />
      {/* マークダウン記号 */}
      <path
        d="M7 11H11M7 14H13M7 17H10"
        stroke="url(#notyra-gradient)"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <circle cx="15" cy="14" fill="url(#notyra-gradient)" r="1.5" />
      <circle
        cx="17"
        cy="17"
        fill="url(#notyra-gradient)"
        fillOpacity="0.6"
        r="1"
      />
    </svg>
  )

  return (
    <div className="h-11 flex items-center justify-between border-b border-gray-200 dark:border-gray-800 select-none relative z-50 bg-white dark:bg-gray-900">
      {/* ドラッグ可能な領域 */}
      <div
        className="flex-1 h-full drag-region flex items-center"
        style={{ WebkitAppRegion: 'drag' } as any}
      >
        <div className="flex items-center h-full px-4 gap-3">
          <div className="flex items-center gap-2">
            <NotyraLogo />
            {/*<span className="text-base font-bold bg-gradient-to-r from-purple-600 to-purple-400 bg-clip-text text-transparent tracking-wide">
              Notyra
            </span>*/}
          </div>
          {settings.rootDir && (
            <>
              <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-0.5" />
              <div
                className="flex items-center gap-1.5"
                style={{ WebkitAppRegion: 'no-drag' } as any}
              >
                <FiFolder
                  className="text-gray-500 dark:text-gray-400"
                  size={14}
                />
                <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                  {getRootFolderName()}
                </span>
                {onChangeRootFolder && (
                  <SimpleTooltip content={t('titleBar.selectFolder')}>
                    <button
                      className="px-2 py-0.5 text-xs font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/30 rounded transition-all duration-200"
                      onClick={onChangeRootFolder}
                      type="button"
                    >
                      {t('titleBar.selectFolder')}
                    </button>
                  </SimpleTooltip>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Control Buttons */}
      <div
        className="flex items-center gap-0.5 mr-1.5"
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        {onToggleSidebar && (
          <SimpleTooltip content={t('titleBar.toggleSidebar')}>
            <button
              className={`p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200 ${
                showSidebar
                  ? 'text-purple-600 dark:text-purple-400'
                  : 'text-gray-400 dark:text-gray-600'
              }`}
              onClick={onToggleSidebar}
              type="button"
            >
              <FiSidebar size={16} />
            </button>
          </SimpleTooltip>
        )}
        {onToggleNoteList && (
          <SimpleTooltip content={t('titleBar.toggleNoteList')}>
            <button
              className={`p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200 ${
                showNoteList
                  ? 'text-purple-600 dark:text-purple-400'
                  : 'text-gray-400 dark:text-gray-600'
              }`}
              onClick={onToggleNoteList}
              type="button"
            >
              <FiList size={16} />
            </button>
          </SimpleTooltip>
        )}
        <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-0.5" />
        <div className="scale-90">
          <ThemeToggle />
        </div>
        <LanguageToggle />
      </div>

      {/* ウィンドウ操作ボタン */}
      <div
        className="flex items-center gap-0.5 mr-1.5"
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        <button
          className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          onClick={handleMinimize}
          type="button"
        >
          <FiMinus className="text-gray-600 dark:text-gray-400" size={16} />
        </button>
        <button
          className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          onClick={handleMaximize}
          type="button"
        >
          {isMaximized ? (
            <FiMinimize
              className="text-gray-600 dark:text-gray-400"
              size={16}
            />
          ) : (
            <FiMaximize
              className="text-gray-600 dark:text-gray-400"
              size={16}
            />
          )}
        </button>
        <button
          className="p-1.5 rounded-md hover:bg-red-500 transition-colors group"
          onClick={handleClose}
          type="button"
        >
          <FiX
            className="text-gray-600 dark:text-gray-400 group-hover:text-white"
            size={16}
          />
        </button>
      </div>
    </div>
  )
}
