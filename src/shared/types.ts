import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

import type { registerRoute } from 'lib/electron-router-dom'

export type BrowserWindowOrNull = Electron.BrowserWindow | null

type Route = Parameters<typeof registerRoute>[0]

export interface WindowProps extends Electron.BrowserWindowConstructorOptions {
  id: Route['id']
  query?: Route['query']
}

export interface WindowCreationByIPC {
  channel: string
  window(): BrowserWindowOrNull
  callback(window: BrowserWindow, event: IpcMainInvokeEvent): void
}

// Markdown Editor Types

export interface MarkdownNoteMeta {
  id: string
  title: string
  filePath: string // 絶対パス
  relativePath: string // ルートからの相対パス
  tags?: string[]
  createdAt?: string // ISO形式
  updatedAt?: string // ISO形式
  excerpt?: string // 本文の一部
}

export interface FolderNode {
  name: string
  relativePath: string
  children: FolderNode[]
  notes: MarkdownNoteMeta[]
}

export interface AppSettings {
  rootDir?: string
  editorLayoutMode: 'editor' | 'preview' | 'split'
  theme: 'light' | 'dark' | 'system'
  language: 'en' | 'ja'
  lastOpenedNotePath?: string
  lastSelectedFolder?: string
  showSidebar?: boolean
  showNoteList?: boolean
}

export interface NoteContent {
  meta: MarkdownNoteMeta
  content: string
  rawContent: string // front matterを含む生のファイル内容
}
