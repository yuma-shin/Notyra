import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePluginInstallRequest } from '@/renderer/hooks/usePluginInstallRequest'
import type { PluginInstallRequest } from '@/shared/plugin/installLink'

const mocks = vi.hoisted(() => ({ getPending: vi.fn(), dismiss: vi.fn(), onChanged: vi.fn() }))
vi.mock('@/renderer/lib/tauriApi', () => ({ tauriApi: { installLinks: mocks } }))
const request: PluginInstallRequest = { requestId: 1, repo: 'yuma-shin/notyra-plugins', pluginId: 'notyra-theme-blue' }

describe('website install inbox', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.onChanged.mockReturnValue(vi.fn()); mocks.getPending.mockResolvedValue(request); mocks.dismiss.mockResolvedValue(undefined) })
  afterEach(cleanup)

  it('finds a cold-start request without an event, and only dismisses explicitly', async () => {
    const notify = vi.fn()
    const { result } = renderHook(() => usePluginInstallRequest(notify))
    await waitFor(() => expect(result.current.request).toEqual(request))
    expect(notify).toHaveBeenCalledOnce()
    expect(mocks.dismiss).not.toHaveBeenCalled()
    expect(mocks.onChanged.mock.invocationCallOrder[0]).toBeLessThan(mocks.getPending.mock.invocationCallOrder[0])
    mocks.getPending.mockResolvedValue(null)
    await act(() => result.current.dismiss(1))
    expect(mocks.dismiss).toHaveBeenCalledWith(1)
    expect(result.current.request).toBeNull()
  })

  it('ignores an old snapshot when a newer warm-start event arrives', async () => {
    let resolveOld!: (value: PluginInstallRequest | null) => void
    mocks.getPending.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    const notify = vi.fn()
    const { result, unmount } = renderHook(() => usePluginInstallRequest(notify))
    const changed = mocks.onChanged.mock.calls[0][0]
    await act(async () => changed())
    await waitFor(() => expect(result.current.request).toEqual(request))
    await act(async () => resolveOld(null))
    expect(result.current.request).toEqual(request)
    unmount()
    expect(mocks.onChanged.mock.results[0].value).toHaveBeenCalledOnce()
  })
})
