import { vi } from 'vitest'

export function createMockElectron() {
  return {
    app: {
      getPath: vi.fn((name: string) => `/mock/${name}`),
      getName: vi.fn(() => 'FlowMark'),
      whenReady: vi.fn(() => Promise.resolve()),
    },
    dialog: {
      showOpenDialog: vi.fn(() =>
        Promise.resolve({ canceled: false, filePaths: [] }),
      ),
      showSaveDialog: vi.fn(() =>
        Promise.resolve({ canceled: false, filePath: '' }),
      ),
    },
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      removeHandler: vi.fn(),
    },
    BrowserWindow: vi.fn(),
  }
}

export function createMockFs() {
  return {
    readFile: vi.fn((_path: string, _encoding?: string) =>
      Promise.resolve(''),
    ),
    writeFile: vi.fn(
      (_path: string, _data: string, _encoding?: string) =>
        Promise.resolve(undefined) as Promise<void>,
    ),
    readdir: vi.fn((_path: string, _options?: object) =>
      Promise.resolve([]),
    ),
    stat: vi.fn((_path: string) =>
      Promise.resolve({
        isFile: () => false,
        isDirectory: () => false,
        size: 0,
        mtime: new Date(),
      }),
    ),
    mkdir: vi.fn((_path: string, _options?: object) =>
      Promise.resolve(undefined) as Promise<void>,
    ),
    rename: vi.fn((_oldPath: string, _newPath: string) =>
      Promise.resolve(undefined) as Promise<void>,
    ),
    unlink: vi.fn((_path: string) =>
      Promise.resolve(undefined) as Promise<void>,
    ),
    rm: vi.fn((_path: string, _options?: object) =>
      Promise.resolve(undefined) as Promise<void>,
    ),
    access: vi.fn((_path: string) =>
      Promise.resolve(undefined) as Promise<void>,
    ),
    copyFile: vi.fn((_src: string, _dest: string) =>
      Promise.resolve(undefined) as Promise<void>,
    ),
  }
}
