import { beforeEach, expect, it, vi } from 'vitest'
const mocked = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocked.invoke,
  convertFileSrc: (path: string) => path,
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: mocked.listen,
  emit: vi.fn(),
}))
import { tauriApi } from '@/renderer/lib/tauriApi'

beforeEach(() => {
  mocked.invoke.mockReset()
  mocked.listen.mockReset()
})

it('forwards plugin commands and current note roots with the correct argument names', async () => {
  mocked.invoke.mockResolvedValue(undefined)
  await tauriApi.plugins.fetchRelease('owner', 'repo')
  expect(mocked.invoke).toHaveBeenLastCalledWith('plugin_fetch_release', {
    owner: 'owner',
    repo: 'repo',
  })
  await tauriApi.plugins.fetchRelease('owner', 'repo', 'notyra-theme-blue')
  expect(mocked.invoke).toHaveBeenLastCalledWith('plugin_fetch_release', {
    owner: 'owner',
    repo: 'repo',
    pluginId: 'notyra-theme-blue',
  })
  await tauriApi.plugins.readStagingText('staging', 'theme.json')
  expect(mocked.invoke).toHaveBeenLastCalledWith('plugin_read_staging_text', {
    stagingId: 'staging',
    path: 'theme.json',
  })
  const dispose = tauriApi.plugins.setNotesRootsProvider(() => [
    { path: '/notes', name: 'Notes', id: 'root' },
  ])
  await tauriApi.plugins.notes.read('p', '/notes/a.md')
  expect(mocked.invoke).toHaveBeenLastCalledWith('plugin_notes_read', {
    pluginId: 'p',
    roots: ['/notes'],
    path: '/notes/a.md',
  })
  dispose()
  await tauriApi.plugins.notes.listRoots('p')
  expect(mocked.invoke).toHaveBeenLastCalledWith('plugin_notes_list_roots', {
    pluginId: 'p',
    roots: [],
  })
})
it('converts structured backend failures into PluginApiError', async () => {
  mocked.invoke.mockRejectedValue({
    kind: 'permissionDenied',
    permission: 'network',
  })
  await expect(
    tauriApi.plugins.httpRequest('p', { url: 'https://example.com' })
  ).rejects.toMatchObject({ name: 'PluginApiError', kind: 'permissionDenied' })
})
it('unsubscribes even when disposal precedes the asynchronous listen result', async () => {
  let resolve!: (unlisten: () => void) => void
  mocked.listen.mockReturnValue(
    new Promise(r => {
      resolve = r
    })
  )
  const callback = vi.fn()
  const dispose = tauriApi.plugins.onStateChanged(callback)
  const listener = mocked.listen.mock.calls[0][1]
  listener({ payload: { schemaVersion: 1 } })
  expect(callback).toHaveBeenCalledTimes(1)
  dispose()
  dispose()
  listener({ payload: {} })
  expect(callback).toHaveBeenCalledTimes(1)
  const unlisten = vi.fn()
  resolve(unlisten)
  await Promise.resolve()
  expect(unlisten).toHaveBeenCalledTimes(1)
})
