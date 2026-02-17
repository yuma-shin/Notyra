import { dialog } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ImageSaveResult, CleanupResult } from '@/shared/types'

export class ImageService {
  static readonly SUPPORTED_IMAGE_EXTENSIONS = [
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'svg',
  ] as const

  static readonly SUPPORTED_IMAGE_MIME_TYPES = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
  ] as const

  static isImageFile(filePath: string): boolean {
    const ext = path.extname(filePath).slice(1).toLowerCase()
    return (
      ImageService.SUPPORTED_IMAGE_EXTENSIONS as readonly string[]
    ).includes(ext)
  }

  static sanitizeNoteBaseName(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_')
  }

  static generateImageFileName(
    noteBaseName: string,
    extension: string,
    sequence: number
  ): string {
    const sanitized = ImageService.sanitizeNoteBaseName(noteBaseName)
    const now = new Date()
    const timestamp =
      now.getFullYear().toString() +
      (now.getMonth() + 1).toString().padStart(2, '0') +
      now.getDate().toString().padStart(2, '0') +
      now.getHours().toString().padStart(2, '0') +
      now.getMinutes().toString().padStart(2, '0') +
      now.getSeconds().toString().padStart(2, '0') +
      now.getMilliseconds().toString().padStart(3, '0')
    const seq = sequence.toString().padStart(3, '0')
    return `${sanitized}_${timestamp}_${seq}.${extension}`
  }

  static parseImageReferences(markdownContent: string): string[] {
    const refs: string[] = []
    // Markdown image syntax: ![alt](path)
    const mdRegex = /!\[[^\]]*\]\(([^)]+)\)/g
    for (const match of markdownContent.matchAll(mdRegex)) {
      if (match[1]) {
        refs.push(match[1])
      }
    }
    // HTML img tags: <img src="path" ...>
    const htmlRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/g
    for (const match of markdownContent.matchAll(htmlRegex)) {
      if (match[1]) {
        refs.push(match[1])
      }
    }
    return refs
  }

  async ensureImagesDir(rootDir: string): Promise<string> {
    const imagesDir = path.join(rootDir, 'images')
    await fs.mkdir(imagesDir, { recursive: true })
    return imagesDir
  }

  private async findUniqueFileName(
    imagesDir: string,
    noteBaseName: string,
    extension: string
  ): Promise<string> {
    let seq = 1
    while (true) {
      const fileName = ImageService.generateImageFileName(
        noteBaseName,
        extension,
        seq
      )
      const fullPath = path.join(imagesDir, fileName)
      try {
        await fs.access(fullPath)
        seq++
      } catch {
        return fileName
      }
    }
  }

  async saveImageFromFile(
    rootDir: string,
    noteBaseName: string,
    sourceFilePath: string
  ): Promise<ImageSaveResult> {
    if (!ImageService.isImageFile(sourceFilePath)) {
      return {
        success: false,
        relativePath: null,
        error: `Unsupported image format: ${path.extname(sourceFilePath)}`,
      }
    }

    try {
      const imagesDir = await this.ensureImagesDir(rootDir)
      const ext = path.extname(sourceFilePath).slice(1).toLowerCase()
      const fileName = await this.findUniqueFileName(
        imagesDir,
        noteBaseName,
        ext
      )
      const destPath = path.join(imagesDir, fileName)

      await fs.copyFile(sourceFilePath, destPath)

      return {
        success: true,
        relativePath: `images/${fileName}`,
      }
    } catch (error) {
      return {
        success: false,
        relativePath: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async saveImageFromBuffer(
    rootDir: string,
    noteBaseName: string,
    buffer: Buffer,
    extension: string
  ): Promise<ImageSaveResult> {
    const ext = extension.toLowerCase()
    if (
      !(ImageService.SUPPORTED_IMAGE_EXTENSIONS as readonly string[]).includes(
        ext
      )
    ) {
      return {
        success: false,
        relativePath: null,
        error: `Unsupported image format: ${extension}`,
      }
    }

    try {
      const imagesDir = await this.ensureImagesDir(rootDir)
      const fileName = await this.findUniqueFileName(
        imagesDir,
        noteBaseName,
        ext
      )
      const destPath = path.join(imagesDir, fileName)

      await fs.writeFile(destPath, buffer)

      return {
        success: true,
        relativePath: `images/${fileName}`,
      }
    } catch (error) {
      return {
        success: false,
        relativePath: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async selectImageFile(): Promise<string[]> {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: '画像ファイルを選択',
      filters: [
        {
          name: '画像',
          extensions: [...ImageService.SUPPORTED_IMAGE_EXTENSIONS],
        },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return []
    }

    return result.filePaths
  }

  async cleanupUnusedImages(
    rootDir: string,
    noteBaseName: string,
    markdownContent: string
  ): Promise<CleanupResult> {
    const deletedFiles: string[] = []
    const errors: string[] = []

    try {
      const imagesDir = path.join(rootDir, 'images')
      const sanitized = ImageService.sanitizeNoteBaseName(noteBaseName)

      // List files matching the note prefix
      let allFiles: string[]
      try {
        allFiles = (await fs.readdir(imagesDir)) as string[]
      } catch {
        return { success: true, deletedFiles: [], errors: [] }
      }

      const noteFiles = allFiles.filter(f => f.startsWith(`${sanitized}_`))
      if (noteFiles.length === 0) {
        return { success: true, deletedFiles: [], errors: [] }
      }

      // Parse image references from the current note's content
      const referencedPaths = ImageService.parseImageReferences(markdownContent)
      const referencedFileNames = new Set(
        referencedPaths.map(p => path.basename(p))
      )

      // Find unreferenced files
      const unreferenced = noteFiles.filter(f => !referencedFileNames.has(f))
      if (unreferenced.length === 0) {
        return { success: true, deletedFiles: [], errors: [] }
      }

      // Check if unreferenced files are referenced by other notes
      const otherReferences = await this.scanAllNoteReferences(rootDir)

      for (const file of unreferenced) {
        if (otherReferences.has(file)) {
          continue // skip: referenced by another note
        }
        try {
          await fs.unlink(path.join(imagesDir, file))
          deletedFiles.push(file)
        } catch (error) {
          errors.push(
            `Failed to delete ${file}: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }

    return { success: true, deletedFiles, errors }
  }

  async deleteNoteImages(
    rootDir: string,
    noteBaseName: string
  ): Promise<CleanupResult> {
    const deletedFiles: string[] = []
    const errors: string[] = []

    try {
      const imagesDir = path.join(rootDir, 'images')
      const sanitized = ImageService.sanitizeNoteBaseName(noteBaseName)

      let allFiles: string[]
      try {
        allFiles = (await fs.readdir(imagesDir)) as string[]
      } catch {
        return { success: true, deletedFiles: [], errors: [] }
      }

      const noteFiles = allFiles.filter(f => f.startsWith(`${sanitized}_`))
      if (noteFiles.length === 0) {
        return { success: true, deletedFiles: [], errors: [] }
      }

      // Check cross-references before deleting
      const otherReferences = await this.scanAllNoteReferences(rootDir)

      for (const file of noteFiles) {
        if (otherReferences.has(file)) {
          continue
        }
        try {
          await fs.unlink(path.join(imagesDir, file))
          deletedFiles.push(file)
        } catch (error) {
          errors.push(
            `Failed to delete ${file}: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }

    return { success: true, deletedFiles, errors }
  }

  async cleanupAllUnusedImages(rootDir: string): Promise<CleanupResult> {
    const deletedFiles: string[] = []
    const errors: string[] = []

    try {
      const imagesDir = path.join(rootDir, 'images')
      let allImageFiles: string[]
      try {
        allImageFiles = (await fs.readdir(imagesDir)) as string[]
      } catch {
        return { success: true, deletedFiles: [], errors: [] }
      }

      if (allImageFiles.length === 0) {
        return { success: true, deletedFiles: [], errors: [] }
      }

      // Scan all notes for image references
      const referencedFiles = await this.scanAllNoteReferences(rootDir)

      // Delete image files that are not referenced by any note
      for (const file of allImageFiles) {
        if (referencedFiles.has(file)) continue
        try {
          await fs.unlink(path.join(imagesDir, file))
          deletedFiles.push(file)
        } catch (error) {
          errors.push(
            `Failed to delete ${file}: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }

    return { success: true, deletedFiles, errors }
  }

  private async scanAllNoteReferences(rootDir: string): Promise<Set<string>> {
    const referencedFiles = new Set<string>()

    try {
      const entries = await fs.readdir(rootDir, { withFileTypes: true })
      await this.scanDirForReferences(rootDir, entries, referencedFiles)
    } catch {
      // Ignore errors scanning
    }

    return referencedFiles
  }

  private async scanDirForReferences(
    rootDir: string,
    entries: any[],
    referencedFiles: Set<string>
  ): Promise<void> {
    for (const entry of entries) {
      if (entry.isFile?.() && entry.name.endsWith('.md')) {
        try {
          const content = await fs.readFile(
            path.join(rootDir, entry.name),
            'utf-8'
          )
          const refs = ImageService.parseImageReferences(content)
          for (const ref of refs) {
            referencedFiles.add(path.basename(ref))
          }
        } catch {
          // Ignore read errors
        }
      } else if (entry.isDirectory?.() && entry.name !== 'images') {
        try {
          const subEntries = await fs.readdir(path.join(rootDir, entry.name), {
            withFileTypes: true,
          })
          await this.scanDirForReferences(
            path.join(rootDir, entry.name),
            subEntries,
            referencedFiles
          )
        } catch {
          // Ignore errors
        }
      }
    }
  }
}
