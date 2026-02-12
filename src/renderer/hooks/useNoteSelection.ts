import { useState } from 'react'
import type { MarkdownNoteMeta } from '@/shared/types'
import { filterNotesByFolder, filterNotesByTag } from '../utils/noteFilters'

export function useNoteSelection(allNotes: MarkdownNoteMeta[]) {
  const [selectedFolder, setSelectedFolder] = useState<string>('')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [showAllNotes, setShowAllNotes] = useState(false)
  const [filteredNotes, setFilteredNotes] = useState<MarkdownNoteMeta[]>([])

  const handleSelectFolder = (relativePath: string) => {
    setSelectedFolder(relativePath)
    setSelectedTag(null)
    setShowAllNotes(false)

    const filtered = filterNotesByFolder(allNotes, relativePath)
    setFilteredNotes(filtered)
  }

  const handleSelectTag = (tag: string | null) => {
    setSelectedTag(tag)

    if (tag === null) {
      // タグフィルターをクリア
      if (showAllNotes) {
        setFilteredNotes(allNotes)
      } else {
        const filtered = filterNotesByFolder(allNotes, selectedFolder)
        setFilteredNotes(filtered)
      }
    } else {
      // タグでフィルタリング
      const scopedNotes = showAllNotes
        ? allNotes
        : filterNotesByFolder(allNotes, selectedFolder)
      const filtered = filterNotesByTag(scopedNotes, tag)
      setFilteredNotes(filtered)
    }
  }

  const handleShowAllNotes = () => {
    setShowAllNotes(true)
    setSelectedFolder('')
    setSelectedTag(null)
    setFilteredNotes(allNotes)
  }

  return {
    selectedFolder,
    selectedTag,
    showAllNotes,
    filteredNotes,
    setFilteredNotes,
    handleSelectFolder,
    handleSelectTag,
    handleShowAllNotes,
  }
}
