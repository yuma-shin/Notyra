import { dialog } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import type { MarkdownNoteMeta, FolderNode, NoteContent } from '@/shared/types'

export class MarkdownService {
  /**
   * ルートフォルダ選択ダイアログを表示
   */
  async selectRootFolder(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'ノートのルートフォルダを選択',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  }

  /**
   * ルートフォルダが存在するかチェック
   */
  async checkRootExists(rootDir: string): Promise<boolean> {
    try {
      const stats = await fs.stat(rootDir)
      return stats.isDirectory()
    } catch {
      return false
    }
  }

  /**
   * ルートフォルダ配下の全.mdファイルをスキャンしてメタデータを取得
   * Phase 1: .mdファイルパスを並列収集
   * Phase 2: メタデータを並列読み取り（並列数制限付き）
   */
  async scanNotes(rootDir: string): Promise<MarkdownNoteMeta[]> {
    const filePaths: string[] = []
    await this.collectMdFilePaths(rootDir, rootDir, filePaths)

    const results = await this.mapConcurrent(
      filePaths,
      filePath => this.getNoteMeta(rootDir, filePath),
      64
    )

    return results.filter((meta): meta is MarkdownNoteMeta => meta !== null)
  }

  /**
   * .mdファイルパスを並列収集（ディレクトリ走査を並列化）
   */
  private async collectMdFilePaths(
    rootDir: string,
    currentDir: string,
    filePaths: string[]
  ): Promise<void> {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true })
      const subdirPromises: Promise<void>[] = []

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name)
        if (entry.isDirectory()) {
          subdirPromises.push(
            this.collectMdFilePaths(rootDir, fullPath, filePaths)
          )
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          filePaths.push(fullPath)
        }
      }

      // サブディレクトリを並列走査
      await Promise.all(subdirPromises)
    } catch (error) {
      console.error(`Error collecting files from ${currentDir}:`, error)
    }
  }

  /**
   * 非同期タスクを並列数制限付きで実行
   */
  private async mapConcurrent<T, R>(
    items: T[],
    fn: (item: T) => Promise<R | null>,
    concurrency: number
  ): Promise<(R | null)[]> {
    const results: (R | null)[] = new Array(items.length).fill(null)
    let index = 0

    const worker = async () => {
      while (index < items.length) {
        const i = index++
        try {
          results[i] = await fn(items[i])
        } catch {
          results[i] = null
        }
      }
    }

    const workerCount = Math.min(concurrency, items.length)
    if (workerCount === 0) return results

    await Promise.all(Array.from({ length: workerCount }, worker))
    return results
  }

  /**
   * 個別のノートファイルからメタデータを取得
   * ファイル先頭16KBのみ読み込み（フロントマターと抜粋に十分）
   */
  private async getNoteMeta(
    rootDir: string,
    filePath: string
  ): Promise<MarkdownNoteMeta | null> {
    // フロントマターと抜粋取得に十分な先頭16KBのみ読み込む
    const HEADER_SIZE = 16384
    try {
      let content: string
      const fileHandle = await fs.open(filePath, 'r')
      try {
        const buffer = Buffer.alloc(HEADER_SIZE)
        const { bytesRead } = await fileHandle.read(buffer, 0, HEADER_SIZE, 0)
        content = buffer.subarray(0, bytesRead).toString('utf-8')
      } finally {
        await fileHandle.close()
      }

      const parsed = matter(content)
      const relativePath = path.relative(rootDir, filePath)

      // 本文の一部を抽出（最大150文字）
      const excerpt = parsed.content.trim().substring(0, 150)

      const meta: MarkdownNoteMeta = {
        id: parsed.data.id || this.generateIdFromPath(relativePath),
        title: parsed.data.title || path.basename(filePath, '.md'),
        filePath,
        relativePath,
        tags: parsed.data.tags || [],
        createdAt: parsed.data.createdAt,
        updatedAt: parsed.data.updatedAt,
        excerpt: excerpt || undefined,
      }

      return meta
    } catch (error) {
      console.error(`Error reading note ${filePath}:`, error)
      return null
    }
  }

  /**
   * パスからIDを生成
   */
  private generateIdFromPath(relativePath: string): string {
    return relativePath.replace(/\\/g, '/').replace(/\.md$/, '')
  }

  /**
   * フォルダツリーを構築
   */
  async buildFolderTree(
    rootDir: string,
    notes: MarkdownNoteMeta[]
  ): Promise<FolderNode> {
    const rootNode: FolderNode = {
      name: path.basename(rootDir),
      relativePath: '',
      children: [],
      notes: [],
    }

    // フォルダ構造をマップで管理
    const folderMap = new Map<string, FolderNode>()
    folderMap.set('', rootNode)

    // 実際のディレクトリ構造を走査して全フォルダを検出
    await this.scanDirectoryStructure(rootDir, rootDir, folderMap)

    // ノートを各フォルダに配置
    for (const note of notes) {
      const dir = path.dirname(note.relativePath)
      const folderPath = dir === '.' ? '' : dir
      const folder = folderMap.get(folderPath)
      if (folder) {
        folder.notes.push(note)
      }
    }

    return rootNode
  }

  /**
   * ディレクトリ構造を走査してフォルダノードを作成
   * 現レベルのエントリを先に処理してから子ディレクトリを並列走査
   */
  private async scanDirectoryStructure(
    rootDir: string,
    currentDir: string,
    folderMap: Map<string, FolderNode>
  ): Promise<void> {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true })
      const subdirPaths: string[] = []

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = path.join(currentDir, entry.name)
          const relativePath = path.relative(rootDir, fullPath)
          const isRootImagesDir =
            currentDir === rootDir && entry.name === 'images'

          if (isRootImagesDir) {
            continue
          }

          // 既にマップに存在しない場合のみ作成
          if (!folderMap.has(relativePath)) {
            const parentPath = path.dirname(relativePath)
            const parentKey = parentPath === '.' ? '' : parentPath

            const folderNode: FolderNode = {
              name: entry.name,
              relativePath: relativePath,
              children: [],
              notes: [],
            }

            folderMap.set(relativePath, folderNode)

            // 親フォルダに追加
            const parent = folderMap.get(parentKey)
            if (parent) {
              parent.children.push(folderNode)
            }
          }

          subdirPaths.push(fullPath)
        }
      }

      // 現レベルの folderMap 登録が完了してから子ディレクトリを並列走査
      await Promise.all(
        subdirPaths.map(fullPath =>
          this.scanDirectoryStructure(rootDir, fullPath, folderMap)
        )
      )
    } catch (error) {
      console.error(`Error scanning directory structure ${currentDir}:`, error)
    }
  }

  /**
   * ノートの内容を取得
   */
  async getNoteContent(filePath: string): Promise<NoteContent | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const parsed = matter(content)
      const _rootDir = path.dirname(filePath) // 仮、実際はrootDirから相対パス計算が必要
      const relativePath = path.basename(filePath)

      const meta: MarkdownNoteMeta = {
        id: parsed.data.id || this.generateIdFromPath(relativePath),
        title: parsed.data.title || path.basename(filePath, '.md'),
        filePath,
        relativePath,
        tags: parsed.data.tags || [],
        createdAt: parsed.data.createdAt,
        updatedAt: parsed.data.updatedAt,
      }

      return {
        meta,
        content: parsed.content,
        rawContent: content, // 生のファイル内容を追加
      }
    } catch (error) {
      console.error(`Error reading note content ${filePath}:`, error)
      return null
    }
  }

  /**
   * ノートを保存
   */
  async saveNote(
    filePath: string,
    content: string,
    frontMatter?: Record<string, any>
  ): Promise<boolean> {
    try {
      let fileContent = content

      if (frontMatter) {
        // フロントマターと本文を結合
        const stringified = matter.stringify(content, frontMatter)
        fileContent = stringified
      }

      await fs.writeFile(filePath, fileContent, 'utf-8')
      return true
    } catch (error) {
      console.error(`Error saving note ${filePath}:`, error)
      return false
    }
  }

  /**
   * 新規ノートを作成
   */
  async createNote(
    rootDir: string,
    folderPath: string,
    title: string
  ): Promise<string | null> {
    try {
      const baseFileName = this.sanitizeFilename(title)
      const targetDir = path.join(rootDir, folderPath)

      // ディレクトリが存在しない場合は作成
      await fs.mkdir(targetDir, { recursive: true })

      // ファイル名の重複をチェックし、重複する場合は連番を付ける
      let fileName = `${baseFileName}.md`
      let filePath = path.join(targetDir, fileName)
      let counter = 1

      while (true) {
        try {
          await fs.access(filePath)
          // ファイルが存在する場合、連番を付ける
          fileName = `${baseFileName}-${counter}.md`
          filePath = path.join(targetDir, fileName)
          counter++
        } catch {
          // ファイルが存在しない場合、このファイル名を使用
          break
        }
      }

      // フロントマターと初期内容
      const frontMatter = {
        title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: [],
      }

      const initialContent = `# ${title}\n\n`
      const content = matter.stringify(initialContent, frontMatter)
      console.log('Creating note with content:', content)
      await fs.writeFile(filePath, content, 'utf-8')

      return filePath
    } catch (error) {
      console.error('Error creating note:', error)
      return null
    }
  }

  /**
   * フォルダを作成
   */
  async createFolder(rootDir: string, folderPath: string): Promise<boolean> {
    try {
      const targetDir = path.join(rootDir, folderPath)
      await fs.mkdir(targetDir, { recursive: true })
      return true
    } catch (error) {
      console.error('Error creating folder:', error)
      return false
    }
  }

  /**
   * ノートをリネーム
   */
  async renameNote(oldPath: string, newTitle: string): Promise<string | null> {
    try {
      const dir = path.dirname(oldPath)
      const newFileName = `${this.sanitizeFilename(newTitle)}.md`
      const newPath = path.join(dir, newFileName)

      // ファイルの内容を読み込んでフロントマターのtitleを更新
      const content = await fs.readFile(oldPath, 'utf-8')
      const parsed = matter(content)
      parsed.data.title = newTitle
      parsed.data.updatedAt = new Date().toISOString()

      const newContent = matter.stringify(parsed.content, parsed.data)

      await fs.writeFile(newPath, newContent, 'utf-8')

      // 元のファイルを削除（新しいファイル名と異なる場合）
      if (oldPath !== newPath) {
        await fs.unlink(oldPath)
      }

      return newPath
    } catch (error) {
      console.error('Error renaming note:', error)
      return null
    }
  }

  /**
   * ノートを削除
   */
  async deleteNote(filePath: string): Promise<boolean> {
    try {
      await fs.unlink(filePath)
      return true
    } catch (error) {
      console.error('Error deleting note:', error)
      return false
    }
  }

  /**
   * フォルダを削除（中身も含めて）
   */
  async deleteFolder(rootDir: string, folderPath: string): Promise<boolean> {
    try {
      const targetDir = path.join(rootDir, folderPath)
      await fs.rm(targetDir, { recursive: true, force: true })
      return true
    } catch (error) {
      console.error('Error deleting folder:', error)
      return false
    }
  }

  /**   * ノートを別のフォルダに移動
   */
  async moveNote(
    rootDir: string,
    currentFilePath: string,
    targetFolder: string
  ): Promise<string | null> {
    try {
      const fileName = path.basename(currentFilePath)
      const targetDir = targetFolder
        ? path.join(rootDir, targetFolder)
        : rootDir
      const newFilePath = path.join(targetDir, fileName)

      // 同じ場所への移動はスキップ（パス区切り文字を正規化して比較）
      if (path.normalize(currentFilePath) === path.normalize(newFilePath)) {
        return currentFilePath
      }

      // ターゲットディレクトリが存在しない場合は作成
      await fs.mkdir(targetDir, { recursive: true })

      // ファイル名の重複をチェック
      let finalFilePath = newFilePath
      let counter = 1
      const baseName = path.basename(fileName, '.md')

      while (true) {
        try {
          await fs.access(finalFilePath)
          // ファイルが存在する場合、連番を付ける
          const newFileName = `${baseName}-${counter}.md`
          finalFilePath = path.join(targetDir, newFileName)
          counter++
        } catch {
          // ファイルが存在しない場合、このファイル名を使用
          break
        }
      }

      // ファイルを移動（コピーしてから元を削除）
      await fs.copyFile(currentFilePath, finalFilePath)
      await fs.unlink(currentFilePath)

      return finalFilePath
    } catch (error) {
      console.error(`Error moving note ${currentFilePath}:`, error)
      return null
    }
  }

  /**   * ファイル名をサニタイズ
   */
  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/\s+/g, '-')
      .toLowerCase()
  }
}
