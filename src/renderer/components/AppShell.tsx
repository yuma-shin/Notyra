import { NotyraLogo } from './NotyraLogo'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CustomTitleBar } from './CustomTitleBar'
import { FolderTree } from './FolderTree'
import { NoteList } from './NoteList'
import { EditorView } from './EditorView'
import { StatusBar } from './StatusBar'
import { useResizablePane } from '@/renderer/hooks/useResizablePane'
import { useEditorStatus } from '@/renderer/hooks/useEditorStatus'
import { useAppVersion } from '@/renderer/hooks/useAppVersion'
import type { UseNoteWorkspaceResult } from '@/renderer/hooks/useNoteWorkspace'
import type { RootFolderTabBarProps } from '@/renderer/components/RootFolderTabBar'
import type { AppSettings, MarkdownNoteMeta } from '@/shared/types'
import type {
  EditorCursorPosition,
  SelectionStats,
} from '@/renderer/lib/codemirror/editorStatus'

const DEFAULT_SIDEBAR_WIDTH = 256
const MIN_SIDEBAR_WIDTH = 180
const MAX_SIDEBAR_WIDTH = 480

const DEFAULT_NOTE_LIST_WIDTH = 320
const MIN_NOTE_LIST_WIDTH = 240
const MAX_NOTE_LIST_WIDTH = 600

export interface AppShellProps {
  workspace: UseNoteWorkspaceResult
  settings: AppSettings
  activeRootPath: string | undefined
  tabBar: RootFolderTabBarProps
  onSidebarWidthCommit: (width: number) => void
  onNoteListWidthCommit: (width: number) => void
  onCreateNote: () => void
  onCreateFolder: () => void
  onDeleteNote: (note: MarkdownNoteMeta) => void
  onDeleteFolder: (folderPath: string) => void
  onSelectNote?: (note: MarkdownNoteMeta) => void
  canGoBack?: boolean
  canGoForward?: boolean
  onGoBack?: () => void
  onGoForward?: () => void
}

export function AppShell({
  workspace,
  settings,
  activeRootPath,
  tabBar,
  onSidebarWidthCommit,
  onNoteListWidthCommit,
  onCreateNote,
  onCreateFolder,
  onDeleteNote,
  onDeleteFolder,
  onSelectNote,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
}: AppShellProps) {
  const { t } = useTranslation()

  const sidebarPane = useResizablePane({
    initialWidth: settings.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH,
    minWidth: MIN_SIDEBAR_WIDTH,
    maxWidth: MAX_SIDEBAR_WIDTH,
    onWidthCommit: onSidebarWidthCommit,
  })

  const noteListPane = useResizablePane({
    initialWidth: settings.noteListWidth ?? DEFAULT_NOTE_LIST_WIDTH,
    minWidth: MIN_NOTE_LIST_WIDTH,
    maxWidth: MAX_NOTE_LIST_WIDTH,
    onWidthCommit: onNoteListWidthCommit,
  })

  const editorStats = useEditorStatus(workspace.noteContent)
  const version = useAppVersion()
  const [cursor, setCursor] = useState<EditorCursorPosition | null>(null)
  const [selectionStats, setSelectionStats] = useState<SelectionStats | null>(
    null
  )

  // ノート切り替え時に前ノートのカーソル/選択状態をリセットする
  useEffect(() => {
    setCursor(null)
    setSelectionStats(null)
  }, [workspace.selectedNote?.filePath])

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <CustomTitleBar
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onGoBack={onGoBack}
        onGoForward={onGoForward}
        onToggleNoteList={workspace.onToggleNoteList}
        onToggleSidebar={workspace.onToggleSidebar}
        showNoteList={workspace.showNoteList}
        showSidebar={workspace.showSidebar}
        tabBar={tabBar}
      />
      <div className="flex-1 flex overflow-hidden">
        {workspace.showSidebar && workspace.folderTree && (
          <>
            <FolderTree
              allNotes={workspace.allNotes}
              filteredNotes={workspace.folderFilteredNotes}
              node={workspace.folderTree}
              onCreateFolder={onCreateFolder}
              onDeleteFolder={onDeleteFolder}
              onSelectFolder={workspace.onSelectFolder}
              onSelectTag={workspace.onSelectTag}
              onShowAllNotes={workspace.onShowAllNotes}
              selectedFolder={workspace.selectedFolder}
              selectedTag={workspace.selectedTag}
              showAllNotes={workspace.showAllNotes}
              totalNotes={workspace.allNotes.length}
              width={sidebarPane.width}
            />
            <button
              aria-label="Resize sidebar"
              className={`w-1 flex-shrink-0 cursor-col-resize transition-colors ${
                sidebarPane.isDragging
                  ? 'bg-[color:var(--theme-accent)]'
                  : 'bg-transparent hover:bg-[color:var(--theme-accent)]'
              }`}
              onMouseDown={sidebarPane.handleProps.onMouseDown}
              type="button"
            />
          </>
        )}
        {workspace.showNoteList && (
          <>
            <NoteList
              noteListMutation={workspace.noteListMutation}
              notes={workspace.filteredNotes}
              onCreateNote={onCreateNote}
              onDeleteNote={onDeleteNote}
              onNoteRemovalComplete={workspace.onNoteRemovalComplete}
              onSelectNote={onSelectNote ?? workspace.onSelectNote}
              rootDir={activeRootPath}
              selectedFolder={workspace.selectedFolder}
              selectedNote={workspace.selectedNote?.filePath || null}
              showAllNotes={workspace.showAllNotes}
              width={noteListPane.width}
            />
            <button
              aria-label="Resize note list"
              className={`w-1 flex-shrink-0 cursor-col-resize transition-colors ${
                noteListPane.isDragging
                  ? 'bg-[color:var(--theme-accent)]'
                  : 'bg-transparent hover:bg-[color:var(--theme-accent)]'
              }`}
              onMouseDown={noteListPane.handleProps.onMouseDown}
              type="button"
            />
          </>
        )}
        {workspace.selectedNote ? (
          <div
            className={`flex-1 min-w-0 h-full transition-opacity duration-300 ${
              workspace.isNoteTransitioning ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <EditorView
              allNotes={workspace.allNotes}
              content={workspace.noteContent}
              currentFolder={workspace.selectedFolder}
              filePath={workspace.selectedNote?.filePath}
              folderTree={workspace.folderTree ?? undefined}
              isSaving={workspace.isSaving}
              layoutMode={settings.editorLayoutMode}
              noteMeta={workspace.selectedNote}
              onChange={workspace.onContentChange}
              onCursorChange={setCursor}
              onLayoutModeChange={workspace.onLayoutModeChange}
              onMetadataChange={workspace.onMetadataChange}
              onNoteMove={workspace.onNoteMove}
              onSaveErrorDismiss={workspace.onSaveErrorDismiss}
              onSelectionStatsChange={setSelectionStats}
              onToggleNoteList={workspace.onToggleNoteList}
              onToggleSidebar={workspace.onToggleSidebar}
              rootDir={activeRootPath}
              saveError={workspace.saveError}
              showNoteList={workspace.showNoteList}
              showSidebar={workspace.showSidebar}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center bg-background">
            <NotyraLogo className="mb-6" size={128} />
            <p className="text-lg text-muted-foreground font-medium">
              {t('editor.selectNote')}
            </p>
            <p className="text-sm text-muted-foreground/70 mt-2">
              {t('editor.selectNoteHint')}
            </p>
          </div>
        )}
      </div>
      <StatusBar
        cursor={workspace.selectedNote ? cursor : null}
        selectionStats={workspace.selectedNote ? selectionStats : null}
        stats={workspace.selectedNote ? editorStats : null}
        version={version}
      />
    </div>
  )
}
