import { contextBridge, ipcRenderer } from 'electron'
import type {
  MarkdownNoteMeta,
  FolderNode,
  NoteContent,
  ImageSaveResult,
  CleanupResult,
} from '@/shared/types'

declare global {
  interface Window {
    App: typeof API
  }
}

const API = {
  sayHelloFromBridge: () => console.log('\nHello from bridgeAPI! 👋\n\n'),
  username: process.env.USER,

  // Markdown関連のAPI
  markdown: {
    selectRootFolder: (): Promise<string | null> =>
      ipcRenderer.invoke('markdown:selectRootFolder'),

    checkRootExists: (rootDir: string): Promise<boolean> =>
      ipcRenderer.invoke('markdown:checkRootExists', rootDir),

    scanNotes: (rootDir: string): Promise<MarkdownNoteMeta[]> =>
      ipcRenderer.invoke('markdown:scanNotes', rootDir),

    buildFolderTree: (
      rootDir: string,
      notes: MarkdownNoteMeta[]
    ): Promise<FolderNode> =>
      ipcRenderer.invoke('markdown:buildFolderTree', rootDir, notes),

    getNoteContent: (filePath: string): Promise<NoteContent | null> =>
      ipcRenderer.invoke('markdown:getNoteContent', filePath),

    saveNote: (
      filePath: string,
      content: string,
      frontMatter?: Record<string, any>
    ): Promise<boolean> =>
      ipcRenderer.invoke('markdown:saveNote', filePath, content, frontMatter),

    createNote: (
      rootDir: string,
      folderPath: string,
      title: string
    ): Promise<string | null> =>
      ipcRenderer.invoke('markdown:createNote', rootDir, folderPath, title),

    createFolder: (rootDir: string, folderPath: string): Promise<boolean> =>
      ipcRenderer.invoke('markdown:createFolder', rootDir, folderPath),

    renameNote: (oldPath: string, newTitle: string): Promise<string | null> =>
      ipcRenderer.invoke('markdown:renameNote', oldPath, newTitle),

    deleteNote: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke('markdown:deleteNote', filePath),

    moveNote: (
      rootDir: string,
      currentFilePath: string,
      targetFolder: string
    ): Promise<string | null> =>
      ipcRenderer.invoke(
        'markdown:moveNote',
        rootDir,
        currentFilePath,
        targetFolder
      ),

    deleteFolder: (rootDir: string, folderPath: string): Promise<boolean> =>
      ipcRenderer.invoke('markdown:deleteFolder', rootDir, folderPath),

    watchFile: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke('markdown:watchFile', filePath),

    unwatchFile: (filePath: string): Promise<boolean> =>
      ipcRenderer.invoke('markdown:unwatchFile', filePath),

    onFileChanged: (callback: (filePath: string) => void) => {
      const listener = (_event: any, filePath: string) => callback(filePath)
      ipcRenderer.on('markdown:fileChanged', listener)
      return () => ipcRenderer.removeListener('markdown:fileChanged', listener)
    },
  },

  // 画像操作API
  image: {
    saveFromFile: (
      rootDir: string,
      noteBaseName: string,
      sourceFilePath: string
    ): Promise<ImageSaveResult> =>
      ipcRenderer.invoke(
        'image:saveFromFile',
        rootDir,
        noteBaseName,
        sourceFilePath
      ),

    saveFromBuffer: (
      rootDir: string,
      noteBaseName: string,
      buffer: ArrayBuffer,
      extension: string
    ): Promise<ImageSaveResult> =>
      ipcRenderer.invoke(
        'image:saveFromBuffer',
        rootDir,
        noteBaseName,
        buffer,
        extension
      ),

    selectFile: (): Promise<string[]> => ipcRenderer.invoke('image:selectFile'),

    cleanupUnused: (
      rootDir: string,
      noteBaseName: string,
      markdownContent: string
    ): Promise<CleanupResult> =>
      ipcRenderer.invoke(
        'image:cleanupUnused',
        rootDir,
        noteBaseName,
        markdownContent
      ),

    deleteNoteImages: (
      rootDir: string,
      noteBaseName: string
    ): Promise<CleanupResult> =>
      ipcRenderer.invoke('image:deleteNoteImages', rootDir, noteBaseName),
  },

  // エクスポートAPI
  export: {
    pdf: (
      html: string,
      title: string
    ): Promise<{
      success: boolean
      filePath?: string
      canceled?: boolean
      error?: string
    }> => ipcRenderer.invoke('export:pdf', { html, title }),

    html: (
      html: string,
      title: string
    ): Promise<{
      success: boolean
      filePath?: string
      canceled?: boolean
      error?: string
    }> => ipcRenderer.invoke('export:html', { html, title }),
  },

  // Shell関連のAPI
  shell: {
    openExternal: (url: string): Promise<boolean> =>
      ipcRenderer.invoke('shell:openExternal', url),
  },
  // ウィンドウ操作API
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> =>
      ipcRenderer.invoke('window:isMaximized'),
    openNoteWindow: (notePath: string): Promise<boolean> =>
      ipcRenderer.invoke('window:openNoteWindow', notePath),
  },
}

contextBridge.exposeInMainWorld('App', API)
