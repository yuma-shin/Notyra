import { useTranslation } from 'react-i18next'
import { FiTrash2, FiTag, FiClock } from 'react-icons/fi'
import { SimpleTooltip } from './editor/Tooltip'
import type { MarkdownNoteMeta } from '@/shared/types'

interface NoteItemProps {
  note: MarkdownNoteMeta
  isSelected: boolean
  onSelect: () => void
  onDoubleClick: () => void
  onDelete?: () => void
}

export function NoteItem({
  note,
  isSelected,
  onSelect,
  onDoubleClick,
  onDelete,
}: NoteItemProps) {
  const { t } = useTranslation()
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return ''
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return ''
    }
  }

  return (
    <div
      className={`relative transition-all duration-200 group border-b border-gray-200 dark:border-gray-700 ${
        isSelected ? 'shadow-sm' : 'hover:bg-gray-100 dark:hover:bg-gray-800/50'
      }`}
      style={
        isSelected ? { background: 'var(--theme-accent-subtle)' } : undefined
      }
    >
      <button
        className="w-full cursor-pointer text-left p-2.5"
        onClick={onSelect}
        onDoubleClick={onDoubleClick}
        type="button"
      >
        <div className="mb-1 flex items-center gap-2 pr-7">
          <h3 className="flex-1 line-clamp-1 text-sm font-semibold text-gray-800 dark:text-gray-100">
            {note.title}
          </h3>
        </div>
        {note.excerpt && (
          <p className="mb-1 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">
            {note.excerpt}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {note.tags && note.tags.length > 0 && (
            <div className="flex items-center gap-1">
              <FiTag size={12} style={{ color: 'var(--theme-accent)' }} />
              <div className="flex gap-1">
                {note.tags.slice(0, 3).map(tag => (
                  <span
                    className="rounded px-1.5 py-0.5 text-xs"
                    key={tag}
                    style={{
                      background: 'var(--theme-accent-subtle)',
                      color: 'var(--theme-accent)',
                    }}
                  >
                    {tag}
                  </span>
                ))}
                {note.tags.length > 3 && (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    +{note.tags.length - 3}
                  </span>
                )}
              </div>
            </div>
          )}
          {note.updatedAt && (
            <div className="ml-auto flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <FiClock size={12} />
              <span>{formatDate(note.updatedAt)}</span>
            </div>
          )}
        </div>
      </button>
      {onDelete && (
        <SimpleTooltip content={t('noteItem.delete')} placement="top">
          <button
            aria-label={t('noteItem.delete')}
            className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-red-600 dark:text-red-400"
            onClick={onDelete}
            type="button"
          >
            <FiTrash2 size={14} />
          </button>
        </SimpleTooltip>
      )}
    </div>
  )
}
