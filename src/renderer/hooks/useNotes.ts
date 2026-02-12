import { useState, useEffect, useRef } from 'react'
import type { MarkdownNoteMeta } from '@/shared/types'
import { filterNotesByFolder, filterNotesByTag } from '../utils/noteFilters'

interface UseNoteFilteringProps {
  allNotes: MarkdownNoteMeta[]
  selectedFolder: string
  selectedTag: string | null
  showAllNotes: boolean
}

export function useNoteFiltering({
  allNotes,
  selectedFolder,
  selectedTag,
  showAllNotes,
}: UseNoteFilteringProps) {
  const [filteredNotes, setFilteredNotes] = useState<MarkdownNoteMeta[]>([])

  // フィルタリングロジック
  useEffect(() => {
    let result = allNotes

    // タグフィルター
    if (selectedTag) {
      const scopedNotes = showAllNotes
        ? allNotes
        : filterNotesByFolder(allNotes, selectedFolder)
      result = filterNotesByTag(scopedNotes, selectedTag)
    }
    // フォルダフィルター
    else if (showAllNotes) {
      result = allNotes
    } else {
      result = filterNotesByFolder(allNotes, selectedFolder)
    }

    setFilteredNotes(result)
  }, [allNotes, selectedFolder, selectedTag, showAllNotes])

  return filteredNotes
}

interface UseNoteManagementProps {
  rootDir: string | undefined
  selectedFolder: string
  allNotes: MarkdownNoteMeta[]
  setAllNotes: (notes: MarkdownNoteMeta[]) => void
  setFolderTree: (tree: any) => void
  setFilteredNotes: (notes: MarkdownNoteMeta[]) => void
}

export function useNoteManagement({
  rootDir,
  selectedFolder,
  allNotes,
  setAllNotes,
  setFolderTree,
  setFilteredNotes,
}: UseNoteManagementProps) {
  const { App } = window
  void allNotes

  const createNote = async (title: string) => {
    if (!rootDir) return null

    try {
      const filePath = await App.markdown.createNote(
        rootDir,
        selectedFolder,
        title
      )
      if (filePath) {
        const notes = await App.markdown.scanNotes(rootDir)
        setAllNotes(notes)

        const tree = await App.markdown.buildFolderTree(rootDir, notes)
        setFolderTree(tree)

        const filtered = filterNotesByFolder(notes, selectedFolder)
        setFilteredNotes(filtered)

        return notes.find(n => n.filePath === filePath) || null
      }
      return null
    } catch (error) {
      console.error('Failed to create note:', error)
      return null
    }
  }

  const createFolder = async (folderName: string) => {
    if (!rootDir) return false

    try {
      const newPath = selectedFolder
        ? `${selectedFolder}/${folderName}`
        : folderName
      const success = await App.markdown.createFolder(rootDir, newPath)
      if (success) {
        const notes = await App.markdown.scanNotes(rootDir)
        setAllNotes(notes)

        const tree = await App.markdown.buildFolderTree(rootDir, notes)
        setFolderTree(tree)

        return true
      }
      return false
    } catch (error) {
      console.error('Failed to create folder:', error)
      return false
    }
  }

  return {
    createNote,
    createFolder,
  }
}

interface UseFileWatcherProps {
  selectedNote: MarkdownNoteMeta | null
  setNoteContent: (content: string) => void
}

export function useFileWatcher({
  selectedNote,
  setNoteContent,
}: UseFileWatcherProps) {
  const { App } = window
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const lastSaveTimeRef = useRef<number>(0)
  const reloadTimeoutRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!selectedNote) return

    App.markdown.watchFile(selectedNote.filePath)

    const unsubscribe = App.markdown.onFileChanged(async changedPath => {
      if (changedPath === selectedNote.filePath) {
        if (saveTimeoutRef.current) return

        const timeSinceLastSave = Date.now() - lastSaveTimeRef.current
        if (timeSinceLastSave < 1000) return

        if (reloadTimeoutRef.current) {
          clearTimeout(reloadTimeoutRef.current)
        }

        reloadTimeoutRef.current = window.setTimeout(async () => {
          try {
            const content = await App.markdown.getNoteContent(
              selectedNote.filePath
            )
            if (content) {
              setNoteContent(content.content)
            }
          } catch (error) {
            console.error('Failed to reload note:', error)
          }
        }, 300)
      }
    })

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current)
      }
      App.markdown.unwatchFile(selectedNote.filePath)
      unsubscribe()
    }
  }, [selectedNote?.filePath, setNoteContent])

  const saveNote = async (filePath: string, content: string) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    return new Promise<void>((resolve, reject) => {
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          await App.markdown.saveNote(filePath, content)
          lastSaveTimeRef.current = Date.now()
          resolve()
        } catch (error) {
          reject(error)
        } finally {
          saveTimeoutRef.current = undefined
        }
      }, 1000)
    })
  }

  return { saveNote }
}
