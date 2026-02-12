import { describe, it, expect } from 'vitest'
import {
  filterNotesByFolder,
  getNoteDirectory,
  filterNotesByTag,
} from '@/renderer/utils/noteFilters'
import type { MarkdownNoteMeta } from '@/shared/types'

function createNote(overrides: Partial<MarkdownNoteMeta> = {}): MarkdownNoteMeta {
  return {
    id: 'note-1',
    title: 'Test Note',
    filePath: '/root/note.md',
    relativePath: 'note.md',
    ...overrides,
  }
}

describe('getNoteDirectory', () => {
  it('ルート直下のファイルに対して空文字列を返す', () => {
    expect(getNoteDirectory('note.md')).toBe('')
  })

  it('サブフォルダ内のファイルに対してディレクトリパスを返す', () => {
    expect(getNoteDirectory('docs/note.md')).toBe('docs')
  })

  it('ネストされたパスに対して親ディレクトリパスを返す', () => {
    expect(getNoteDirectory('docs/sub/note.md')).toBe('docs/sub')
  })

  it('Windowsパス区切り文字を正しく処理する', () => {
    expect(getNoteDirectory('docs\\note.md')).toBe('docs')
  })

  it('混合パス区切り文字を正しく処理する', () => {
    expect(getNoteDirectory('docs\\sub/note.md')).toBe('docs\\sub')
  })
})

describe('filterNotesByFolder', () => {
  const rootNote = createNote({ relativePath: 'root-note.md', id: '1' })
  const docsNote = createNote({ relativePath: 'docs/doc-note.md', id: '2' })
  const subNote = createNote({ relativePath: 'docs/sub/deep-note.md', id: '3' })
  const allNotes = [rootNote, docsNote, subNote]

  it('ルートフォルダ指定で直下のノートのみ返す', () => {
    const result = filterNotesByFolder(allNotes, '')
    expect(result).toEqual([rootNote])
  })

  it('サブフォルダ指定で直下のノートのみ返す', () => {
    const result = filterNotesByFolder(allNotes, 'docs')
    expect(result).toEqual([docsNote])
  })

  it('ネストされたフォルダ指定で直下のノートのみ返す', () => {
    const result = filterNotesByFolder(allNotes, 'docs/sub')
    expect(result).toEqual([subNote])
  })

  it('一致するノートがない場合は空配列を返す', () => {
    const result = filterNotesByFolder(allNotes, 'nonexistent')
    expect(result).toEqual([])
  })

  it('空の配列に対して空配列を返す', () => {
    const result = filterNotesByFolder([], 'docs')
    expect(result).toEqual([])
  })

  it('Windowsパス区切り文字を正規化して比較する', () => {
    const winNote = createNote({ relativePath: 'docs\\win-note.md', id: '4' })
    const result = filterNotesByFolder([winNote], 'docs')
    expect(result).toEqual([winNote])
  })
})

describe('filterNotesByTag', () => {
  const taggedNote = createNote({ tags: ['javascript', 'react'], id: '1' })
  const otherTag = createNote({ tags: ['python'], id: '2' })
  const noTags = createNote({ tags: undefined, id: '3' })
  const emptyTags = createNote({ tags: [], id: '4' })
  const allNotes = [taggedNote, otherTag, noTags, emptyTags]

  it('指定タグを持つノートを返す', () => {
    const result = filterNotesByTag(allNotes, 'javascript')
    expect(result).toEqual([taggedNote])
  })

  it('複数のノートが同じタグを持つ場合すべて返す', () => {
    const anotherJs = createNote({ tags: ['javascript'], id: '5' })
    const result = filterNotesByTag([...allNotes, anotherJs], 'javascript')
    expect(result).toEqual([taggedNote, anotherJs])
  })

  it('存在しないタグに対して空配列を返す', () => {
    const result = filterNotesByTag(allNotes, 'nonexistent')
    expect(result).toEqual([])
  })

  it('タグなしのノートはフィルタで除外される', () => {
    const result = filterNotesByTag(allNotes, 'react')
    expect(result).toEqual([taggedNote])
  })

  it('空の配列に対して空配列を返す', () => {
    const result = filterNotesByTag([], 'javascript')
    expect(result).toEqual([])
  })
})
