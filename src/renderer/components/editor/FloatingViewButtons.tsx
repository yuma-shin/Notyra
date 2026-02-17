import { FiEdit3, FiEye, FiColumns } from 'react-icons/fi'
import { ImagePlus } from 'lucide-react'
import type { AppSettings } from '@/shared/types'

interface FloatingViewButtonsProps {
  layoutMode: AppSettings['editorLayoutMode']
  onLayoutModeChange: (mode: AppSettings['editorLayoutMode']) => void
  onImageInsert?: () => void
  isImageInserting?: boolean
}

export function FloatingViewButtons({
  layoutMode,
  onLayoutModeChange,
  onImageInsert,
  isImageInserting = false,
}: FloatingViewButtonsProps) {
  return (
    <div className="fixed bottom-6 right-6 z-50 opacity-0 translate-x-4 pointer-events-none transition-all duration-300 group-hover/editor-view:opacity-100 group-hover/editor-view:translate-x-0 group-hover/editor-view:pointer-events-auto">
      <div className="bg-white/70 dark:bg-gray-900/70 backdrop-blur-md rounded-xl shadow-2xl border border-white/20 dark:border-gray-700/50 p-1.5 flex flex-col gap-1">
        {onImageInsert && layoutMode !== 'preview' && (
          <>
            <button
              aria-label="画像を挿入"
              className="p-2 rounded-md transition-all duration-200 text-gray-600 dark:text-gray-400 hover:bg-purple-50 dark:hover:bg-purple-900/30 hover:text-purple-600 dark:hover:text-purple-400 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isImageInserting}
              onClick={onImageInsert}
              title="画像を挿入"
              type="button"
            >
              <ImagePlus size={16} />
            </button>
            <div className="h-px bg-gray-200/60 dark:bg-gray-700/60 mx-1" />
          </>
        )}
        <button
          className={`p-2 rounded-md transition-all duration-200 ${
            layoutMode === 'editor'
              ? 'bg-purple-500 text-white'
              : 'text-gray-600 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-gray-800/50'
          }`}
          onClick={() => onLayoutModeChange('editor')}
          title="エディタのみ"
          type="button"
        >
          <FiEdit3 size={16} />
        </button>
        <button
          className={`p-2 rounded-md transition-all duration-200 ${
            layoutMode === 'split'
              ? 'bg-purple-500 text-white'
              : 'text-gray-600 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-gray-800/50'
          }`}
          onClick={() => onLayoutModeChange('split')}
          title="分割表示"
          type="button"
        >
          <FiColumns size={16} />
        </button>
        <button
          className={`p-2 rounded-md transition-all duration-200 ${
            layoutMode === 'preview'
              ? 'bg-purple-500 text-white'
              : 'text-gray-600 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-gray-800/50'
          }`}
          onClick={() => onLayoutModeChange('preview')}
          title="プレビューのみ"
          type="button"
        >
          <FiEye size={16} />
        </button>
      </div>
    </div>
  )
}
