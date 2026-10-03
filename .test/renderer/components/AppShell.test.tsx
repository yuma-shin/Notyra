import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { AppShell } from '@/renderer/components/AppShell'
import type { UseNoteWorkspaceResult } from '@/renderer/hooks/useNoteWorkspace'
import type { RootFolderTabBarProps } from '@/renderer/components/RootFolderTabBar'
import type { AppSettings, FolderNode, MarkdownNoteMeta } from '@/shared/types'

vi.mock('@/renderer/components/CustomTitleBar', () => ({
  CustomTitleBar: (props: {
    showSidebar?: boolean
    showNoteList?: boolean
    onToggleSidebar?: () => void
    onToggleNoteList?: () => void
    tabBar?: RootFolderTabBarProps
  }) => (
    <div>
      <span data-testid="titlebar-show-sidebar">
        {String(props.showSidebar)}
      </span>
      <button onClick={props.onToggleSidebar} type="button">
        toggle-sidebar
      </button>
      <button onClick={props.onToggleNoteList} type="button">
        toggle-notelist
      </button>
      <button onClick={props.tabBar?.onAdd} type="button">
        add-root
      </button>
    </div>
  ),
}))

vi.mock('@/renderer/components/FolderTree', () => ({
  FolderTree: (props: { width?: number }) => (
    <div data-testid="folder-tree" style={{ width: props.width }} />
  ),
}))

vi.mock('@/renderer/components/NoteList', () => ({
  NoteList: (props: { width?: number }) => (
    <div data-testid="note-list" style={{ width: props.width }} />
  ),
}))

vi.mock('@/renderer/components/EditorView', () => ({
  EditorView: () => <div data-testid="editor-view" />,
}))

const NOTE_META: MarkdownNoteMeta = {
  id: '1',
  title: 'Note1',
  filePath: '/notes/note1.md',
  relativePath: 'note1.md',
}

const FOLDER_TREE: FolderNode = {
  name: '',
  relativePath: '',
  children: [],
  notes: [],
}

const SETTINGS: AppSettings = {
  rootFolders: [{ path: '/notes' }],
  activeRootFolder: '/notes',
  editorLayoutMode: 'split',
  theme: 'system',
  colorTheme: 'gray',
  language: 'en',
}

const TAB_BAR: RootFolderTabBarProps = {
  tabs: [{ path: '/notes', name: 'notes', status: 'ok' }],
  activePath: '/notes',
  onSelect: vi.fn(),
  onClose: vi.fn(),
  onAdd: vi.fn(),
  onReorder: vi.fn(),
}

function createWorkspace(
  overrides: Partial<UseNoteWorkspaceResult> = {}
): UseNoteWorkspaceResult {
  return {
    isLoading: false,
    showRootDialog: false,
    folderTree: FOLDER_TREE,
    allNotes: [],
    filteredNotes: [],
    folderFilteredNotes: [],
    selectedFolder: '',
    selectedTag: null,
    selectedNote: null,
    noteContent: '',
    isSaving: false,
    saveError: null,
    showSidebar: true,
    showNoteList: true,
    isNoteTransitioning: false,
    showAllNotes: false,
    onShowAllNotes: vi.fn(),
    onSelectFolder: vi.fn(),
    onSelectTag: vi.fn(),
    onSelectNote: vi.fn(),
    onContentChange: vi.fn(),
    onCreateNote: vi.fn(),
    onCreateFolder: vi.fn(),
    onDeleteNote: vi.fn(),
    onDeleteFolder: vi.fn(),
    onMetadataChange: vi.fn(),
    onNoteMove: vi.fn(),
    onToggleSidebar: vi.fn(),
    onToggleNoteList: vi.fn(),
    onSaveErrorDismiss: vi.fn(),
    onLayoutModeChange: vi.fn(),
    flushPendingSave: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function renderAppShell(
  overrides: Partial<UseNoteWorkspaceResult> = {},
  props: Partial<
    Omit<Parameters<typeof AppShell>[0], 'workspace' | 'settings'>
  > = {}
) {
  const onSidebarWidthCommit = vi.fn()
  const onNoteListWidthCommit = vi.fn()
  const onCreateNote = vi.fn()
  const onCreateFolder = vi.fn()
  const onDeleteNote = vi.fn()
  const onDeleteFolder = vi.fn()
  const workspace = createWorkspace(overrides)

  render(
    <AppShell
      activeRootPath="/notes"
      onCreateFolder={onCreateFolder}
      onCreateNote={onCreateNote}
      onDeleteFolder={onDeleteFolder}
      onDeleteNote={onDeleteNote}
      onNoteListWidthCommit={onNoteListWidthCommit}
      onSidebarWidthCommit={onSidebarWidthCommit}
      settings={SETTINGS}
      tabBar={TAB_BAR}
      workspace={workspace}
      {...props}
    />
  )

  return {
    workspace,
    onSidebarWidthCommit,
    onNoteListWidthCommit,
  }
}

describe('AppShell', () => {
  afterEach(() => {
    cleanup()
  })

  it('workspaceのshowSidebar/showNoteListをCustomTitleBarに渡す', () => {
    renderAppShell({ showSidebar: true, showNoteList: false })
    expect(screen.getByTestId('titlebar-show-sidebar')).toHaveTextContent(
      'true'
    )
  })

  it('folderTreeが存在しshowSidebarがtrueならFolderTreeを表示する', () => {
    renderAppShell({ showSidebar: true })
    expect(screen.getByTestId('folder-tree')).toBeInTheDocument()
  })

  it('showSidebarがfalseならFolderTreeを表示しない', () => {
    renderAppShell({ showSidebar: false })
    expect(screen.queryByTestId('folder-tree')).not.toBeInTheDocument()
  })

  it('selectedNoteがない場合は空状態を表示する', () => {
    renderAppShell({ selectedNote: null })
    expect(screen.queryByTestId('editor-view')).not.toBeInTheDocument()
  })

  it('selectedNoteがない場合はNotyraロゴ付きの空状態を表示する', () => {
    renderAppShell({ selectedNote: null })
    expect(screen.getByText('Please select a note')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Notyra' })).toBeInTheDocument()
  })

  it('selectedNoteがある場合はEditorViewを表示する', () => {
    renderAppShell({ selectedNote: NOTE_META })
    expect(screen.getByTestId('editor-view')).toBeInTheDocument()
  })

  it('サイドバーのリサイズはonSidebarWidthCommitのみを発火し、onNoteListWidthCommitは発火しない', () => {
    const { onSidebarWidthCommit, onNoteListWidthCommit } = renderAppShell()

    const handle = screen.getByRole('button', { name: 'Resize sidebar' })
    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent(
      document,
      new MouseEvent('mousemove', { clientX: 150, bubbles: true })
    )
    fireEvent(document, new MouseEvent('mouseup', { bubbles: true }))

    expect(onSidebarWidthCommit).toHaveBeenCalledTimes(1)
    expect(onNoteListWidthCommit).not.toHaveBeenCalled()
  })

  it('ノートリストのリサイズはonNoteListWidthCommitのみを発火し、onSidebarWidthCommitは発火しない', () => {
    const { onSidebarWidthCommit, onNoteListWidthCommit } = renderAppShell()

    const handle = screen.getByRole('button', { name: 'Resize note list' })
    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent(
      document,
      new MouseEvent('mousemove', { clientX: 180, bubbles: true })
    )
    fireEvent(document, new MouseEvent('mouseup', { bubbles: true }))

    expect(onNoteListWidthCommit).toHaveBeenCalledTimes(1)
    expect(onSidebarWidthCommit).not.toHaveBeenCalled()
  })

  it('onToggleSidebar/onToggleNoteList/タブ追加操作がCustomTitleBar経由で呼ばれる', () => {
    const { workspace } = renderAppShell()

    fireEvent.click(screen.getByRole('button', { name: 'toggle-sidebar' }))
    expect(workspace.onToggleSidebar).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'toggle-notelist' }))
    expect(workspace.onToggleNoteList).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'add-root' }))
    expect(TAB_BAR.onAdd).toHaveBeenCalledTimes(1)
  })
})
