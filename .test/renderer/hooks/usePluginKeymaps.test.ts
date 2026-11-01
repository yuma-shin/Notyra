import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginApiError } from '@/shared/plugin/api'
import { usePluginKeymaps } from '@/renderer/hooks/usePluginKeymaps'
import { normalizeKey } from '@/renderer/lib/plugins/keybindings'
import {
  createRegistries,
  type Registries,
} from '@/renderer/lib/plugins/host/registries'

let registries: Registries
let reportError: ReturnType<typeof vi.fn>

function press(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

function addCommand(pluginId: string, id: string, run: () => unknown) {
  registries.commands.register(pluginId, { id, title: id, run })
}

beforeEach(() => {
  registries = createRegistries({
    platform: 'other',
    builtinKeybindings: new Set([normalizeKey('Mod-f', 'other') as string]),
  })
  reportError = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('usePluginKeymaps', () => {
  it('割り当てたキーで Plugin_Command を実行し、preventDefault する', () => {
    const run = vi.fn()
    addCommand('p1', 'go', run)
    registries.keymaps.register('p1', { key: 'Mod-Shift-k', command: 'go' })
    renderHook(() => usePluginKeymaps(registries, reportError))

    const event = press({ key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true })
    expect(run).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('一致しないキーは処理しない', () => {
    const run = vi.fn()
    addCommand('p1', 'go', run)
    registries.keymaps.register('p1', { key: 'Mod-k', command: 'go' })
    renderHook(() => usePluginKeymaps(registries, reportError))

    const event = press({ key: 'j', code: 'KeyJ', ctrlKey: true })
    expect(run).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('IME 変換中と処理済みの入力は扱わない', () => {
    const run = vi.fn()
    addCommand('p1', 'go', run)
    registries.keymaps.register('p1', { key: 'Mod-k', command: 'go' })
    renderHook(() => usePluginKeymaps(registries, reportError))

    press({ key: 'k', code: 'KeyK', ctrlKey: true, isComposing: true })
    const handled = new KeyboardEvent('keydown', {
      key: 'k',
      code: 'KeyK',
      ctrlKey: true,
      cancelable: true,
    })
    handled.preventDefault()
    act(() => {
      window.dispatchEvent(handled)
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('組み込みのキーバインドと重複する Plugin のキーは実行しない', () => {
    const run = vi.fn()
    addCommand('p1', 'find', run)
    registries.keymaps.register('p1', { key: 'Mod-f', command: 'find' })
    renderHook(() => usePluginKeymaps(registries, reportError))

    const event = press({ key: 'f', code: 'KeyF', ctrlKey: true })
    expect(run).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('Plugin 同士の重複は Load_Order が先の Plugin を実行する', () => {
    const first = vi.fn()
    const second = vi.fn()
    addCommand('p1', 'a', first)
    addCommand('p2', 'b', second)
    registries.keymaps.register('p2', { key: 'Alt-x', command: 'b' })
    registries.keymaps.register('p1', { key: 'Alt-x', command: 'a' })
    registries.setLoadOrder(['p1', 'p2'])
    renderHook(() => usePluginKeymaps(registries, reportError))

    press({ key: 'x', code: 'KeyX', altKey: true })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it('実行が失敗したら所有 Plugin のエラーとして報告する（タイムアウトを含む）', async () => {
    vi.useFakeTimers()
    addCommand('p1', 'boom', () => {
      throw new Error('boom')
    })
    addCommand('p1', 'hang', () => new Promise(() => {}))
    registries.keymaps.register('p1', { key: 'Alt-b', command: 'boom' })
    registries.keymaps.register('p1', { key: 'Alt-h', command: 'hang' })
    renderHook(() => usePluginKeymaps(registries, reportError))

    press({ key: 'b', code: 'KeyB', altKey: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(reportError).toHaveBeenCalledWith('p1', 'command', expect.any(Error))

    press({ key: 'h', code: 'KeyH', altKey: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    const [, , error] = reportError.mock.calls[1]
    expect((error as PluginApiError).kind).toBe('timeout')
  })

  it('キーのリピートは既定動作だけを抑止し、実行しない', () => {
    const run = vi.fn()
    addCommand('p1', 'go', run)
    registries.keymaps.register('p1', { key: 'Mod-k', command: 'go' })
    renderHook(() => usePluginKeymaps(registries, reportError))

    const event = press({ key: 'k', code: 'KeyK', ctrlKey: true, repeat: true })
    expect(event.defaultPrevented).toBe(true)
    expect(run).not.toHaveBeenCalled()
  })

  it('アンマウント後はキーを処理しない', () => {
    const run = vi.fn()
    addCommand('p1', 'go', run)
    registries.keymaps.register('p1', { key: 'Mod-k', command: 'go' })
    const { unmount } = renderHook(() =>
      usePluginKeymaps(registries, reportError)
    )
    unmount()

    press({ key: 'k', code: 'KeyK', ctrlKey: true })
    expect(run).not.toHaveBeenCalled()
  })
})
