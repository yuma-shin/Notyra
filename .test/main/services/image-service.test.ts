import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: vi.fn(),
    access: vi.fn(),
    copyFile: vi.fn(),
    writeFile: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    unlink: vi.fn(),
  },
}))

// Mock electron dialog
vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
}))

import fs from 'node:fs/promises'
import { dialog } from 'electron'
import { ImageService } from '@/main/services/image-service'

describe('ImageService', () => {
  let service: ImageService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ImageService()
  })

  describe('SUPPORTED_IMAGE_EXTENSIONS', () => {
    it('should support png, jpg, jpeg, gif, webp, svg', () => {
      expect(ImageService.SUPPORTED_IMAGE_EXTENSIONS).toEqual([
        'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',
      ])
    })
  })

  describe('isImageFile', () => {
    it('should return true for supported extensions', () => {
      expect(ImageService.isImageFile('photo.png')).toBe(true)
      expect(ImageService.isImageFile('photo.jpg')).toBe(true)
      expect(ImageService.isImageFile('photo.jpeg')).toBe(true)
      expect(ImageService.isImageFile('photo.gif')).toBe(true)
      expect(ImageService.isImageFile('photo.webp')).toBe(true)
      expect(ImageService.isImageFile('photo.svg')).toBe(true)
    })

    it('should return true for uppercase extensions', () => {
      expect(ImageService.isImageFile('photo.PNG')).toBe(true)
      expect(ImageService.isImageFile('photo.JPG')).toBe(true)
    })

    it('should return false for unsupported extensions', () => {
      expect(ImageService.isImageFile('document.pdf')).toBe(false)
      expect(ImageService.isImageFile('script.js')).toBe(false)
      expect(ImageService.isImageFile('readme.md')).toBe(false)
    })
  })

  describe('sanitizeNoteBaseName', () => {
    it('should replace special characters with underscores', () => {
      expect(ImageService.sanitizeNoteBaseName('my<note>file')).toBe('my_note_file')
      expect(ImageService.sanitizeNoteBaseName('note:with"special')).toBe('note_with_special')
    })

    it('should replace spaces with underscores', () => {
      expect(ImageService.sanitizeNoteBaseName('my note')).toBe('my_note')
    })

    it('should handle already clean names', () => {
      expect(ImageService.sanitizeNoteBaseName('my-note')).toBe('my-note')
    })
  })

  describe('generateImageFileName', () => {
    it('should generate a filename with the correct pattern', () => {
      const fileName = ImageService.generateImageFileName('my-note', 'png', 1)
      // Pattern: {noteBaseName}_{YYYYMMDDHHmmssSSS}_{seq}.{ext}
      expect(fileName).toMatch(/^my-note_\d{17}_001\.png$/)
    })

    it('should zero-pad the sequence number to 3 digits', () => {
      const fileName = ImageService.generateImageFileName('note', 'jpg', 42)
      expect(fileName).toMatch(/^note_\d{17}_042\.jpg$/)
    })

    it('should sanitize special characters in noteBaseName', () => {
      const fileName = ImageService.generateImageFileName('my note<1>', 'png', 1)
      expect(fileName).toMatch(/^my_note_1__\d{17}_001\.png$/)
    })
  })

  describe('parseImageReferences', () => {
    it('should extract image references from markdown', () => {
      const markdown = '![alt](images/note_20260216_001.png)\nsome text\n![](images/note_20260216_002.jpg)'
      const refs = ImageService.parseImageReferences(markdown)
      expect(refs).toEqual([
        'images/note_20260216_001.png',
        'images/note_20260216_002.jpg',
      ])
    })

    it('should not extract non-image references', () => {
      const markdown = '[click here](https://example.com)\n![alt](images/photo.png)'
      const refs = ImageService.parseImageReferences(markdown)
      expect(refs).toEqual(['images/photo.png'])
    })

    it('should return empty array for no images', () => {
      const markdown = 'no images here'
      const refs = ImageService.parseImageReferences(markdown)
      expect(refs).toEqual([])
    })

    it('should handle HTML img tags too', () => {
      const markdown = '<img src="images/photo.png" alt="test">'
      const refs = ImageService.parseImageReferences(markdown)
      expect(refs).toContain('images/photo.png')
    })
  })

  describe('ensureImagesDir', () => {
    it('should create images directory if it does not exist', async () => {
      vi.mocked(fs.mkdir).mockResolvedValueOnce(undefined)
      await service.ensureImagesDir('/root')
      expect(fs.mkdir).toHaveBeenCalledWith(
        path.join('/root', 'images'),
        { recursive: true }
      )
    })

    it('should throw if mkdir fails', async () => {
      vi.mocked(fs.mkdir).mockRejectedValueOnce(new Error('Permission denied'))
      await expect(service.ensureImagesDir('/root')).rejects.toThrow('Permission denied')
    })
  })

  describe('saveImageFromFile', () => {
    it('should copy the file to images/ with the correct name', async () => {
      vi.mocked(fs.mkdir).mockResolvedValueOnce(undefined)
      vi.mocked(fs.access).mockRejectedValueOnce(new Error('not found')) // file doesn't exist yet
      vi.mocked(fs.copyFile).mockResolvedValueOnce(undefined)

      const result = await service.saveImageFromFile('/root', 'my-note', '/tmp/photo.png')

      expect(result.success).toBe(true)
      expect(result.relativePath).toMatch(/^images\/my-note_\d{17}_001\.png$/)
      expect(fs.copyFile).toHaveBeenCalled()
    })

    it('should return error result on copy failure', async () => {
      vi.mocked(fs.mkdir).mockResolvedValueOnce(undefined)
      vi.mocked(fs.access).mockRejectedValueOnce(new Error('not found'))
      vi.mocked(fs.copyFile).mockRejectedValueOnce(new Error('Disk full'))

      const result = await service.saveImageFromFile('/root', 'my-note', '/tmp/photo.png')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Disk full')
    })

    it('should return error result for unsupported file types', async () => {
      const result = await service.saveImageFromFile('/root', 'my-note', '/tmp/doc.pdf')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should return error result on folder creation failure', async () => {
      vi.mocked(fs.mkdir).mockRejectedValueOnce(new Error('Permission denied'))

      const result = await service.saveImageFromFile('/root', 'my-note', '/tmp/photo.png')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Permission denied')
    })
  })

  describe('saveImageFromBuffer', () => {
    it('should save buffer to images/ with the correct name', async () => {
      vi.mocked(fs.mkdir).mockResolvedValueOnce(undefined)
      vi.mocked(fs.access).mockRejectedValueOnce(new Error('not found'))
      vi.mocked(fs.writeFile).mockResolvedValueOnce(undefined)

      const buffer = Buffer.from('fake image data')
      const result = await service.saveImageFromBuffer('/root', 'my-note', buffer, 'png')

      expect(result.success).toBe(true)
      expect(result.relativePath).toMatch(/^images\/my-note_\d{17}_001\.png$/)
      expect(fs.writeFile).toHaveBeenCalled()
    })

    it('should return error result on write failure', async () => {
      vi.mocked(fs.mkdir).mockResolvedValueOnce(undefined)
      vi.mocked(fs.access).mockRejectedValueOnce(new Error('not found'))
      vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error('Disk full'))

      const buffer = Buffer.from('fake image data')
      const result = await service.saveImageFromBuffer('/root', 'my-note', buffer, 'png')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Disk full')
    })

    it('should return error for unsupported extension', async () => {
      const buffer = Buffer.from('fake data')
      const result = await service.saveImageFromBuffer('/root', 'my-note', buffer, 'bmp')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('selectImageFile', () => {
    it('should return selected file paths', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/tmp/photo.png', '/tmp/photo2.jpg'],
      })

      const result = await service.selectImageFile()
      expect(result).toEqual(['/tmp/photo.png', '/tmp/photo2.jpg'])
    })

    it('should return empty array when dialog is canceled', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: true,
        filePaths: [],
      })

      const result = await service.selectImageFile()
      expect(result).toEqual([])
    })
  })

  describe('cleanupUnusedImages', () => {
    it('should delete images not referenced in markdown', async () => {
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        'my-note_20260216_001.png',
        'my-note_20260216_002.png',
      ] as any)

      // Read all md files to check cross-references
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        { name: 'my-note.md', isFile: () => true, isDirectory: () => false },
      ] as any)
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        '![alt](images/my-note_20260216_001.png)'
      )
      vi.mocked(fs.unlink).mockResolvedValueOnce(undefined)

      const result = await service.cleanupUnusedImages(
        '/root',
        'my-note',
        '![alt](images/my-note_20260216_001.png)'
      )

      expect(result.success).toBe(true)
      expect(result.deletedFiles).toContain('my-note_20260216_002.png')
      expect(result.deletedFiles).not.toContain('my-note_20260216_001.png')
    })

    it('should not delete images referenced by other notes', async () => {
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        'my-note_20260216_001.png',
      ] as any)

      // Scan all md files
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        { name: 'my-note.md', isFile: () => true, isDirectory: () => false },
        { name: 'other-note.md', isFile: () => true, isDirectory: () => false },
      ] as any)
      // my-note.md does not reference the image
      vi.mocked(fs.readFile).mockResolvedValueOnce('no images here')
      // other-note.md references it
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        '![ref](images/my-note_20260216_001.png)'
      )

      const result = await service.cleanupUnusedImages(
        '/root',
        'my-note',
        'no images here'
      )

      expect(result.success).toBe(true)
      expect(result.deletedFiles).toEqual([])
    })

    it('should handle cleanup errors gracefully', async () => {
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        'my-note_20260216_001.png',
      ] as any)
      vi.mocked(fs.readdir).mockResolvedValueOnce([] as any)
      vi.mocked(fs.unlink).mockRejectedValueOnce(new Error('File locked'))

      const result = await service.cleanupUnusedImages(
        '/root',
        'my-note',
        'no images'
      )

      expect(result.success).toBe(true) // cleanup errors are non-fatal
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })

  describe('deleteNoteImages', () => {
    it('should delete all images for a note', async () => {
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        'my-note_20260216_001.png',
        'my-note_20260216_002.jpg',
        'other-note_20260216_001.png',
      ] as any)

      // Scan all md files for cross-references
      vi.mocked(fs.readdir).mockResolvedValueOnce([] as any)

      vi.mocked(fs.unlink).mockResolvedValue(undefined)

      const result = await service.deleteNoteImages('/root', 'my-note')

      expect(result.success).toBe(true)
      expect(result.deletedFiles).toContain('my-note_20260216_001.png')
      expect(result.deletedFiles).toContain('my-note_20260216_002.jpg')
      expect(result.deletedFiles).not.toContain('other-note_20260216_001.png')
    })

    it('should not delete images referenced by other notes', async () => {
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        'my-note_20260216_001.png',
      ] as any)

      vi.mocked(fs.readdir).mockResolvedValueOnce([
        { name: 'other-note.md', isFile: () => true, isDirectory: () => false },
      ] as any)
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        '![ref](images/my-note_20260216_001.png)'
      )

      const result = await service.deleteNoteImages('/root', 'my-note')

      expect(result.success).toBe(true)
      expect(result.deletedFiles).toEqual([])
    })
  })
})
