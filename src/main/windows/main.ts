import { BrowserWindow, shell, app } from 'electron'
import { join } from 'node:path'
import * as fs from 'node:fs'

import { createWindow } from 'lib/electron-app/factories/windows/create'
import { ENVIRONMENT } from 'shared/constants'
import { displayName } from '~/package.json'

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

const defaultWindowState: WindowState = {
  width: 1600,
  height: 1000,
  isMaximized: false,
}

function getWindowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState(): WindowState {
  try {
    const data = fs.readFileSync(getWindowStatePath(), 'utf-8')
    const parsed = JSON.parse(data)
    return { ...defaultWindowState, ...parsed }
  } catch {
    return defaultWindowState
  }
}

function saveWindowState(window: BrowserWindow): void {
  try {
    const isMaximized = window.isMaximized()
    // 最大化時はリストア時のサイズを保持するため getBounds() は使わない
    const bounds = isMaximized
      ? ((window as any).__normalBounds ?? window.getBounds())
      : window.getBounds()
    const state: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized,
    }
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state, null, 2))
  } catch (error) {
    console.error('Failed to save window state:', error)
  }
}

export async function MainWindow() {
  const savedState = loadWindowState()

  const windowOptions: Parameters<typeof createWindow>[0] = {
    id: 'main',
    title: displayName,
    width: savedState.width,
    height: savedState.height,
    minWidth: 800,
    minHeight: 600,
    show: false,
    movable: true,
    resizable: true,
    alwaysOnTop: false,
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
    },
  }

  // 保存済み位置があれば適用、なければ中央配置
  if (savedState.x !== undefined && savedState.y !== undefined) {
    windowOptions.x = savedState.x
    windowOptions.y = savedState.y
  } else {
    windowOptions.center = true
  }

  const window = createWindow(windowOptions)

  // 最大化前の通常サイズを記録しておく
  window.on('resize', () => {
    if (!window.isMaximized() && !window.isMinimized()) {
      ;(window as any).__normalBounds = window.getBounds()
    }
  })

  // 外部リンクをシステムブラウザで開く
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  // ナビゲーションを制御（アプリ内で外部サイトに遷移するのを防ぐ）
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  window.once('ready-to-show', () => {
    // 最大化状態を復元してから表示
    if (savedState.isMaximized) {
      window.maximize()
    }
    window.show()
  })

  if (ENVIRONMENT.IS_DEV) {
    window.webContents.on('did-finish-load', () => {
      window.webContents.openDevTools({ mode: 'detach' })
    })
  }

  window.on('close', () => {
    saveWindowState(window)
    for (const win of BrowserWindow.getAllWindows()) {
      win.destroy()
    }
  })

  return window
}
