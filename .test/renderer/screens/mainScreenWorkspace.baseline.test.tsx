/**
 * MainScreen の自動保存デバウンス・外部変更の反映・
 * 連続保存時の再スケジュール挙動を固定するベースライン特性テスト。
 *
 * app-ui-redesign タスク 4.2 で useNoteWorkspace フックへロジックを
 * 抽出する前の挙動を記録し、タスク 4.3 で抽出後も同一テストが
 * 変更なく合格することを確認するための回帰防止テスト。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../helpers/test-app-provider'
import { MainScreen } from '@/renderer/screens/main'

const NOTE_META = {
  id: '1',
  title: 'Note1',
  filePath: '/notes/note1.md',
  relativePath: 'note1.md',
  tags: [],
}

let fileChangedCallback: ((path: string) => void) | null = null

const mockCheckRootExists = vi.fn().mockResolvedValue(true)
const mockScanNotes = vi.fn().mockResolvedValue({
  notes: [NOTE_META],
  tree: { name: '', relativePath: '', children: [], notes: [NOTE_META] },
})
const mockGetNoteContent = vi.fn().mockResolvedValue({
  meta: NOTE_META,
  content: 'original body',
  rawContent: 'original body',
})
const mockSaveNote = vi.fn().mockResolvedValue(true)
const mockWatchFile = vi.fn().mockResolvedValue(true)
const mockUnwatchFile = vi.fn().mockResolvedValue(true)
const mockOnFileChanged = vi.fn((callback: (path: string) => void) => {
  fileChangedCallback = callback
  return () => {
    fileChangedCallback = null
  }
})

vi.mock('@/renderer/lib/tauriApi', () => ({
  tauriApi: {
    markdown: {
      checkRootExists: (...args: unknown[]) => mockCheckRootExists(...args),
      scanNotesAndBuildFolderTree: (...args: unknown[]) =>
        mockScanNotes(...args),
      getNoteContent: (...args: unknown[]) => mockGetNoteContent(...args),
      saveNote: (...args: unknown[]) => mockSaveNote(...args),
      watchFile: (...args: unknown[]) => mockWatchFile(...args),
      unwatchFile: (...args: unknown[]) => mockUnwatchFile(...args),
      onFileChanged: (callback: (path: string) => void) =>
        mockOnFileChanged(callback),
      createNote: vi.fn(),
      createFolder: vi.fn(),
      deleteNote: vi.fn(),
      deleteFolder: vi.fn(),
      moveNote: vi.fn(),
    },
    image: {
      cleanupAll: vi
        .fn()
        .mockResolvedValue({ success: true, deletedFiles: [], errors: [] }),
      deleteNoteImages: vi
        .fn()
        .mockResolvedValue({ success: true, deletedFiles: [], errors: [] }),
    },
    window: {
      isMaximized: vi.fn().mockResolvedValue(false),
      minimize: vi.fn(),
      maximize: vi.fn(),
      close: vi.fn(),
      openNoteWindow: vi.fn(),
    },
    platform: 'unknown',
  },
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    onCloseRequested: vi.fn().mockResolvedValue(() => {}),
    destroy: vi.fn(),
  })),
}))

vi.mock('@/renderer/components/FolderTree', () => ({
  FolderTree: () => null,
}))

vi.mock('@/renderer/components/NoteList', () => ({
  NoteList: (props: { onSelectNote: (note: typeof NOTE_META) => void }) => (
    <button onClick={() => props.onSelectNote(NOTE_META)} type="button">
      select-note
    </button>
  ),
}))

vi.mock('@/renderer/components/EditorView', () => ({
  EditorView: (props: {
    content: string
    isSaving?: boolean
    onChange: (content: string) => void
  }) => (
    <div>
      <span data-testid="note-body">{props.content}</span>
      <span data-testid="is-saving">{String(Boolean(props.isSaving))}</span>
      <button
        onClick={() => props.onChange('changed body')}
        type="button"
      >
        edit
      </button>
    </div>
  ),
}))

async function selectNote() {
  const selectButton = await screen.findByRole('button', {
    name: 'select-note',
  })
  fireEvent.click(selectButton)
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'edit' })).toBeInTheDocument()
  })
}

describe('MainScreen ベースライン特性（抽出前）', () => {
  beforeEach(() => {
    mockCheckRootExists.mockClear()
    mockScanNotes.mockClear()
    mockGetNoteContent.mockClear()
    mockSaveNote.mockClear()
    mockWatchFile.mockClear()
    mockUnwatchFile.mockClear()
    mockOnFileChanged.mockClear()
    fileChangedCallback = null
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('自動保存: 1000ms未満ではsaveNoteが呼ばれず、1000ms経過後に1回だけ呼ばれる', async () => {
    renderWithProviders(<MainScreen />, { settings: { rootDir: '/notes' } })
    await selectNote()

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'edit' }))

    await vi.advanceTimersByTimeAsync(999)
    expect(mockSaveNote).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(mockSaveNote).toHaveBeenCalledTimes(1)
  })

  it('連続保存: 短時間に複数回編集すると、デバウンスが再スケジュールされ1回だけ保存する', async () => {
    renderWithProviders(<MainScreen />, { settings: { rootDir: '/notes' } })
    await selectNote()

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'edit' }))
    await vi.advanceTimersByTimeAsync(500)
    expect(mockSaveNote).not.toHaveBeenCalled()

    // 500ms 時点で再度編集 -> デバウンスが再スケジュールされる
    fireEvent.click(screen.getByRole('button', { name: 'edit' }))
    await vi.advanceTimersByTimeAsync(500)
    // 最初の編集から1000ms経過しているが、再スケジュールされているため未発火
    expect(mockSaveNote).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)
    expect(mockSaveNote).toHaveBeenCalledTimes(1)
  })

  it('ファイル監視: 保存直後の外部変更も取りこぼさず本文へ反映する', async () => {
    renderWithProviders(<MainScreen />, { settings: { rootDir: '/notes' } })
    await selectNote()

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'edit' }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(mockSaveNote).toHaveBeenCalledTimes(1)

    mockGetNoteContent.mockClear()

    mockGetNoteContent.mockResolvedValueOnce({
      meta: NOTE_META, content: 'external body', rawContent: 'external body',
    })
    // 自分の保存と異なる内容なら、クールダウンで通知を捨てない。
    fileChangedCallback?.(NOTE_META.filePath)
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })

    expect(mockGetNoteContent).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('note-body')).toHaveTextContent('external body')
  })

  it('ファイル監視: 編集や保存から十分に時間が経過していれば外部変更でリロードする', async () => {
    renderWithProviders(<MainScreen />, { settings: { rootDir: '/notes' } })
    await selectNote()

    mockGetNoteContent.mockClear()

    // 編集・保存の直後ではない状態で外部変更通知を受け取る
    fileChangedCallback?.(NOTE_META.filePath)

    await waitFor(() => {
      expect(mockGetNoteContent).toHaveBeenCalledTimes(1)
    })
  })
})
