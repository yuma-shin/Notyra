import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNoteFiltering } from '@/renderer/hooks/useNotes'
import type { MarkdownNoteMeta } from '@/shared/types'

/** テスト用のノートデータ */
function createNote(overrides: Partial<MarkdownNoteMeta> = {}): MarkdownNoteMeta {
  return {
    id: 'note-1',
    title: 'Test Note',
    filePath: '/root/note.md',
    relativePath: 'note.md',
    tags: [],
    ...overrides,
  }
}

const sampleNotes: MarkdownNoteMeta[] = [
  createNote({ id: '1', title: 'Root Note', filePath: '/root/root.md', relativePath: 'root.md', tags: ['js'] }),
  createNote({ id: '2', title: 'Doc Note', filePath: '/root/docs/doc.md', relativePath: 'docs/doc.md', tags: ['ts', 'js'] }),
  createNote({ id: '3', title: 'Deep Note', filePath: '/root/docs/deep/deep.md', relativePath: 'docs/deep/deep.md', tags: ['rust'] }),
  createNote({ id: '4', title: 'Blog Note', filePath: '/root/blog/post.md', relativePath: 'blog/post.md' }),
]

describe('useNoteFiltering', () => {
  it('showAllNotes=true のとき全ノートを返す', () => {
    const { result } = renderHook(() =>
      useNoteFiltering({
        allNotes: sampleNotes,
        selectedFolder: '',
        selectedTag: null,
        showAllNotes: true,
      }),
    )

    expect(result.current).toHaveLength(4)
  })

  it('フォルダでフィルタリングする（直下のノートのみ）', () => {
    const { result } = renderHook(() =>
      useNoteFiltering({
        allNotes: sampleNotes,
        selectedFolder: 'docs',
        selectedTag: null,
        showAllNotes: false,
      }),
    )

    // docs 直下のノートのみ（docs/deep/deep.md は含まれない）
    expect(result.current).toHaveLength(1)
    expect(result.current[0].id).toBe('2')
  })

  it('ルートフォルダ（空文字）でフィルタリングすると直下のノートのみ返す', () => {
    const { result } = renderHook(() =>
      useNoteFiltering({
        allNotes: sampleNotes,
        selectedFolder: '',
        selectedTag: null,
        showAllNotes: false,
      }),
    )

    expect(result.current).toHaveLength(1)
    expect(result.current[0].id).toBe('1')
  })

  it('タグでフィルタリングする', () => {
    const { result } = renderHook(() =>
      useNoteFiltering({
        allNotes: sampleNotes,
        selectedFolder: '',
        selectedTag: 'js',
        showAllNotes: true,
      }),
    )

    expect(result.current).toHaveLength(2)
    expect(result.current.map((n) => n.id)).toEqual(
      expect.arrayContaining(['1', '2']),
    )
  })

  it('タグ + フォルダでフィルタリングする（showAllNotes=false）', () => {
    const { result } = renderHook(() =>
      useNoteFiltering({
        allNotes: sampleNotes,
        selectedFolder: 'docs',
        selectedTag: 'js',
        showAllNotes: false,
      }),
    )

    // docs フォルダ内で js タグを持つノート = Doc Note のみ
    expect(result.current).toHaveLength(1)
    expect(result.current[0].id).toBe('2')
  })

  it('存在しないタグではフィルタリング結果が空になる', () => {
    const { result } = renderHook(() =>
      useNoteFiltering({
        allNotes: sampleNotes,
        selectedFolder: '',
        selectedTag: 'nonexistent',
        showAllNotes: true,
      }),
    )

    expect(result.current).toHaveLength(0)
  })

  it('allNotes が変更されるとフィルタリング結果が更新される', () => {
    const initialProps = {
      allNotes: sampleNotes,
      selectedFolder: '',
      selectedTag: null,
      showAllNotes: true,
    }

    const { result, rerender } = renderHook(
      (props) => useNoteFiltering(props),
      { initialProps },
    )

    expect(result.current).toHaveLength(4)

    // ノートを追加
    const newNotes = [
      ...sampleNotes,
      createNote({ id: '5', title: 'New', filePath: '/root/new.md', relativePath: 'new.md' }),
    ]

    rerender({ ...initialProps, allNotes: newNotes })

    expect(result.current).toHaveLength(5)
  })

  it('selectedTag が変更されると再フィルタリングされる', () => {
    const initialProps = {
      allNotes: sampleNotes,
      selectedFolder: '',
      selectedTag: null as string | null,
      showAllNotes: true,
    }

    const { result, rerender } = renderHook(
      (props) => useNoteFiltering(props),
      { initialProps },
    )

    expect(result.current).toHaveLength(4)

    rerender({ ...initialProps, selectedTag: 'rust' })

    expect(result.current).toHaveLength(1)
    expect(result.current[0].id).toBe('3')
  })
})
