import { describe, expectTypeOf, it } from 'vitest'
import type {
  MarkdownNoteMeta,
  FolderNode,
  AppSettings,
  NoteContent,
} from '@/shared/types'

describe('MarkdownNoteMeta 型', () => {
  it('必須プロパティを持つ', () => {
    expectTypeOf<MarkdownNoteMeta>().toHaveProperty('id')
    expectTypeOf<MarkdownNoteMeta>().toHaveProperty('title')
    expectTypeOf<MarkdownNoteMeta>().toHaveProperty('filePath')
    expectTypeOf<MarkdownNoteMeta>().toHaveProperty('relativePath')
  })

  it('id と title が string 型である', () => {
    expectTypeOf<MarkdownNoteMeta['id']>().toBeString()
    expectTypeOf<MarkdownNoteMeta['title']>().toBeString()
  })

  it('tags がオプショナルな string 配列である', () => {
    expectTypeOf<MarkdownNoteMeta['tags']>().toEqualTypeOf<string[] | undefined>()
  })

  it('createdAt と updatedAt がオプショナルな string である', () => {
    expectTypeOf<MarkdownNoteMeta['createdAt']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<MarkdownNoteMeta['updatedAt']>().toEqualTypeOf<string | undefined>()
  })
})

describe('FolderNode 型', () => {
  it('必須プロパティを持つ', () => {
    expectTypeOf<FolderNode>().toHaveProperty('name')
    expectTypeOf<FolderNode>().toHaveProperty('relativePath')
    expectTypeOf<FolderNode>().toHaveProperty('children')
    expectTypeOf<FolderNode>().toHaveProperty('notes')
  })

  it('children が再帰的に FolderNode 配列である', () => {
    expectTypeOf<FolderNode['children']>().toEqualTypeOf<FolderNode[]>()
  })

  it('notes が MarkdownNoteMeta 配列である', () => {
    expectTypeOf<FolderNode['notes']>().toEqualTypeOf<MarkdownNoteMeta[]>()
  })
})

describe('AppSettings 型', () => {
  it('editorLayoutMode が限定されたリテラル型である', () => {
    expectTypeOf<AppSettings['editorLayoutMode']>().toEqualTypeOf<
      'editor' | 'preview' | 'split'
    >()
  })

  it('theme が限定されたリテラル型である', () => {
    expectTypeOf<AppSettings['theme']>().toEqualTypeOf<
      'light' | 'dark' | 'system'
    >()
  })

  it('rootDir がオプショナルな string である', () => {
    expectTypeOf<AppSettings['rootDir']>().toEqualTypeOf<string | undefined>()
  })
})

describe('NoteContent 型', () => {
  it('meta が MarkdownNoteMeta 型である', () => {
    expectTypeOf<NoteContent['meta']>().toEqualTypeOf<MarkdownNoteMeta>()
  })

  it('content と rawContent が string 型である', () => {
    expectTypeOf<NoteContent['content']>().toBeString()
    expectTypeOf<NoteContent['rawContent']>().toBeString()
  })
})
