import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../helpers/test-app-provider'

const mocks = vi.hoisted(() => {
  interface FakeHostInstance {
    deps: Record<string, any>
    start: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    reportError: ReturnType<typeof vi.fn>
  }
  return {
    hosts: [] as FakeHostInstance[],
    getVersion: vi.fn(),
    unsetRoots: vi.fn(),
    setNotesRootsProvider: vi.fn(),
    plugins: undefined as Record<string, unknown> | undefined,
  }
})

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: () => mocks.getVersion(),
}))

vi.mock('@/renderer/lib/tauriApi', () => ({
  tauriApi: {
    platform: 'MacIntel',
    get plugins() {
      return mocks.plugins
    },
  },
}))

vi.mock('@/renderer/lib/plugins/host/pluginHost', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('@/renderer/lib/plugins/host/pluginHost')
    >()
  class FakePluginHost {
    deps: Record<string, any>
    start = vi.fn(() => Promise.resolve())
    dispose = vi.fn(() => Promise.resolve())
    reportError = vi.fn()
    constructor(deps: Record<string, any>) {
      this.deps = deps
      mocks.hosts.push(this)
    }
  }
  return { ...actual, PluginHost: FakePluginHost }
})

import {
  type PluginHostContextValue,
  PluginHostProvider,
  usePluginHost,
  usePluginRegistries,
} from '@/renderer/contexts/PluginHostContext'

let captured: PluginHostContextValue | null = null

function Probe() {
  captured = usePluginHost()
  return null
}

function renderProvider(windowKind: 'main' | 'note' = 'main') {
  return renderWithProviders(
    <PluginHostProvider windowKind={windowKind}>
      <Probe />
    </PluginHostProvider>,
    { settings: { rootFolders: [{ path: '/notes/a' }, { path: '/notes/b' }] } }
  )
}

describe('PluginHostProvider', () => {
  beforeEach(() => {
    mocks.hosts.length = 0
    captured = null
    mocks.getVersion.mockResolvedValue('3.2.0')
    mocks.setNotesRootsProvider.mockImplementation(() => mocks.unsetRoots)
    mocks.plugins = {
      getState: vi.fn(),
      setNotesRootsProvider: mocks.setNotesRootsProvider,
    }
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('アプリバージョンの取得後に PluginHost を起動し、アンマウントで破棄する', async () => {
    const { unmount } = renderProvider('note')

    await waitFor(() => expect(captured?.host).not.toBeNull())
    const host = mocks.hosts.at(-1)
    expect(host?.deps.windowKind).toBe('note')
    expect(host?.deps.appVersion).toBe('3.2.0')
    expect(host?.deps.api).toBe(mocks.plugins)
    expect(host?.deps.registries).toBe(captured?.registries)
    expect(host?.start).toHaveBeenCalled()
    expect(captured?.registries.keymaps.platform).toBe('mac')

    unmount()
    expect(host?.dispose).toHaveBeenCalled()
    expect(mocks.unsetRoots).toHaveBeenCalled()
  })

  it('ノートAPIの roots と getRootFolders に settings.rootFolders を渡す', async () => {
    renderProvider()

    await waitFor(() => expect(captured?.host).not.toBeNull())
    const provider = mocks.setNotesRootsProvider.mock.calls[0][0] as () => {
      path: string
    }[]
    expect(provider().map(r => r.path)).toEqual(['/notes/a', '/notes/b'])
    expect(mocks.hosts.at(-1)?.deps.getRootFolders()).toEqual([
      '/notes/a',
      '/notes/b',
    ])
  })

  it('notes.delete の確認ダイアログで確定なら true、キャンセルなら false を返す', async () => {
    renderProvider()
    await waitFor(() => expect(captured?.host).not.toBeNull())
    const confirmDelete = mocks.hosts.at(-1)?.deps.confirmDelete as (
      r: unknown
    ) => Promise<boolean>
    const request = {
      pluginId: 'p',
      pluginName: 'My Plugin',
      noteName: 'Daily',
      path: '/notes/a/Daily.md',
    }

    let first!: Promise<boolean>
    act(() => {
      first = confirmDelete(request)
    })
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('My Plugin')
    expect(dialog).toHaveTextContent('Daily')
    act(() => screen.getByRole('button', { name: 'Delete' }).click())
    await expect(first).resolves.toBe(true)

    let second!: Promise<boolean>
    act(() => {
      second = confirmDelete(request)
    })
    await screen.findByRole('dialog')
    act(() => screen.getByRole('button', { name: 'Cancel' }).click())
    await expect(second).resolves.toBe(false)
  })

  it('レジストリのリスナー例外を PluginHost.reportError に報告する', async () => {
    renderProvider()
    await waitFor(() => expect(captured?.host).not.toBeNull())
    const registries = captured!.registries
    const error = new Error('boom')
    registries.setLoadOrder(['p'])
    registries.activeNote.subscribe('p', () => {
      throw error
    })
    registries.activeNote.publish({
      type: 'switched',
      note: null,
      windowKind: 'main',
    })
    expect(mocks.hosts.at(-1)?.reportError).toHaveBeenCalledWith(
      'p',
      'activate',
      error
    )
  })

  it('tauriApi.plugins が無い環境では PluginHost を起動しない', async () => {
    mocks.plugins = undefined
    renderProvider()

    expect(captured?.registries).toBeDefined()
    await Promise.resolve()
    expect(mocks.getVersion).not.toHaveBeenCalled()
    expect(mocks.hosts).toHaveLength(0)
    expect(captured?.host).toBeNull()
  })

  it('Provider の外ではフックが null を返す', () => {
    let host: unknown = 'unset'
    let registries: unknown = 'unset'
    function Outside() {
      host = usePluginHost()
      registries = usePluginRegistries()
      return null
    }
    render(<Outside />)
    expect(host).toBeNull()
    expect(registries).toBeNull()
  })
})
