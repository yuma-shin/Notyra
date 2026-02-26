import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock electron, fs, and gray-matter before importing the service
vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
}))

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
    rm: vi.fn(),
    access: vi.fn(),
    copyFile: vi.fn(),
    open: vi.fn(),
  },
}))

vi.mock('gray-matter', () => {
  const matterFn = (content: string) => {
    // 簡易的な Front Matter パーサー
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
    if (!match) return { data: {}, content, orig: content }
    const data: Record<string, any> = {}
    let currentKey = ''
    for (const line of match[1].split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx !== -1) {
        const key = line.substring(0, colonIdx).trim()
        const val = line.substring(colonIdx + 1).trim()
        if (val === '') {
          currentKey = key
          data[key] = []
        } else {
          data[key] = val
          currentKey = ''
        }
      } else if (line.trim().startsWith('- ') && currentKey) {
        data[currentKey].push(line.trim().substring(2))
      }
    }
    return { data, content: match[2], orig: content }
  }
  matterFn.stringify = (content: string, frontMatter: Record<string, any>) => {
    const lines = ['---']
    for (const [key, value] of Object.entries(frontMatter)) {
      if (Array.isArray(value)) {
        lines.push(`${key}:`)
        for (const item of value) lines.push(`  - ${item}`)
      } else {
        lines.push(`${key}: ${value}`)
      }
    }
    lines.push('---')
    return `${lines.join('\n')}\n${content}`
  }
  return { default: matterFn }
})

import { MarkdownService } from '@/main/services/markdown-service'
import fs from 'node:fs/promises'
import { dialog } from 'electron'

const mockedFs = vi.mocked(fs)
const mockedDialog = vi.mocked(dialog)

function createMockFileHandle(content: string) {
  return {
    read: vi.fn().mockImplementation(
      async (buffer: Buffer, offset: number, length: number) => {
        const bytes = Buffer.from(content, 'utf-8').subarray(0, length)
        bytes.copy(buffer, offset)
        return { bytesRead: bytes.length }
      },
    ),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

describe('MarkdownService', () => {
  let service: MarkdownService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new MarkdownService()
  })

  // ---- 5.1: 純粋ロジック ----

  describe('generateIdFromPath (private)', () => {
    it('パス区切り文字を正規化し .md 拡張子を除去する', () => {
      const fn = (service as any).generateIdFromPath.bind(service)
      expect(fn('docs/note.md')).toBe('docs/note')
    })

    it('Windows パス区切り文字をスラッシュに変換する', () => {
      const fn = (service as any).generateIdFromPath.bind(service)
      expect(fn('docs\\sub\\note.md')).toBe('docs/sub/note')
    })

    it('拡張子がない場合でもそのまま返す', () => {
      const fn = (service as any).generateIdFromPath.bind(service)
      expect(fn('docs/readme')).toBe('docs/readme')
    })
  })

  describe('sanitizeFilename (private)', () => {
    it('特殊文字をハイフンに置換する', () => {
      const fn = (service as any).sanitizeFilename.bind(service)
      expect(fn('my<file>name')).toBe('my-file-name')
    })

    it('スペースをハイフンに変換する', () => {
      const fn = (service as any).sanitizeFilename.bind(service)
      expect(fn('my note title')).toBe('my-note-title')
    })

    it('小文字に変換する', () => {
      const fn = (service as any).sanitizeFilename.bind(service)
      expect(fn('MyNote')).toBe('mynote')
    })

    it('複数のスペースを1つのハイフンに変換する', () => {
      const fn = (service as any).sanitizeFilename.bind(service)
      expect(fn('my   note')).toBe('my-note')
    })

    it('すべての禁止文字を処理する', () => {
      const fn = (service as any).sanitizeFilename.bind(service)
      expect(fn('a<b>c:d"e/f\\g|h?i*j')).toBe('a-b-c-d-e-f-g-h-i-j')
    })
  })

  // ---- 5.2: ファイル操作 ----

  describe('checkRootExists', () => {
    it('ディレクトリが存在する場合 true を返す', async () => {
      mockedFs.stat.mockResolvedValue({ isDirectory: () => true } as any)
      expect(await service.checkRootExists('/root')).toBe(true)
    })

    it('パスがファイルの場合 false を返す', async () => {
      mockedFs.stat.mockResolvedValue({ isDirectory: () => false } as any)
      expect(await service.checkRootExists('/root')).toBe(false)
    })

    it('パスが存在しない場合 false を返す', async () => {
      mockedFs.stat.mockRejectedValue(new Error('ENOENT'))
      expect(await service.checkRootExists('/root')).toBe(false)
    })
  })

  describe('scanNotes', () => {
    it('再帰的にディレクトリを走査し .md ファイルのメタデータを返す', async () => {
      // root に1ファイル
      mockedFs.readdir.mockResolvedValueOnce([
        { name: 'note.md', isFile: () => true, isDirectory: () => false },
      ] as any)

      mockedFs.open.mockResolvedValueOnce(
        createMockFileHandle(
          '---\ntitle: Test Note\ntags:\n  - js\ncreatedAt: 2024-01-01T00:00:00Z\n---\nHello world',
        ) as any,
      )

      const notes = await service.scanNotes('/root')
      expect(notes).toHaveLength(1)
      expect(notes[0].title).toBe('Test Note')
      expect(notes[0].tags).toEqual(['js'])
      expect(notes[0].excerpt).toBe('Hello world')
    })

    it('サブディレクトリ内のノートも再帰的にスキャンする', async () => {
      // root: docs/ ディレクトリのみ
      mockedFs.readdir.mockResolvedValueOnce([
        { name: 'docs', isFile: () => false, isDirectory: () => true },
      ] as any)
      // docs/: deep.md
      mockedFs.readdir.mockResolvedValueOnce([
        { name: 'deep.md', isFile: () => true, isDirectory: () => false },
      ] as any)

      mockedFs.open.mockResolvedValueOnce(
        createMockFileHandle('---\ntitle: Deep Note\n---\nContent') as any,
      )

      const notes = await service.scanNotes('/root')
      expect(notes).toHaveLength(1)
      expect(notes[0].title).toBe('Deep Note')
    })

    it('Front Matter がないファイルはファイル名をタイトルに使用する', async () => {
      mockedFs.readdir.mockResolvedValueOnce([
        { name: 'plain.md', isFile: () => true, isDirectory: () => false },
      ] as any)
      mockedFs.open.mockResolvedValueOnce(
        createMockFileHandle('Just plain text without front matter') as any,
      )

      const notes = await service.scanNotes('/root')
      expect(notes).toHaveLength(1)
      expect(notes[0].title).toBe('plain')
    })
  })

  describe('getNoteContent', () => {
    it('ノートのコンテンツとメタデータを返す', async () => {
      const rawContent = '---\ntitle: My Note\ntags:\n  - test\n---\n\nNote body here'
      mockedFs.readFile.mockResolvedValueOnce(rawContent)

      const result = await service.getNoteContent('/root/my-note.md')
      expect(result).not.toBeNull()
      expect(result!.meta.title).toBe('My Note')
      expect(result!.content).toContain('Note body here')
      expect(result!.rawContent).toBe(rawContent)
    })

    it('ファイルが存在しない場合 null を返す', async () => {
      mockedFs.readFile.mockRejectedValueOnce(new Error('ENOENT'))

      const result = await service.getNoteContent('/nonexistent.md')
      expect(result).toBeNull()
    })
  })

  describe('saveNote', () => {
    it('ファイルにコンテンツを書き込んで true を返す', async () => {
      mockedFs.writeFile.mockResolvedValueOnce(undefined)

      const result = await service.saveNote('/root/note.md', '# Hello')
      expect(result).toBe(true)
      expect(mockedFs.writeFile).toHaveBeenCalledWith('/root/note.md', '# Hello', 'utf-8')
    })

    it('frontMatter 付きで保存する', async () => {
      mockedFs.writeFile.mockResolvedValueOnce(undefined)

      const result = await service.saveNote('/root/note.md', '# Hello', { title: 'Hello' })
      expect(result).toBe(true)
      const writtenContent = mockedFs.writeFile.mock.calls[0][1] as string
      expect(writtenContent).toContain('title: Hello')
    })

    it('書き込み失敗時に false を返す', async () => {
      mockedFs.writeFile.mockRejectedValueOnce(new Error('EACCES'))

      const result = await service.saveNote('/root/note.md', '# Hello')
      expect(result).toBe(false)
    })
  })

  describe('createNote', () => {
    it('Front Matter 付きの新規ノートを作成しファイルパスを返す', async () => {
      mockedFs.mkdir.mockResolvedValueOnce(undefined)
      mockedFs.access.mockRejectedValueOnce(new Error('ENOENT')) // ファイル未存在
      mockedFs.writeFile.mockResolvedValueOnce(undefined)

      const result = await service.createNote('/root', 'docs', 'My New Note')
      expect(result).not.toBeNull()
      expect(result).toContain('my-new-note.md')
      expect(mockedFs.writeFile).toHaveBeenCalled()

      const writtenContent = mockedFs.writeFile.mock.calls[0][1] as string
      expect(writtenContent).toContain('title: My New Note')
      expect(writtenContent).toContain('# My New Note')
    })

    it('ファイル名重複時に連番を付与する', async () => {
      mockedFs.mkdir.mockResolvedValueOnce(undefined)
      mockedFs.access
        .mockResolvedValueOnce(undefined) // 最初のファイル名は存在する
        .mockRejectedValueOnce(new Error('ENOENT')) // 連番ファイルは存在しない
      mockedFs.writeFile.mockResolvedValueOnce(undefined)

      const result = await service.createNote('/root', '', 'Existing')
      expect(result).toContain('existing-1.md')
    })

    it('エラー時に null を返す', async () => {
      mockedFs.mkdir.mockRejectedValueOnce(new Error('EACCES'))

      const result = await service.createNote('/root', '', 'Test')
      expect(result).toBeNull()
    })
  })

  describe('createFolder', () => {
    it('フォルダを再帰的に作成して true を返す', async () => {
      mockedFs.mkdir.mockResolvedValueOnce(undefined)

      const result = await service.createFolder('/root', 'new/sub')
      expect(result).toBe(true)
      expect(mockedFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('new'),
        { recursive: true },
      )
    })

    it('エラー時に false を返す', async () => {
      mockedFs.mkdir.mockRejectedValueOnce(new Error('EACCES'))
      expect(await service.createFolder('/root', 'fail')).toBe(false)
    })
  })

  describe('renameNote', () => {
    it('タイトルを更新してファイルを移動し新しいパスを返す', async () => {
      mockedFs.readFile.mockResolvedValueOnce('---\ntitle: Old\n---\nContent')
      mockedFs.writeFile.mockResolvedValueOnce(undefined)
      mockedFs.unlink.mockResolvedValueOnce(undefined)

      const result = await service.renameNote('/root/old.md', 'New Title')
      expect(result).toContain('new-title.md')
    })

    it('エラー時に null を返す', async () => {
      mockedFs.readFile.mockRejectedValueOnce(new Error('ENOENT'))
      expect(await service.renameNote('/root/bad.md', 'New')).toBeNull()
    })
  })

  describe('deleteNote', () => {
    it('ファイルを削除して true を返す', async () => {
      mockedFs.unlink.mockResolvedValueOnce(undefined)
      expect(await service.deleteNote('/root/note.md')).toBe(true)
    })

    it('エラー時に false を返す', async () => {
      mockedFs.unlink.mockRejectedValueOnce(new Error('ENOENT'))
      expect(await service.deleteNote('/root/note.md')).toBe(false)
    })
  })

  describe('deleteFolder', () => {
    it('フォルダを再帰的に削除して true を返す', async () => {
      mockedFs.rm.mockResolvedValueOnce(undefined)
      expect(await service.deleteFolder('/root', 'old-folder')).toBe(true)
      expect(mockedFs.rm).toHaveBeenCalledWith(
        expect.stringContaining('old-folder'),
        { recursive: true, force: true },
      )
    })

    it('エラー時に false を返す', async () => {
      mockedFs.rm.mockRejectedValueOnce(new Error('EACCES'))
      expect(await service.deleteFolder('/root', 'fail')).toBe(false)
    })
  })

  describe('moveNote', () => {
    it('ノートをコピー後元ファイルを削除して新パスを返す', async () => {
      mockedFs.mkdir.mockResolvedValueOnce(undefined)
      mockedFs.access.mockRejectedValueOnce(new Error('ENOENT')) // ファイル未存在
      mockedFs.copyFile.mockResolvedValueOnce(undefined)
      mockedFs.unlink.mockResolvedValueOnce(undefined)

      const result = await service.moveNote('/root', '/root/note.md', 'target')
      expect(result).toContain('note.md')
      expect(mockedFs.copyFile).toHaveBeenCalled()
      expect(mockedFs.unlink).toHaveBeenCalledWith('/root/note.md')
    })

    it('同じ場所への移動は元パスをそのまま返す', async () => {
      const result = await service.moveNote('/root', '/root/note.md', '')
      expect(result).toBe('/root/note.md')
    })

    it('エラー時に null を返す', async () => {
      mockedFs.mkdir.mockRejectedValueOnce(new Error('EACCES'))
      expect(await service.moveNote('/root', '/root/note.md', 'bad')).toBeNull()
    })
  })

  // ---- 5.3: Electron 依存 ----

  describe('selectRootFolder', () => {
    it('ユーザーがフォルダを選択した場合、パスを返す', async () => {
      mockedDialog.showOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/selected/folder'],
      })

      const result = await service.selectRootFolder()
      expect(result).toBe('/selected/folder')
    })

    it('ユーザーがキャンセルした場合 null を返す', async () => {
      mockedDialog.showOpenDialog.mockResolvedValueOnce({
        canceled: true,
        filePaths: [],
      })

      const result = await service.selectRootFolder()
      expect(result).toBeNull()
    })
  })

  describe('buildFolderTree', () => {
    it('ルートノードとサブフォルダを持つツリーを構築する', async () => {
      // root にサブディレクトリ docs がある
      mockedFs.readdir.mockResolvedValueOnce([
        { name: 'docs', isFile: () => false, isDirectory: () => true },
      ] as any)
      // docs 内にはサブディレクトリなし
      mockedFs.readdir.mockResolvedValueOnce([] as any)

      const notes = [
        {
          id: '1', title: 'Root Note', filePath: '/root/root.md',
          relativePath: 'root.md', tags: [],
        },
        {
          id: '2', title: 'Doc Note', filePath: '/root/docs/doc.md',
          relativePath: 'docs/doc.md', tags: [],
        },
      ]

      const tree = await service.buildFolderTree('/root', notes as any)
      expect(tree.name).toBe('root')
      expect(tree.notes).toHaveLength(1)
      expect(tree.notes[0].title).toBe('Root Note')
      expect(tree.children).toHaveLength(1)
      expect(tree.children[0].name).toBe('docs')
      expect(tree.children[0].notes).toHaveLength(1)
      expect(tree.children[0].notes[0].title).toBe('Doc Note')
    })
  })
})
