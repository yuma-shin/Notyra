import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginApiError } from '@/shared/plugin/api'
import { CommandRegistry } from '@/renderer/lib/plugins/host/registries'
import {
  commandOwner,
  PLUGIN_COMMAND_TIMEOUT_MS,
  runPluginCommand,
} from '@/renderer/lib/plugins/host/runPluginCommand'

function setup(run: () => unknown) {
  const commands = new CommandRegistry()
  commands.register('owner-plugin', { id: 'do', title: 'Do', run })
  const reportError = vi.fn()
  return { commands, reportError }
}

describe('runPluginCommand', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('成功したら true を返し、エラーを報告しない', async () => {
    const run = vi.fn()
    const deps = setup(run)
    await expect(runPluginCommand(deps, 'owner-plugin:do')).resolves.toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(deps.reportError).not.toHaveBeenCalled()
  })

  it('同期例外を所有 Plugin の command エラーとして報告する', async () => {
    const error = new Error('boom')
    const deps = setup(() => {
      throw error
    })
    await expect(runPluginCommand(deps, 'owner-plugin:do')).resolves.toBe(false)
    expect(deps.reportError).toHaveBeenCalledWith(
      'owner-plugin',
      'command',
      error
    )
  })

  it('reject を報告する', async () => {
    const error = new Error('rejected')
    const deps = setup(() => Promise.reject(error))
    await expect(runPluginCommand(deps, 'owner-plugin:do')).resolves.toBe(false)
    expect(deps.reportError).toHaveBeenCalledWith(
      'owner-plugin',
      'command',
      error
    )
  })

  it('10秒で完了しなければ timeout エラーとして報告する', async () => {
    vi.useFakeTimers()
    const deps = setup(() => new Promise(() => {}))
    const pending = runPluginCommand(deps, 'owner-plugin:do')

    await vi.advanceTimersByTimeAsync(PLUGIN_COMMAND_TIMEOUT_MS - 1)
    expect(deps.reportError).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toBe(false)
    const [pluginId, source, error] = deps.reportError.mock.calls[0]
    expect(pluginId).toBe('owner-plugin')
    expect(source).toBe('command')
    expect(error).toBeInstanceOf(PluginApiError)
    expect((error as PluginApiError).kind).toBe('timeout')
  })

  it('未登録のコマンドは ID の接頭辞の Plugin に報告する', async () => {
    const deps = setup(vi.fn())
    await expect(runPluginCommand(deps, 'other-plugin:missing')).resolves.toBe(
      false
    )
    const [pluginId, source, error] = deps.reportError.mock.calls[0]
    expect(pluginId).toBe('other-plugin')
    expect(source).toBe('command')
    expect((error as PluginApiError).kind).toBe('invalidArgument')
  })

  it('報告処理が例外を送出しても呼び出し元に送出しない', async () => {
    const deps = setup(() => {
      throw new Error('boom')
    })
    deps.reportError.mockImplementation(() => {
      throw new Error('report failed')
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(runPluginCommand(deps, 'owner-plugin:do')).resolves.toBe(false)
    spy.mockRestore()
  })

  it('commandOwner は実 ID の接頭辞を返す', () => {
    expect(commandOwner('a-plugin:cmd:sub')).toBe('a-plugin')
  })
})
