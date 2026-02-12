import { vi } from 'vitest'

export function createMockWindowApp(): Window['App'] {
  return {
    sayHelloFromBridge: vi.fn(),
    username: 'test-user',
    markdown: {
      selectRootFolder: vi.fn(() => Promise.resolve(null)),
      checkRootExists: vi.fn((_rootDir: string) => Promise.resolve(true)),
      scanNotes: vi.fn((_rootDir: string) => Promise.resolve([])),
      buildFolderTree: vi.fn((_rootDir: string, _notes) =>
        Promise.resolve({ name: 'root', relativePath: '', children: [], notes: [] }),
      ),
      getNoteContent: vi.fn((_filePath: string) => Promise.resolve(null)),
      saveNote: vi.fn(
        (_filePath: string, _content: string, _frontMatter?: Record<string, any>) =>
          Promise.resolve(true),
      ),
      createNote: vi.fn(
        (_rootDir: string, _folderPath: string, _title: string) =>
          Promise.resolve(null),
      ),
      createFolder: vi.fn((_rootDir: string, _folderPath: string) =>
        Promise.resolve(true),
      ),
      renameNote: vi.fn((_oldPath: string, _newTitle: string) =>
        Promise.resolve(null),
      ),
      deleteNote: vi.fn((_filePath: string) => Promise.resolve(true)),
      moveNote: vi.fn(
        (_rootDir: string, _currentFilePath: string, _targetFolder: string) =>
          Promise.resolve(null),
      ),
      deleteFolder: vi.fn((_rootDir: string, _folderPath: string) =>
        Promise.resolve(true),
      ),
    },
    shell: {
      openExternal: vi.fn((_url: string) => Promise.resolve()),
    },
    window: {
      minimize: vi.fn(() => Promise.resolve()),
      maximize: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
      isMaximized: vi.fn(() => Promise.resolve(false)),
    },
  } as unknown as Window['App']
}
