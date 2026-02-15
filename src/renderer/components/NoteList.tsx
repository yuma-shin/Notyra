import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FiFileText, FiPlus, FiSearch, FiX } from 'react-icons/fi'
import type { MarkdownNoteMeta } from '@/shared/types'
import { NoteItem } from './NoteItem'
import { SortDropdown, type SortOption } from './SortDropdown'

interface NoteListProps {
  notes: MarkdownNoteMeta[]
  selectedNote: string | null
  selectedFolder: string | null
  onSelectNote: (note: MarkdownNoteMeta) => void
  onCreateNote?: () => void
  onDeleteNote?: (note: MarkdownNoteMeta) => void
}

const { App } = window

export function NoteList({
  notes,
  selectedNote,
  selectedFolder,
  onSelectNote,
  onCreateNote,
  onDeleteNote,
}: NoteListProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOption, setSortOption] = useState<SortOption>('date-desc')

  // フィルター&ソート処理
  const filteredAndSortedNotes = useMemo(() => {
    let result = [...notes]

    // 検索フィルター
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(note => {
        const titleMatch = note.title.toLowerCase().includes(query)
        const excerptMatch = note.excerpt?.toLowerCase().includes(query)
        const tagsMatch = note.tags?.some(tag =>
          tag.toLowerCase().includes(query)
        )
        return titleMatch || excerptMatch || tagsMatch
      })
    }

    // ソート
    result.sort((a, b) => {
      switch (sortOption) {
        case 'title-asc':
          return a.title.localeCompare(b.title, 'ja')
        case 'title-desc':
          return b.title.localeCompare(a.title, 'ja')
        case 'date-asc':
          return String(a.updatedAt || '').localeCompare(
            String(b.updatedAt || '')
          )
        case 'date-desc':
          return String(b.updatedAt || '').localeCompare(
            String(a.updatedAt || '')
          )
        default:
          return 0
      }
    })

    return result
  }, [notes, searchQuery, sortOption])

  const handleDoubleClick = async (note: MarkdownNoteMeta) => {
    try {
      await App.window.openNoteWindow(note.filePath)
    } catch (error) {
      console.error('Failed to open note in new window:', error)
    }
  }

  const _formatDate = (dateStr?: string) => {
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

  const getFolderDisplayName = () => {
    if (!selectedFolder || selectedFolder === '') {
      return t('noteList.root')
    }
    const parts = selectedFolder.split(/[\\/]/)
    return parts[parts.length - 1]
  }

  return (
    <div className="w-80 border-r border-gray-200 dark:border-gray-700 overflow-y-auto bg-white dark:bg-gray-900 flex flex-col">
      <div
        className="flex-shrink-0 h-12 flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4"
        style={{
          background:
            'linear-gradient(to bottom, rgba(102, 126, 234, 0.05), transparent)',
        }}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <FiFileText
              className="text-purple-600 dark:text-purple-400"
              size={16}
            />
            {getFolderDisplayName()}
          </h2>
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-full">
            {filteredAndSortedNotes.length}
          </span>
        </div>
        {onCreateNote && (
          <button
            className="p-2 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-all duration-200 text-purple-600 dark:text-purple-400 shadow-sm hover:shadow"
            onClick={onCreateNote}
            title={t('noteList.createNoteButton')}
            type="button"
          >
            <FiPlus size={16} />
          </button>
        )}
      </div>

      {/* 検索バー & ソートボタン */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex gap-2">
          <SortDropdown onChange={setSortOption} value={sortOption} />
          <div className="flex-1 relative">
            <FiSearch
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500"
              size={14}
            />
            <input
              className="w-full pl-9 pr-8 py-1.5 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 dark:focus:ring-purple-400 focus:border-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('noteList.searchPlaceholder')}
              type="text"
              value={searchQuery}
            />
            {searchQuery && (
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                onClick={() => setSearchQuery('')}
                type="button"
              >
                <FiX size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredAndSortedNotes.map(note => (
          <NoteItem
            isSelected={selectedNote === note.filePath}
            key={note.id}
            note={note}
            onDelete={onDeleteNote ? () => onDeleteNote(note) : undefined}
            onDoubleClick={() => handleDoubleClick(note)}
            onSelect={() => onSelectNote(note)}
          />
        ))}
        {filteredAndSortedNotes.length === 0 && notes.length === 0 && (
          <div className="p-8 text-center">
            <svg
              className="mx-auto mb-4"
              fill="none"
              height="100"
              viewBox="0 0 200 200"
              width="100"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <linearGradient
                  id="folderGradient"
                  x1="0%"
                  x2="100%"
                  y1="0%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#c084fc" stopOpacity="0.3" />
                </linearGradient>
                <linearGradient
                  id="folderStroke"
                  x1="0%"
                  x2="100%"
                  y1="0%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#c084fc" stopOpacity="0.5" />
                </linearGradient>
              </defs>

              {/* Shadow */}
              <ellipse
                cx="100"
                cy="170"
                fill="#000"
                opacity="0.1"
                rx="70"
                ry="10"
              />

              {/* Folder back */}
              <path
                d="M30 60 L30 150 C30 155 32 160 40 160 L160 160 C168 160 170 155 170 150 L170 80 C170 75 168 70 160 70 L90 70 L80 60 Z"
                fill="url(#folderGradient)"
                stroke="url(#folderStroke)"
                strokeWidth="3"
              />

              {/* Folder tab */}
              <path
                d="M30 60 L75 60 L85 50 L120 50 C125 50 127 52 127 57 L127 70 L30 70 Z"
                fill="url(#folderGradient)"
                stroke="url(#folderStroke)"
                strokeWidth="3"
              />

              {/* Empty indicator - floating papers */}
              <g opacity="0.3">
                <rect
                  fill="#9ca3af"
                  height="40"
                  rx="3"
                  stroke="#6b7280"
                  strokeWidth="2"
                  width="30"
                  x="60"
                  y="90"
                />
                <line
                  stroke="#6b7280"
                  strokeWidth="1.5"
                  x1="67"
                  x2="83"
                  y1="100"
                  y2="100"
                />
                <line
                  stroke="#6b7280"
                  strokeWidth="1.5"
                  x1="67"
                  x2="83"
                  y1="107"
                  y2="107"
                />
                <line
                  stroke="#6b7280"
                  strokeWidth="1.5"
                  x1="67"
                  x2="78"
                  y1="114"
                  y2="114"
                />

                <rect
                  fill="#9ca3af"
                  height="40"
                  rx="3"
                  stroke="#6b7280"
                  strokeWidth="2"
                  width="30"
                  x="110"
                  y="95"
                />
                <line
                  stroke="#6b7280"
                  strokeWidth="1.5"
                  x1="117"
                  x2="133"
                  y1="105"
                  y2="105"
                />
                <line
                  stroke="#6b7280"
                  strokeWidth="1.5"
                  x1="117"
                  x2="133"
                  y1="112"
                  y2="112"
                />
                <line
                  stroke="#6b7280"
                  strokeWidth="1.5"
                  x1="117"
                  x2="128"
                  y1="119"
                  y2="119"
                />
              </g>

              {/* Wind lines suggesting emptiness */}
              <g opacity="0.2">
                <path
                  d="M 50 100 Q 65 98 80 100"
                  stroke="#a78bfa"
                  strokeLinecap="round"
                  strokeWidth="2"
                />
                <path
                  d="M 120 110 Q 135 108 150 110"
                  stroke="#c084fc"
                  strokeLinecap="round"
                  strokeWidth="2"
                />
                <path
                  d="M 55 120 Q 70 118 85 120"
                  stroke="#a78bfa"
                  strokeLinecap="round"
                  strokeWidth="2"
                />
              </g>
            </svg>
            <p className="text-sm text-gray-400 dark:text-gray-500 font-medium">
              {t('noteList.noNotesInFolder')}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-600 mt-2">
              {t('noteList.noNotesHint')}
            </p>
          </div>
        )}
        {filteredAndSortedNotes.length === 0 && notes.length > 0 && (
          <div className="p-8 text-center">
            <FiSearch
              className="mx-auto mb-4 text-gray-300 dark:text-gray-600"
              size={48}
            />
            <p className="text-sm text-gray-400 dark:text-gray-500 font-medium">
              検索結果が見つかりません
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-600 mt-2">
              別のキーワードで検索してみてください
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
