import { app, ipcMain, shell, BrowserWindow } from 'electron'
import * as fs from 'node:fs'

import { makeAppWithSingleInstanceLock } from 'lib/electron-app/factories/app/instance'
import { makeAppSetup } from 'lib/electron-app/factories/app/setup'
import { loadReactDevtools } from 'lib/electron-app/utils'
import { ENVIRONMENT } from 'shared/constants'
import { MainWindow } from './windows/main'
import { waitFor } from 'shared/utils'
import { MarkdownService } from './services/markdown-service'

const markdownService = new MarkdownService()
let mainWindow: BrowserWindow | null = null
const fileWatchers = new Map<string, fs.FSWatcher>()
const openWindows = new Set<BrowserWindow>()

makeAppWithSingleInstanceLock(async () => {
  await app.whenReady()

  const window = await makeAppSetup(MainWindow)
  mainWindow = window
  openWindows.add(window)

  window.on('closed', () => {
    openWindows.delete(window)
  })

  // ウィンドウ作成後にIPCハンドラを登録
  setupIpcHandlers()

  if (ENVIRONMENT.IS_DEV) {
    await loadReactDevtools()
    /* This trick is necessary to get the new
      React Developer Tools working at app initial load.
      Otherwise, it only works on manual reload.
    */
    window.webContents.once('devtools-opened', async () => {
      await waitFor(1000)
      window.webContents.reload()
    })
  }
})

function setupIpcHandlers() {
  // ルートフォルダ選択
  ipcMain.handle('markdown:selectRootFolder', async () => {
    return await markdownService.selectRootFolder()
  })

  // ルートフォルダ存在チェック
  ipcMain.handle(
    'markdown:checkRootExists',
    async (_event, rootDir: string) => {
      return await markdownService.checkRootExists(rootDir)
    }
  )

  // ノート一覧を取得
  ipcMain.handle('markdown:scanNotes', async (_event, rootDir: string) => {
    return await markdownService.scanNotes(rootDir)
  })

  // フォルダツリーを構築
  ipcMain.handle(
    'markdown:buildFolderTree',
    async (_event, rootDir: string, notes) => {
      return await markdownService.buildFolderTree(rootDir, notes)
    }
  )

  // ノート内容を取得
  ipcMain.handle(
    'markdown:getNoteContent',
    async (_event, filePath: string) => {
      return await markdownService.getNoteContent(filePath)
    }
  )

  // ノートを保存
  ipcMain.handle(
    'markdown:saveNote',
    async (
      _event,
      filePath: string,
      content: string,
      frontMatter?: Record<string, any>
    ) => {
      return await markdownService.saveNote(filePath, content, frontMatter)
    }
  )

  // ファイルの変更を監視開始
  ipcMain.handle('markdown:watchFile', async (_event, filePath: string) => {
    if (fileWatchers.has(filePath)) {
      return true
    }

    try {
      const watcher = fs.watch(filePath, eventType => {
        if (eventType === 'change') {
          // すべてのウィンドウに変更を通知
          openWindows.forEach(window => {
            if (!window.isDestroyed()) {
              window.webContents.send('markdown:fileChanged', filePath)
            }
          })
        }
      })

      fileWatchers.set(filePath, watcher)
      return true
    } catch (error) {
      console.error('Failed to watch file:', error)
      return false
    }
  })

  // ファイルの監視を停止
  ipcMain.handle('markdown:unwatchFile', async (_event, filePath: string) => {
    const watcher = fileWatchers.get(filePath)
    if (watcher) {
      watcher.close()
      fileWatchers.delete(filePath)
    }
    return true
  })

  // 新規ノートを作成
  ipcMain.handle(
    'markdown:createNote',
    async (_event, rootDir: string, folderPath: string, title: string) => {
      return await markdownService.createNote(rootDir, folderPath, title)
    }
  )

  // フォルダを作成
  ipcMain.handle(
    'markdown:createFolder',
    async (_event, rootDir: string, folderPath: string) => {
      return await markdownService.createFolder(rootDir, folderPath)
    }
  )

  // ノートをリネーム
  ipcMain.handle(
    'markdown:renameNote',
    async (_event, oldPath: string, newTitle: string) => {
      return await markdownService.renameNote(oldPath, newTitle)
    }
  )

  // ノートを削除
  ipcMain.handle('markdown:deleteNote', async (_event, filePath: string) => {
    return await markdownService.deleteNote(filePath)
  })

  // ノートを移動
  ipcMain.handle(
    'markdown:moveNote',
    async (
      _event,
      rootDir: string,
      currentFilePath: string,
      targetFolder: string
    ) => {
      return await markdownService.moveNote(
        rootDir,
        currentFilePath,
        targetFolder
      )
    }
  )

  // フォルダを削除
  ipcMain.handle(
    'markdown:deleteFolder',
    async (_event, rootDir: string, folderPath: string) => {
      return await markdownService.deleteFolder(rootDir, folderPath)
    }
  )

  // 外部リンクを開く
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    await shell.openExternal(url)
  })

  // ノートを新しいウィンドウで開く
  ipcMain.handle('window:openNoteWindow', async (_event, notePath: string) => {
    try {
      const path = require('node:path')

      const noteWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        show: false, // 準備ができるまで表示しない
        frame: false, // フレームレスウィンドウにする
        webPreferences: {
          preload: path.join(__dirname, '../preload/index.js'),
          nodeIntegration: false,
          contextIsolation: true,
        },
        backgroundColor: '#ffffff',
      })

      // ノートパスをクエリパラメータとして渡す
      const encodedPath = encodeURIComponent(notePath)

      // ウィンドウが準備できたら表示
      noteWindow.once('ready-to-show', () => {
        noteWindow.show()
      })

      openWindows.add(noteWindow)

      noteWindow.on('closed', () => {
        openWindows.delete(noteWindow)
      })

      if (ENVIRONMENT.IS_DEV) {
        // 開発モードではメインウィンドウのURLを取得して使用
        if (mainWindow && !mainWindow.isDestroyed()) {
          const mainUrl = mainWindow.webContents.getURL()
          const baseUrl = mainUrl.split('#')[0] // ハッシュより前の部分を取得
          await noteWindow.loadURL(`${baseUrl}#/editor?note=${encodedPath}`)
          noteWindow.webContents.openDevTools()
        } else {
          throw new Error('Main window is not available')
        }
      } else {
        await noteWindow.loadFile(
          path.join(__dirname, '../renderer/index.html'),
          {
            hash: `/editor?note=${encodedPath}`,
          }
        )
      }

      return true
    } catch (error) {
      console.error('Failed to open note window:', error)
      return false
    }
  })

  // ウィンドウ操作
  ipcMain.handle('window:minimize', event => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window && !window.isDestroyed()) {
      window.minimize()
    }
  })

  ipcMain.handle('window:maximize', event => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window && !window.isDestroyed()) {
      if (window.isMaximized()) {
        window.unmaximize()
      } else {
        window.maximize()
      }
    }
  })

  ipcMain.handle('window:close', event => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window && !window.isDestroyed()) {
      window.close()
    }
  })

  ipcMain.handle('window:isMaximized', event => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window && !window.isDestroyed()) {
      return window.isMaximized()
    }
    return false
  })
}
