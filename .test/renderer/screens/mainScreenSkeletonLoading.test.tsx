/**
 * skeleton-screen-loading 機能の統合検証(タスク4.3)。
 * しきい値時間未満/超過での表示要否、ルートフォルダタブ切替時の挙動、
 * タイトルバー・タブ一覧が読み込み中も維持されることを確認する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, cleanup, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../helpers/test-app-provider'
import { MainScreen } from '@/renderer/screens/main'

interface Note {
  id: string
  title: string
  filePath: string
  relativePath: string
  tags: string[]
}

const { NOTE_ROOT_A, NOTE_ROOT_B } = vi.hoisted(() => ({
  NOTE_ROOT_A: {
    id: 'a1',
    title: 'Note A1',
    filePath: '/root-a/a1.md',
    relativePath: 'a1.md',
    tags: [],
  } as Note,
  NOTE_ROOT_B: {
    id: 'b1',
    title: 'Note B1',
    filePath: '/root-b/b1.md',
    relativePath: 'b1.md',
    tags: [],
  } as Note,
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

async function advanceTime(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function scanResultFor(rootDir: string) {
  const notes = rootDir === '/root-a' ? [NOTE_ROOT_A] : [NOTE_ROOT_B]
  return {
    notes,
    tree: { name: '', relativePath: '', children: [], notes },
  }
}

const mockCheckRootExists = vi.fn()
const mockScanNotes = vi.fn()

vi.mock('@/renderer/lib/tauriApi', () => ({
  tauriApi: {
    markdown: {
      selectRootFolder: vi.fn(),
      checkRootExists: (...args: unknown[]) => mockCheckRootExists(...args),
      scanNotesAndBuildFolderTree: (...args: unknown[]) =>
        mockScanNotes(...args),
      getNoteContent: vi.fn().mockResolvedValue({
        meta: NOTE_ROOT_A,
        content: 'body',
        rawContent: 'body',
      }),
      saveNote: vi.fn().mockResolvedValue(true),
      watchFile: vi.fn().mockResolvedValue(true),
      unwatchFile: vi.fn().mockResolvedValue(true),
      onFileChanged: vi.fn(() => () => {}),
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

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn().mockResolvedValue('3.1.1'),
}))

vi.mock('@/renderer/components/FolderTree', () => ({
  FolderTree: () => null,
}))

vi.mock('@/renderer/components/NoteList', () => ({
  NoteList: (props: { notes: Note[]; onSelectNote: (note: Note) => void }) => (
    <div>
      {props.notes.map(note => (
        <button
          key={note.id}
          onClick={() => props.onSelectNote(note)}
          type="button"
        >
          note:{note.title}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@/renderer/components/EditorView', () => ({
  EditorView: () => <div data-testid="editor-view" />,
}))

describe('MainScreen: Skeleton Screen 表示', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCheckRootExists.mockReset()
    mockScanNotes.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('読み込みがしきい値時間(150ms)未満で終わる場合、Skeleton Screenは一度も表示されない', async () => {
    mockCheckRootExists.mockResolvedValue(true)
    mockScanNotes.mockImplementation(async (rootDir: string) =>
      scanResultFor(rootDir)
    )

    renderWithProviders(<MainScreen />, {
      settings: {
        rootFolders: [{ path: '/root-a' }],
        activeRootFolder: '/root-a',
      },
    })

    // Promise による読み込みを完了させ、しきい値未満であることを確認する
    await advanceTime(0)
    expect(screen.getByText('note:Note A1')).toBeInTheDocument()

    // しきい値時間分待っても事後的にSkeletonが現れることはない
    await advanceTime(200)
    expect(screen.queryByTestId('skeleton-editor')).not.toBeInTheDocument()
  })

  it('読み込みがしきい値時間を超える場合、Skeleton Screenが表示されてから実際のコンテンツへ切り替わる', async () => {
    const deferred = createDeferred<boolean>()
    mockCheckRootExists.mockReturnValue(deferred.promise)
    mockScanNotes.mockImplementation(async (rootDir: string) =>
      scanResultFor(rootDir)
    )

    renderWithProviders(<MainScreen />, {
      settings: {
        rootFolders: [{ path: '/root-a' }],
        activeRootFolder: '/root-a',
      },
    })

    // しきい値時間を超えてもまだ読み込み中 -> Skeleton Screenが表示される
    await advanceTime(149)
    expect(screen.queryByTestId('skeleton-editor')).not.toBeInTheDocument()
    await advanceTime(1)
    expect(screen.getByTestId('skeleton-editor')).toBeInTheDocument()
    // タイトルバー(タブ一覧)は読み込み中も表示され続ける
    expect(screen.getByRole('tab', { name: /root-a/ })).toBeInTheDocument()

    // 読み込みが完了しても、最小表示時間が経過するまではSkeleton Screenを維持する
    await act(async () => {
      deferred.resolve(true)
    })
    expect(screen.getByTestId('skeleton-editor')).toBeInTheDocument()

    await advanceTime(399)
    expect(screen.getByTestId('skeleton-editor')).toBeInTheDocument()
    await advanceTime(1)
    expect(screen.queryByTestId('skeleton-editor')).not.toBeInTheDocument()
    expect(screen.getByText('note:Note A1')).toBeInTheDocument()
  })

  it('ルートフォルダタブ切替時にもSkeleton Screenが表示され、タイトルバー・タブ一覧の表示が維持される', async () => {
    mockCheckRootExists.mockResolvedValue(true)
    mockScanNotes.mockImplementation(async (rootDir: string) =>
      scanResultFor(rootDir)
    )

    renderWithProviders(<MainScreen />, {
      settings: {
        rootFolders: [{ path: '/root-a' }, { path: '/root-b' }],
        activeRootFolder: '/root-a',
      },
    })

    await advanceTime(0)
    expect(screen.getByText('note:Note A1')).toBeInTheDocument()

    // root-b への切替では読み込みを保留させ、Skeleton Screenが表示される様子を確認する
    const deferred = createDeferred<boolean>()
    mockCheckRootExists.mockReturnValue(deferred.promise)

    fireEvent.click(screen.getByRole('tab', { name: /root-b/ }))

    // 非同期のタブ切替を反映してから、読み込み表示のタイマーを進める
    await advanceTime(0)
    await advanceTime(150)
    expect(screen.getByTestId('skeleton-editor')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /root-a/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /root-b/ })).toBeInTheDocument()

    mockCheckRootExists.mockResolvedValue(true)
    await act(async () => {
      deferred.resolve(true)
    })

    await advanceTime(400)
    expect(screen.queryByTestId('skeleton-editor')).not.toBeInTheDocument()
    expect(screen.getByText('note:Note B1')).toBeInTheDocument()
  })
})
