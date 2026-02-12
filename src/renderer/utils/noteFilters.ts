import type { MarkdownNoteMeta } from '@/shared/types'

/**
 * 指定されたフォルダ内のノートをフィルタリング
 */
export function filterNotesByFolder(
  notes: MarkdownNoteMeta[],
  folderPath: string
): MarkdownNoteMeta[] {
  return notes.filter(note => {
    const noteDir = getNoteDirectory(note.relativePath)

    if (folderPath === '') {
      // ルートフォルダの場合は直下のノートのみ
      return noteDir === ''
    }
    // 選択されたフォルダ直下のノートのみ
    const normalizedNoteDir = noteDir.replace(/\\/g, '/')
    const normalizedFolderPath = folderPath.replace(/\\/g, '/')
    return normalizedNoteDir === normalizedFolderPath
  })
}

/**
 * ノートのディレクトリパスを取得
 */
export function getNoteDirectory(relativePath: string): string {
  if (!relativePath.includes('/') && !relativePath.includes('\\')) {
    return ''
  }

  return relativePath.substring(
    0,
    Math.max(relativePath.lastIndexOf('/'), relativePath.lastIndexOf('\\'))
  )
}

/**
 * タグでノートをフィルタリング
 */
export function filterNotesByTag(
  notes: MarkdownNoteMeta[],
  tag: string
): MarkdownNoteMeta[] {
  return notes.filter(
    note => note.tags && Array.isArray(note.tags) && note.tags.includes(tag)
  )
}
