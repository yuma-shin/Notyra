import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FiTag, FiX } from 'react-icons/fi'
import { SimpleTooltip } from './editor/Tooltip'
import type { MarkdownNoteMeta } from '@/shared/types'

interface TagListSectionProps {
  allNotes: MarkdownNoteMeta[]
  filteredNotes: MarkdownNoteMeta[]
  selectedTag: string | null
  showAllNotes: boolean
  onSelectTag?: (tag: string | null) => void
}

export function TagListSection({
  allNotes,
  filteredNotes,
  selectedTag,
  showAllNotes,
  onSelectTag,
}: TagListSectionProps) {
  const { t } = useTranslation()
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    // タグリストは常に現在のフィルタ対象のノートから生成
    // (フォルダフィルタは適用するが、タグフィルタは適用しない)
    const notesToProcess = showAllNotes ? allNotes : filteredNotes

    notesToProcess.forEach(note => {
      if (note.tags && Array.isArray(note.tags)) {
        note.tags.forEach(tag => {
          counts.set(tag, (counts.get(tag) || 0) + 1)
        })
      }
    })

    return Array.from(counts.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], 'ja')
    )
  }, [allNotes, filteredNotes, showAllNotes])

  const handleTagClick = (tag: string) => {
    if (!onSelectTag) return
    if (selectedTag === tag) {
      onSelectTag(null)
    } else {
      onSelectTag(tag)
    }
  }

  if (!onSelectTag) return null

  return (
    <div className="border-t border-gray-200 dark:border-gray-700">
      <div className="h-10 flex items-center justify-between px-4 bg-gray-50 dark:bg-gray-800/30">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <FiTag size={14} style={{ color: 'var(--theme-accent)' }} />
            {t('metadata.tags')}
          </h3>
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-full">
            {tagCounts.length}
          </span>
        </div>
        {selectedTag && (
          <SimpleTooltip content={t('common.search')}>
            <button
              className="p-1 rounded transition-all duration-200"
              onClick={() => onSelectTag(null)}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--theme-accent-subtle)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = ''
              }}
              style={{ color: 'var(--theme-accent)' }}
              type="button"
            >
              <FiX size={12} />
            </button>
          </SimpleTooltip>
        )}
      </div>

      <div className="max-h-48 overflow-y-auto p-2">
        {tagCounts.length === 0 ? (
          <div className="p-4 text-center">
            <FiTag
              className="mx-auto mb-2 text-gray-300 dark:text-gray-600"
              size={24}
            />
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {t('noteList.empty')}
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {tagCounts.map(([tag, count]) => (
              <button
                className={`w-full px-2 py-1.5 rounded-lg text-left transition-all duration-200 group flex items-center justify-between ${
                  selectedTag === tag
                    ? 'shadow-sm'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800/50'
                }`}
                key={tag}
                onClick={() => handleTagClick(tag)}
                style={
                  selectedTag === tag
                    ? { background: 'var(--theme-accent-subtle)' }
                    : undefined
                }
                type="button"
              >
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <FiTag
                    className="flex-shrink-0"
                    size={12}
                    style={{
                      color:
                        selectedTag === tag ? 'var(--theme-accent)' : undefined,
                    }}
                  />
                  <span
                    className={`text-xs truncate ${selectedTag === tag ? 'font-semibold' : 'text-gray-700 dark:text-gray-300'}`}
                    style={
                      selectedTag === tag
                        ? { color: 'var(--theme-accent)' }
                        : undefined
                    }
                  >
                    {tag}
                  </span>
                </div>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 ${selectedTag === tag ? 'font-medium' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}
                  style={
                    selectedTag === tag
                      ? {
                          background: 'var(--theme-accent-subtle)',
                          color: 'var(--theme-accent)',
                        }
                      : undefined
                  }
                >
                  {count}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
