import { contextBridge, ipcRenderer } from 'electron'
import type { MarkdownNoteMeta, FolderNode, NoteContent } from '@/shared/types'

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
