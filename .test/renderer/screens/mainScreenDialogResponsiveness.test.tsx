/**
 * 削除確認ダイアログの体感速度改善の回帰テスト。
 *
 * 従来は「削除IPC呼び出し + ノート一覧の再スキャン」が完了するまで
 * ダイアログを閉じずに待っていたため、ボキャブラリの大きいVaultでは
 * 削除ボタンを押してからダイアログが閉じるまでが遅く感じられた。
 * ダイアログはユーザー操作に対して即座に閉じ、削除処理はバックグラウンドで
 * 継続すべきである。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../helpers/test-app-provider'
import { MainScreen } from '@/renderer/screens/main'

const NOTE_META = {
  id: '1',
  title: 'Note1',
  filePath: '/notes/note1.md',
  relativePath: 'note1.md',
  tags: [],
}

const mockCheckRootExists = vi.fn().mockResolvedValue(true)
const mockScanNotes = vi.fn().mockResolvedValue({
  notes: [NOTE_META],
  tree: { name: '', relativePath: '', children: [], notes: [NOTE_META] },
})
const mockGetNoteContent = vi.fn().mockResolvedValue({
  meta: NOTE_META,
  content: 'body',
  rawContent: 'body',
})

// 削除IPCは意図的に解決を遅延させ、ダイアログのクローズが
// この完了を待たないことを検証する
let deleteResolved = false
const mockDeleteNote = vi.fn(
  () =>
    new Promise<boolean>(resolve => {
      // このテスト内では意図的に呼び出さない（削除が未完了のままダイアログが
      // 閉じることを検証するため）
      void (() => {
        deleteResolved = true
        resolve(true)
      })
    })
)

vi.mock('@/renderer/lib/tauriApi', () => ({
  tauriApi: {
    markdown: {
      checkRootExists: (...args: unknown[]) => mockCheckRootExists(...args),
      scanNotesAndBuildFolderTree: (...args: unknown[]) =>
        mockScanNotes(...args),
      getNoteContent: (...args: unknown[]) => mockGetNoteContent(...args),
      saveNote: vi.fn(),
      watchFile: vi.fn().mockResolvedValue(true),
      unwatchFile: vi.fn().mockResolvedValue(true),
      onFileChanged: vi.fn(() => () => {}),
      createNote: vi.fn(),
      createFolder: vi.fn(),
      deleteNote: (...args: unknown[]) => mockDeleteNote(...args),
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
  NoteList: (props: { onDeleteNote?: (note: typeof NOTE_META) => void }) => (
    <button onClick={() => props.onDeleteNote?.(NOTE_META)} type="button">
      delete-note
    </button>
  ),
}))

vi.mock('@/renderer/components/EditorView', () => ({
  EditorView: () => <div />,
}))

describe('削除確認ダイアログの応答性', () => {
  beforeEach(() => {
    deleteResolved = false
    mockDeleteNote.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('削除の完了を待たずにダイアログが即座に閉じる', async () => {
    renderWithProviders(<MainScreen />, { settings: { rootDir: '/notes' } })

    const deleteTrigger = await screen.findByRole('button', {
      name: 'delete-note',
    })
    fireEvent.click(deleteTrigger)

    const confirmButton = await screen.findByRole('button', {
      name: 'Delete',
    })
    fireEvent.click(confirmButton)

    // deleteNote は呼ばれているが、まだ解決していない（バックグラウンドで進行中）
    // 保存キューを空にしてから削除を開始するが、削除完了は待たない。
    await waitFor(() => expect(mockDeleteNote).toHaveBeenCalledTimes(1))
    expect(deleteResolved).toBe(false)

    // それでもダイアログは即座に閉じ始める
    await waitFor(
      () => {
        expect(screen.queryByText('Delete Note')).not.toBeInTheDocument()
      },
      { timeout: 1000 }
    )
  })
})
