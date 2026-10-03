import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { NoteList } from '@/renderer/components/NoteList'
import type { MarkdownNoteMeta } from '@/shared/types'

const mockOpenNoteWindow = vi.fn()

vi.mock('@/renderer/lib/tauriApi', () => ({
  tauriApi: {
    window: {
      openNoteWindow: (...args: unknown[]) => mockOpenNoteWindow(...args),
    },
  },
}))

// jsdom ではコンテナの高さが常に0のため、tanstack/react-virtual は
// 可視範囲を算出できず getVirtualItems() が空になる。
// テストでは仮想化せず全件描画するようにモックする。
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: { count: number }) => ({
    getTotalSize: () => options.count * 80,
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        key: index,
        index,
        start: index * 80,
      })),
    measureElement: () => {},
  }),
}))

const NOTES: MarkdownNoteMeta[] = [
  {
    id: '1',
    title: 'Note One',
    filePath: '/notes/one.md',
    relativePath: 'one.md',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: '2',
    title: 'Note Two',
    filePath: '/notes/two.md',
    relativePath: 'two.md',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
]

describe('NoteList', () => {
  afterEach(() => {
    cleanup()
    mockOpenNoteWindow.mockReset()
  })

  it('すべてのノート・ルート・サブフォルダの表示を見出しで区別できる', () => {
    const props = {
      notes: NOTES,
      onSelectNote: vi.fn(),
      selectedFolder: '',
      selectedNote: null,
    }
    const { rerender } = render(<NoteList {...props} />)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Root')

    rerender(<NoteList {...props} showAllNotes />)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'All Notes'
    )

    rerender(<NoteList {...props} selectedFolder="docs/tutorials" />)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'tutorials'
    )
  })

  it('ダブルクリックすると、渡されたrootDirとともにopenNoteWindowが呼ばれる', () => {
    render(
      <NoteList
        notes={NOTES}
        onSelectNote={vi.fn()}
        rootDir="/root-a"
        selectedFolder=""
        selectedNote={null}
      />
    )

    fireEvent.doubleClick(screen.getByText('Note One'))
    expect(mockOpenNoteWindow).toHaveBeenCalledWith(
      NOTES[0].filePath,
      '/root-a'
    )
  })

  it('rootDirが未指定の場合、ダブルクリックしてもopenNoteWindowを呼ばない', () => {
    render(
      <NoteList
        notes={NOTES}
        onSelectNote={vi.fn()}
        selectedFolder=""
        selectedNote={null}
      />
    )

    fireEvent.doubleClick(screen.getByText('Note One'))
    expect(mockOpenNoteWindow).not.toHaveBeenCalled()
  })

  it('ノート一覧を表示する', () => {
    render(
      <NoteList
        notes={NOTES}
        onSelectNote={vi.fn()}
        selectedFolder=""
        selectedNote={null}
      />
    )
    expect(screen.getByText('Note One')).toBeInTheDocument()
    expect(screen.getByText('Note Two')).toBeInTheDocument()
  })

  it('ノートをクリックすると onSelectNote が呼ばれる', () => {
    const onSelectNote = vi.fn()
    render(
      <NoteList
        notes={NOTES}
        onSelectNote={onSelectNote}
        selectedFolder=""
        selectedNote={null}
      />
    )
    fireEvent.click(screen.getByText('Note One'))
    expect(onSelectNote).toHaveBeenCalledWith(NOTES[0])
  })

  it('検索するとタイトルでフィルタされる', () => {
    render(
      <NoteList
        notes={NOTES}
        onSelectNote={vi.fn()}
        selectedFolder=""
        selectedNote={null}
      />
    )
    fireEvent.change(screen.getByPlaceholderText('Search...'), {
      target: { value: 'Two' },
    })
    expect(screen.queryByText('Note One')).not.toBeInTheDocument()
    expect(screen.getByText('Note Two')).toBeInTheDocument()
  })

  it('ノートが0件のとき、新規ノート作成の導線を表示する', () => {
    const onCreateNote = vi.fn()
    render(
      <NoteList
        notes={[]}
        onCreateNote={onCreateNote}
        onSelectNote={vi.fn()}
        selectedFolder=""
        selectedNote={null}
      />
    )

    const createButton = screen.getByText('Create Note').closest('button')
    fireEvent.click(createButton!)
    expect(onCreateNote).toHaveBeenCalledTimes(1)
  })

  it('ヘッダーのノート作成ボタンはGhostボタンプリミティブを使用する', () => {
    render(
      <NoteList
        notes={NOTES}
        onCreateNote={vi.fn()}
        onSelectNote={vi.fn()}
        selectedFolder=""
        selectedNote={null}
      />
    )
    const button = screen.getByRole('button', { name: 'Create Note' })
    expect(button).toHaveAttribute('data-slot', 'button')
  })

  it('幅を指定するとインラインスタイルで幅が固定される', () => {
    render(
      <NoteList
        notes={NOTES}
        onSelectNote={vi.fn()}
        selectedFolder=""
        selectedNote={null}
        width={350}
      />
    )
    expect(screen.getByText('Note One').closest('.bg-background')).toHaveStyle(
      { width: '350px' }
    )
  })

  it('ヘッダーとフィルター行はサイドバーと同様に単一のborder-bでまとめられ、ヘッダー行自体はborder-bを持たない', () => {
    render(
      <NoteList
        notes={NOTES}
        onSelectNote={vi.fn()}
        selectedFolder=""
        selectedNote={null}
      />
    )
    const headerRow = screen.getByText('Root').closest('.h-12')
    expect(headerRow).not.toHaveClass('border-b')
    const wrapper = headerRow?.parentElement
    expect(wrapper).toHaveClass('border-b')
  })

  it('ヘッダー全体はサイドバーと同じ固定高さ(h-22)で、フィルター行はflex-1で残り領域を埋める', () => {
    render(
      <NoteList
        notes={NOTES}
        onSelectNote={vi.fn()}
        selectedFolder=""
        selectedNote={null}
      />
    )
    const headerRow = screen.getByText('Root').closest('.h-12')
    const wrapper = headerRow?.parentElement
    expect(wrapper).toHaveClass('h-22')
    const searchInput = screen.getByPlaceholderText('Search...')
    const filterRow = searchInput.closest('.flex.gap-2')?.parentElement
    expect(filterRow).toHaveClass('flex-1')
  })

  it('検索フォームを一回り小さくし、境界線との間にマージンができるようにする', () => {
    render(
      <NoteList
        notes={NOTES}
        onSelectNote={vi.fn()}
        selectedFolder=""
        selectedNote={null}
      />
    )
    const searchInput = screen.getByPlaceholderText('Search...')
    expect(searchInput).toHaveClass('py-0.5')
    expect(searchInput).not.toHaveClass('py-1')
    expect(searchInput).not.toHaveClass('py-1.5')
  })
})
