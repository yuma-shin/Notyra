import { useTranslation } from 'react-i18next'
import { FiEdit3, FiEye, FiColumns } from 'react-icons/fi'
import { SimpleTooltip } from './Tooltip'
import type { AppSettings } from '@/shared/types'

interface FloatingViewButtonsProps {
  layoutMode: AppSettings['editorLayoutMode']
  onLayoutModeChange: (mode: AppSettings['editorLayoutMode']) => void
}

export function FloatingViewButtons({
  layoutMode,
  onLayoutModeChange,
}: FloatingViewButtonsProps) {
  const { t } = useTranslation()

  return (
    <div className="fixed bottom-6 right-6 z-50 opacity-0 translate-x-4 pointer-events-none transition-all duration-300 group-hover/editor-view:opacity-100 group-hover/editor-view:translate-x-0 group-hover/editor-view:pointer-events-auto">
      <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-md rounded-xl shadow-2xl border border-white/20 dark:border-gray-700/50 p-1.5 flex flex-col gap-1">
        <SimpleTooltip
          content={t('editor.layoutMode.editorOnly')}
          placement="left"
        >
          <button
            className={`p-2 rounded-md transition-all duration-200 ${
              layoutMode === 'editor'
                ? 'bg-purple-500 text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-gray-800/50'
            }`}
            onClick={() => onLayoutModeChange('editor')}
            type="button"
          >
            <FiEdit3 size={16} />
          </button>
        </SimpleTooltip>
        <SimpleTooltip
          content={t('editor.layoutMode.splitView')}
          placement="left"
        >
          <button
            className={`p-2 rounded-md transition-all duration-200 ${
              layoutMode === 'split'
                ? 'bg-purple-500 text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-gray-800/50'
            }`}
            onClick={() => onLayoutModeChange('split')}
            type="button"
          >
            <FiColumns size={16} />
          </button>
        </SimpleTooltip>
        <SimpleTooltip
          content={t('editor.layoutMode.previewOnly')}
          placement="left"
        >
          <button
            className={`p-2 rounded-md transition-all duration-200 ${
              layoutMode === 'preview'
                ? 'bg-purple-500 text-white'
                : 'text-gray-600 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-gray-800/50'
            }`}
            onClick={() => onLayoutModeChange('preview')}
            type="button"
          >
            <FiEye size={16} />
          </button>
        </SimpleTooltip>
      </div>
    </div>
  )
}
