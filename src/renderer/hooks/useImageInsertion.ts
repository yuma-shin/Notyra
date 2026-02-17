import { useState, useMemo, useCallback, useRef } from 'react'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

const SUPPORTED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']
const SUPPORTED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

function isImageFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  return SUPPORTED_IMAGE_EXTENSIONS.includes(ext)
}

function isImageMimeType(type: string): boolean {
  return SUPPORTED_IMAGE_MIME_TYPES.includes(type)
}

function getExtensionFromFile(file: File): string | null {
  if (isImageMimeType(file.type)) {
    return MIME_TO_EXT[file.type] || null
  }
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  return SUPPORTED_IMAGE_EXTENSIONS.includes(ext) ? ext : null
}

interface UseImageInsertionParams {
  rootDir: string | undefined
  noteBaseName: string | undefined
  editorViewRef: React.RefObject<EditorView | null>
}

interface UseImageInsertionReturn {
  imageHandlerExtension: Extension
  handleToolbarImageInsert: () => Promise<void>
  isInserting: boolean
  lastError: string | null
}

export function useImageInsertion({
  rootDir,
  noteBaseName,
  editorViewRef,
}: UseImageInsertionParams): UseImageInsertionReturn {
  const [isInserting, setIsInserting] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const isInsertingRef = useRef(false)

  const insertMarkdownImages = useCallback(
    (view: EditorView, relativePaths: string[]) => {
      if (relativePaths.length === 0) return
      const pos = view.state.selection.main.head
      const imageMarkdown = relativePaths
        .map(relativePath => `![image](${relativePath})`)
        .join('\n')
        .concat('\n')
      view.dispatch({
        changes: { from: pos, insert: imageMarkdown },
        selection: { anchor: pos + imageMarkdown.length },
      })
    },
    []
  )

  const saveAndInsertFromFiles = useCallback(
    async (view: EditorView, filePaths: string[]) => {
      if (!rootDir || !noteBaseName || isInsertingRef.current) return
      if (filePaths.length === 0) return

      const App = window.App
      if (!App) return

      isInsertingRef.current = true
      setIsInserting(true)
      setLastError(null)

      try {
        const insertedPaths: string[] = []
        for (const filePath of filePaths) {
          const result = await App.image.saveFromFile(
            rootDir,
            noteBaseName,
            filePath
          )
          if (result.success && result.relativePath) {
            insertedPaths.push(result.relativePath)
          } else {
            setLastError(result.error || '画像の保存に失敗しました')
          }
        }
        insertMarkdownImages(view, insertedPaths)
      } catch (error) {
        setLastError(
          error instanceof Error ? error.message : '画像の保存に失敗しました'
        )
      } finally {
        isInsertingRef.current = false
        setIsInserting(false)
      }
    },
    [rootDir, noteBaseName, insertMarkdownImages]
  )

  const saveAndInsertFromDroppedFiles = useCallback(
    async (view: EditorView, files: File[]) => {
      if (!rootDir || !noteBaseName || isInsertingRef.current) return
      if (files.length === 0) return

      const App = window.App
      if (!App) return

      isInsertingRef.current = true
      setIsInserting(true)
      setLastError(null)

      try {
        const insertedPaths: string[] = []

        for (const file of files) {
          const extension = getExtensionFromFile(file)
          if (!extension) continue
          const buffer = await file.arrayBuffer()
          const result = await App.image.saveFromBuffer(
            rootDir,
            noteBaseName,
            buffer,
            extension
          )
          if (result.success && result.relativePath) {
            insertedPaths.push(result.relativePath)
          } else {
            setLastError(result.error || '画像の保存に失敗しました')
          }
        }

        insertMarkdownImages(view, insertedPaths)
      } catch (error) {
        setLastError(
          error instanceof Error ? error.message : '画像の保存に失敗しました'
        )
      } finally {
        isInsertingRef.current = false
        setIsInserting(false)
      }
    },
    [rootDir, noteBaseName, insertMarkdownImages]
  )

  const saveAndInsertFromBuffers = useCallback(
    async (
      view: EditorView,
      items: Array<{ buffer: ArrayBuffer; extension: string }>
    ) => {
      if (!rootDir || !noteBaseName || isInsertingRef.current) return
      if (items.length === 0) return

      const App = window.App
      if (!App) return

      isInsertingRef.current = true
      setIsInserting(true)
      setLastError(null)

      try {
        const insertedPaths: string[] = []
        for (const { buffer, extension } of items) {
          const result = await App.image.saveFromBuffer(
            rootDir,
            noteBaseName,
            buffer,
            extension
          )
          if (result.success && result.relativePath) {
            insertedPaths.push(result.relativePath)
          } else {
            setLastError(result.error || '画像の保存に失敗しました')
          }
        }
        insertMarkdownImages(view, insertedPaths)
      } catch (error) {
        setLastError(
          error instanceof Error ? error.message : '画像の保存に失敗しました'
        )
      } finally {
        isInsertingRef.current = false
        setIsInserting(false)
      }
    },
    [rootDir, noteBaseName, insertMarkdownImages]
  )

  const imageHandlerExtension = useMemo(() => {
    return EditorView.domEventHandlers({
      dragenter(event) {
        if (event.dataTransfer?.types.includes('Files')) {
          event.preventDefault()
          const target = event.currentTarget as HTMLElement
          target.closest('.cm-editor')?.classList.add('editor-drop-target')
        }
      },
      dragover(event) {
        if (event.dataTransfer?.types.includes('Files')) {
          event.preventDefault()
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy'
          }
        }
      },
      dragleave(event) {
        const target = event.currentTarget as HTMLElement
        const editor = target.closest('.cm-editor')
        const relatedTarget = event.relatedTarget as HTMLElement | null
        if (!editor?.contains(relatedTarget)) {
          editor?.classList.remove('editor-drop-target')
        }
      },
      drop(event, view) {
        const editor = (event.currentTarget as HTMLElement).closest(
          '.cm-editor'
        )
        editor?.classList.remove('editor-drop-target')

        const files = event.dataTransfer?.files
        if (!files || files.length === 0) return false

        const imageFiles = Array.from(files).filter(
          f => isImageFile(f.name) || isImageMimeType(f.type)
        )
        if (imageFiles.length === 0) return false

        event.preventDefault()
        saveAndInsertFromDroppedFiles(view, imageFiles)

        return true
      },
      paste(event, view) {
        const items = event.clipboardData?.items
        if (!items) return false

        const imageItems = Array.from(items).filter(item =>
          isImageMimeType(item.type)
        )
        if (imageItems.length === 0) return false

        event.preventDefault()

        Promise.all(
          imageItems.map(async item => {
            const blob = item.getAsFile()
            if (!blob) return null
            const buffer = await blob.arrayBuffer()
            return { buffer, extension: MIME_TO_EXT[item.type] || 'png' }
          })
        ).then(results => {
          const valid = results.filter(
            (r): r is { buffer: ArrayBuffer; extension: string } => r !== null
          )
          if (valid.length > 0) {
            saveAndInsertFromBuffers(view, valid)
          }
        })

        return true
      },
    })
  }, [saveAndInsertFromDroppedFiles, saveAndInsertFromBuffers])

  const handleToolbarImageInsert = useCallback(async () => {
    if (!rootDir || !noteBaseName || isInsertingRef.current) return

    const App = window.App
    if (!App) return

    const view = editorViewRef.current
    if (!view) return

    try {
      const filePaths = await App.image.selectFile()
      if (!filePaths || filePaths.length === 0) return

      await saveAndInsertFromFiles(view, filePaths)
    } catch (error) {
      setLastError(
        error instanceof Error ? error.message : '画像の選択に失敗しました'
      )
    }
  }, [rootDir, noteBaseName, editorViewRef, saveAndInsertFromFiles])

  return {
    imageHandlerExtension,
    handleToolbarImageInsert,
    isInserting,
    lastError,
  }
}
