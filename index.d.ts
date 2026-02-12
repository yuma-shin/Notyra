/// <reference types="vite/client" />

import type { MarkdownNoteMeta, FolderNode, NoteContent } from '@/shared/types'

declare global {
  interface Window {
    App: {
      sayHelloFromBridge: () => void
      username: string | undefined
      markdown: {
        selectRootFolder: () => Promise<string | null>
        checkRootExists: (rootDir: string) => Promise<boolean>
        scanNotes: (rootDir: string) => Promise<MarkdownNoteMeta[]>
        buildFolderTree: (rootDir: string, notes: MarkdownNoteMeta[]) => Promise<FolderNode>
        getNoteContent: (filePath: string) => Promise<NoteContent | null>
        saveNote: (filePath: string, content: string, frontMatter?: Record<string, any>) => Promise<boolean>
        createNote: (rootDir: string, folderPath: string, title: string) => Promise<string | null>
        createFolder: (rootDir: string, folderPath: string) => Promise<boolean>
        renameNote: (oldPath: string, newTitle: string) => Promise<string | null>
        deleteNote: (filePath: string) => Promise<boolean>
        moveNote: (rootDir: string, currentFilePath: string, targetFolder: string) => Promise<string | null>
        deleteFolder: (rootDir: string, folderPath: string) => Promise<boolean>
      }
      shell: {
        openExternal: (url: string) => Promise<void>
      }
      window: {
        minimize: () => Promise<void>
        maximize: () => Promise<void>
        close: () => Promise<void>
        isMaximized: () => Promise<boolean>
      }
    }
  }
}

export {}
