import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { NoteContent } from '@/shared/types'
import type { NoteMutation } from '@/shared/noteMutation'
import { useNoteWorkspace } from '@/renderer/hooks/useNoteWorkspace'
import { EditorScreen } from '@/renderer/screens/editor'

const mocks = vi.hoisted(() => ({
  disk: new Map<string, NoteContent>(),
  mutations: new Set<(event: NoteMutation) => void>(),
  watchers: new Set<(path: string) => void>(),
  save: vi.fn(), ack: vi.fn(), meta: vi.fn(), watch: vi.fn(), unwatch: vi.fn(),
}))
vi.mock('@/renderer/contexts/AppContext', () => ({
  useApp: () => ({ settings: { theme: 'light', editorLayoutMode: 'split' }, updateSettings: vi.fn() }),
}))
vi.mock('@/renderer/contexts/PluginHostContext', () => ({
  PluginHostProvider: ({ children }: { children: ReactNode }) => children,
  usePluginRegistries: () => null,
}))
vi.mock('@/renderer/components/ui/toast', () => ({ ToastProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/renderer/components/CustomTitleBar', () => ({ CustomTitleBar: () => null }))
vi.mock('@/renderer/components/StatusBar', () => ({ StatusBar: () => null }))
vi.mock('@/renderer/hooks/useAppVersion', () => ({ useAppVersion: () => '3.1.7' }))
vi.mock('@/renderer/hooks/useEditorStatus', () => ({ useEditorStatus: () => ({}) }))
vi.mock('@/renderer/components/EditorView', () => ({
  EditorView: (props: { content: string; filePath: string; readOnly: boolean; onChange(body: string): void }) =>
    <textarea aria-label="detached editor" data-path={props.filePath} onChange={event => props.onChange(event.target.value)} readOnly={props.readOnly} value={props.content} />,
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onCloseRequested: vi.fn(async () => () => {}), destroy: vi.fn() }),
}))
vi.mock('@/renderer/lib/tauriApi', () => ({ tauriApi: {
  markdown: {
    checkRootExists: vi.fn(async () => true),
    scanNotesAndBuildFolderTree: vi.fn(async () => ({
      notes: [...mocks.disk.values()].map(note => note.meta),
      tree: { name: 'notes', relativePath: '', children: [], notes: [] },
    })),
    getNoteContent: vi.fn(async (path: string) => mocks.disk.get(path) ?? null),
    saveNote: (...args: unknown[]) => mocks.save(...args),
    watchFile: (...args: unknown[]) => mocks.watch(...args),
    unwatchFile: (...args: unknown[]) => mocks.unwatch(...args),
    onFileChanged: (callback: (path: string) => void) => {
      mocks.watchers.add(callback)
      return () => mocks.watchers.delete(callback)
    },
    onNoteMutation: (callback: (event: NoteMutation) => void) => {
      mocks.mutations.add(callback)
      return () => mocks.mutations.delete(callback)
    },
    ackNoteMutation: (...args: unknown[]) => mocks.ack(...args),
  },
  image: { cleanupAll: vi.fn() }, platform: 'Win32',
} }))

const PATH = '/notes/a.md'
const makeNote = (path: string, body: string, title = 'A'): NoteContent => ({
  content: body, rawContent: body,
  meta: { id: path, title, filePath: path, relativePath: path.slice('/notes/'.length), tags: ['tag'] },
})
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

beforeEach(() => {
  vi.useFakeTimers()
  mocks.disk.clear()
  mocks.disk.set(PATH, makeNote(PATH, 'initial'))
  mocks.mutations.clear()
  mocks.watchers.clear()
  mocks.save.mockReset().mockImplementation(async (path: string, body: string) => {
    mocks.disk.set(path, makeNote(path, body, mocks.disk.get(path)?.meta.title))
    for (const callback of mocks.watchers) callback(path)
    return true
  })
  mocks.ack.mockReset().mockResolvedValue(undefined)
  mocks.watch.mockReset().mockResolvedValue(true)
  mocks.unwatch.mockReset().mockResolvedValue(true)
  mocks.meta.mockReset()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

async function mountBoth() {
  const workspace = renderHook(() => useNoteWorkspace({ rootDir: '/notes', rootMeta: {}, onMetaChange: mocks.meta }))
  await act(settle)
  await act(async () => { await workspace.result.current.onSelectNote(mocks.disk.get(PATH)!.meta) })
  render(<MemoryRouter initialEntries={['/editor?note=%2Fnotes%2Fa.md&root=%2Fnotes']}><EditorScreen /></MemoryRouter>)
  await act(settle)
  expect(mocks.mutations.size).toBe(2)
  return workspace
}
async function phase(phase: NoteMutation['phase'], kind: NoteMutation['kind'], newPath: string | null = null) {
  mocks.ack.mockClear()
  await act(async () => {
    for (const listener of mocks.mutations) listener({
      requestId: phase, transactionId: 'tx', phase, kind, paths: [PATH], newPath,
    })
    await settle()
  })
  if (phase !== 'abort') expect(mocks.ack.mock.calls.filter(call => call[0] === phase)).toHaveLength(2)
}

it('reconciles a plugin update 200ms after typing, including pending autosaves in both windows', async () => {
  const workspace = await mountBoth()
  act(() => workspace.result.current.onContentChange('typed'))
  fireEvent.change(screen.getByLabelText('detached editor'), { target: { value: 'typed' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(200) })
  expect(mocks.save).not.toHaveBeenCalled()
  await phase('prepare', 'update')
  expect(mocks.save).toHaveBeenCalledTimes(2)
  expect(workspace.result.current.isNoteLocked).toBe(true)
  expect(screen.getByLabelText('detached editor')).toHaveAttribute('readonly')
  mocks.disk.set(PATH, makeNote(PATH, 'typed + plugin'))
  await phase('commit', 'update')
  expect(workspace.result.current.noteContent).toBe('typed + plugin')
  expect(screen.getByLabelText('detached editor')).toHaveValue('typed + plugin')
  expect(workspace.result.current.isNoteLocked).toBe(false)
  await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
  expect(mocks.save).toHaveBeenCalledTimes(2)
  expect(mocks.disk.get(PATH)?.content).toBe('typed + plugin')
})

it.each(['rename', 'move'] as const)('updates selected paths and cached metadata on plugin %s before the next edit', async kind => {
  const workspace = await mountBoth()
  act(() => workspace.result.current.onContentChange('pending edit'))
  await phase('prepare', kind)
  const newPath = kind === 'rename' ? '/notes/renamed.md' : '/notes/sub/moved.md'
  mocks.disk.set(newPath, makeNote(newPath, mocks.disk.get(PATH)!.content, 'Renamed'))
  mocks.disk.delete(PATH)
  await phase('commit', kind, newPath)
  expect(workspace.result.current.selectedNote?.filePath).toBe(newPath)
  expect(workspace.result.current.allNotes.map(note => note.filePath)).toEqual([newPath])
  expect(workspace.result.current.selectedNote?.tags).toEqual(['tag'])
  expect(mocks.meta).toHaveBeenCalledWith({ lastOpenedNotePath: newPath })
  expect(screen.getByLabelText('detached editor')).toHaveAttribute('data-path', newPath)
  expect(screen.getByLabelText('detached editor')).toHaveValue('pending edit')
  const callsBeforeEdit = mocks.save.mock.calls.length
  act(() => workspace.result.current.onContentChange('new edit in workspace'))
  fireEvent.change(screen.getByLabelText('detached editor'), { target: { value: 'new edit in window' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
  expect(mocks.save.mock.calls.slice(callsBeforeEdit).map(call => call[0])).toEqual([newPath, newPath])
  expect(mocks.disk.has(PATH)).toBe(false)
  expect(mocks.watch).toHaveBeenCalledWith(newPath)
  expect(mocks.unwatch).toHaveBeenCalledWith(PATH)
})

it('clears both editors and the workspace list after plugin deletion without resurrecting a pending save', async () => {
  const workspace = await mountBoth()
  act(() => workspace.result.current.onContentChange('pending edit'))
  await phase('prepare', 'delete')
  mocks.disk.delete(PATH)
  await phase('commit', 'delete')
  expect(workspace.result.current.selectedNote).toBeNull()
  expect(workspace.result.current.allNotes).toEqual([])
  expect(screen.queryByLabelText('detached editor')).not.toBeInTheDocument()
  await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
  expect(mocks.disk.has(PATH)).toBe(false)
})

it('reports failed local saves to the backend and resumes on abort', async () => {
  const workspace = await mountBoth()
  act(() => workspace.result.current.onContentChange('keep this edit'))
  mocks.save.mockRejectedValueOnce(new Error('disk full'))
  await phase('prepare', 'update')
  expect(mocks.ack).toHaveBeenCalledWith('prepare', 'Error: disk full')
  expect(workspace.result.current.saveError).toBe('disk full')
  await phase('abort', 'update')
  expect(workspace.result.current.isNoteLocked).toBe(false)
  expect(workspace.result.current.noteContent).toBe('keep this edit')
  await act(async () => { await workspace.result.current.flushPendingSave() })
  expect(mocks.disk.get(PATH)?.content).toBe('keep this edit')
})
