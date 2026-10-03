import { useState, useMemo, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { LuFileText, LuPlus, LuSearch, LuX } from 'react-icons/lu'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { MarkdownNoteMeta } from '@/shared/types'
import { SimpleTooltip } from './ui/tooltip'
import { Button } from './ui/button'
import { NoteItem } from './NoteItem'
import { SortDropdown, type SortOption } from './SortDropdown'
import { tauriApi as App } from '@/renderer/lib/tauriApi'
import { useAnimatedNoteList } from '@/renderer/hooks/useAnimatedNoteList'
import type { NoteListMutation } from '@/renderer/lib/noteListAnimation'
import { ANIMATION_DURATION_MS } from '@/renderer/lib/noteListAnimation'

interface NoteListProps {
  notes: MarkdownNoteMeta[]
  selectedNote: string | null
  selectedFolder: string | null
  showAllNotes?: boolean
  onSelectNote: (note: MarkdownNoteMeta) => void
  onCreateNote?: () => void
  onDeleteNote?: (note: MarkdownNoteMeta) => void
  /** 指定時はpxで幅を固定する（未指定時は既存の固定幅クラスを使用） */
  width?: number
  /** ノートを別ウィンドウで開く際に渡す、現在アクティブなルートフォルダのパス */
  rootDir?: string
  /** 直近のノート変更イベント（作成・削除）*/
  noteListMutation?: NoteListMutation | null
  /** 退去アニメーション完了時のコールバック */
  onNoteRemovalComplete?: (filePath: string) => void
}

export function NoteList({
  notes,
  selectedNote,
  selectedFolder,
  showAllNotes = false,
  onSelectNote,
  onCreateNote,
  onDeleteNote,
  width,
  rootDir,
  noteListMutation,
  onNoteRemovalComplete,
}: NoteListProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOption, setSortOption] = useState<SortOption>('date-desc')
  const scrollContainerRef = useRef<HTMLDivElement>(null)

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

  // アニメーション付きノート一覧
  const { displayEntries } = useAnimatedNoteList(
    filteredAndSortedNotes,
    noteListMutation ?? null,
    onNoteRemovalComplete ?? (() => {})
  )

  // 仮想スクロール
  const virtualizer = useVirtualizer({
    count: displayEntries.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 80,
    overscan: 10,
    getItemKey: index => displayEntries[index].note.filePath,
    measureElement:
      typeof window !== 'undefined' &&
      navigator.userAgent.indexOf('Firefox') === -1
        ? element => element?.getBoundingClientRect().height
        : undefined,
  })

  const handleDoubleClick = useCallback(
    async (note: MarkdownNoteMeta) => {
      if (!rootDir) return
      try {
        await App.window.openNoteWindow(note.filePath, rootDir)
      } catch (error) {
        console.error('Failed to open note in new window:', error)
      }
    },
    [rootDir]
  )

  const getFolderDisplayName = () => {
    if (showAllNotes) {
      return t('folderTree.allNotes')
    }
    if (!selectedFolder || selectedFolder === '') {
      return t('noteList.root')
    }
    const parts = selectedFolder.split(/[\\/]/)
    return parts[parts.length - 1]
  }

  return (
    <div
      className={`${width === undefined ? 'w-80' : ''} border-r border-border overflow-y-auto bg-background flex flex-col flex-shrink-0`}
      style={width === undefined ? undefined : { width }}
    >
      <div
        className="border-b border-border flex-shrink-0 h-22 flex flex-col"
        style={{
          background:
            'linear-gradient(to bottom, var(--theme-accent-subtle), transparent)',
        }}
      >
        <div className="h-12 flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <h2 className="text-heading-sm text-foreground flex items-center gap-2">
              <LuFileText size={16} style={{ color: 'var(--theme-accent)' }} />
              {getFolderDisplayName()}
            </h2>
            <span className="text-xs text-muted-foreground font-medium px-2 py-0.5 bg-muted rounded-full">
              {filteredAndSortedNotes.length}
            </span>
          </div>
          {onCreateNote && (
            <SimpleTooltip content={t('noteList.createNoteButton')}>
              <Button
                aria-label={t('noteList.createNoteButton')}
                onClick={onCreateNote}
                size="icon"
                variant="ghost"
              >
                <LuPlus size={16} />
              </Button>
            </SimpleTooltip>
          )}
        </div>

        {/* 検索バー & ソートボタン */}
        <div className="flex-1 min-h-0 flex items-center px-3">
          <div className="flex w-full gap-2">
            <SortDropdown onChange={setSortOption} value={sortOption} />
            <div className="flex-1 relative">
              <LuSearch
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                size={14}
              />
              <input
                className="w-full pl-9 pr-8 py-0.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:border-transparent text-foreground placeholder-muted-foreground"
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('noteList.searchPlaceholder')}
                style={
                  {
                    '--tw-ring-color': 'var(--theme-accent)',
                  } as React.CSSProperties
                }
                type="text"
                value={searchQuery}
              />
              {searchQuery && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground"
                  onClick={() => setSearchQuery('')}
                  type="button"
                >
                  <LuX size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 仮想スクロールリスト */}
      <div
        aria-live="polite"
        className="flex-1 overflow-y-auto"
        ref={scrollContainerRef}
      >
        {filteredAndSortedNotes.length > 0 ? (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map(virtualItem => (
              <div
                data-index={virtualItem.index}
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  marginTop: '5px',
                  transform: `translateY(${virtualItem.start}px)`,
                  transition: noteListMutation
                    ? `transform ${ANIMATION_DURATION_MS}ms ease`
                    : 'none',
                }}
              >
                <NoteItem
                  animationPhase={displayEntries[virtualItem.index].phase}
                  isSelected={
                    selectedNote ===
                    displayEntries[virtualItem.index].note.filePath
                  }
                  note={displayEntries[virtualItem.index].note}
                  onDelete={
                    onDeleteNote
                      ? () =>
                          onDeleteNote(displayEntries[virtualItem.index].note)
                      : undefined
                  }
                  onDoubleClick={() =>
                    handleDoubleClick(displayEntries[virtualItem.index].note)
                  }
                  onSelect={() =>
                    onSelectNote(displayEntries[virtualItem.index].note)
                  }
                />
              </div>
            ))}
          </div>
        ) : notes.length === 0 ? (
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
                  <stop
                    offset="0%"
                    style={{
                      stopColor: 'var(--theme-gradient-from)',
                      stopOpacity: 0.2,
                    }}
                  />
                  <stop
                    offset="100%"
                    style={{
                      stopColor: 'var(--theme-gradient-to)',
                      stopOpacity: 0.3,
                    }}
                  />
                </linearGradient>
                <linearGradient
                  id="folderStroke"
                  x1="0%"
                  x2="100%"
                  y1="0%"
                  y2="100%"
                >
                  <stop
                    offset="0%"
                    style={{
                      stopColor: 'var(--theme-gradient-from)',
                      stopOpacity: 0.4,
                    }}
                  />
                  <stop
                    offset="100%"
                    style={{
                      stopColor: 'var(--theme-gradient-to)',
                      stopOpacity: 0.5,
                    }}
                  />
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
                  stroke="var(--theme-gradient-from)"
                  strokeLinecap="round"
                  strokeWidth="2"
                />
                <path
                  d="M 120 110 Q 135 108 150 110"
                  stroke="var(--theme-gradient-to)"
                  strokeLinecap="round"
                  strokeWidth="2"
                />
                <path
                  d="M 55 120 Q 70 118 85 120"
                  stroke="var(--theme-gradient-from)"
                  strokeLinecap="round"
                  strokeWidth="2"
                />
              </g>
            </svg>
            <p className="text-sm text-muted-foreground font-medium">
              {t(showAllNotes ? 'noteList.empty' : 'noteList.noNotesInFolder')}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-2">
              {t('noteList.noNotesHint')}
            </p>
            {onCreateNote && (
              <Button className="mt-4" onClick={onCreateNote} size="sm">
                <LuPlus size={14} />
                {t('noteList.createNoteButton')}
              </Button>
            )}
          </div>
        ) : (
          <div className="p-8 text-center">
            <LuSearch
              className="mx-auto mb-4 text-muted-foreground/60"
              size={48}
            />
            <p className="text-sm text-muted-foreground font-medium">
              検索結果が見つかりません
            </p>
            <p className="text-xs text-muted-foreground/70 mt-2">
              別のキーワードで検索してみてください
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
