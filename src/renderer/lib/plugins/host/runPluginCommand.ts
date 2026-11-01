/**
 * ツールバーボタンとキーバインドから Plugin_Command を実行する（Requirement 16.5〜16.7）。
 *
 * - 実行処理を `runWithTimeout(run, 10_000)` で包む
 * - 例外・reject・タイムアウトは、コマンドを所有する Plugin（実 ID の接頭辞）に
 *   source `command` として報告する（Toast と Plugins_Tab）
 * - 呼び出し元には例外を送出しない（Notyra 本体の動作を継続する）
 */
import { PluginApiError } from '@/shared/plugin/api'
import type { PluginErrorSource } from '@/shared/plugin/types'
import { runWithTimeout } from '../withTimeout'
import { ID_SEPARATOR } from './registries/ids'
import type { CommandRegistry } from './registries/commandRegistry'

/** Plugin_Command の実行処理の待機上限（Requirement 16.6） */
export const PLUGIN_COMMAND_TIMEOUT_MS = 10_000

export interface RunPluginCommandDeps {
  readonly commands: Pick<CommandRegistry, 'get'>
  reportError(pluginId: string, source: PluginErrorSource, error: unknown): void
  /** 既定は `PLUGIN_COMMAND_TIMEOUT_MS` */
  readonly timeoutMs?: number
}

/** 実 ID（`${pluginId}:${id}`）から所有 Plugin の Plugin_ID を取り出す */
export function commandOwner(commandId: string): string {
  const index = commandId.indexOf(ID_SEPARATOR)
  return index === -1 ? commandId : commandId.slice(0, index)
}

/**
 * 実 ID の Plugin_Command を実行する。成功したら true、失敗（未登録を含む）したら
 * エラーを報告して false を返す。
 */
export async function runPluginCommand(
  deps: RunPluginCommandDeps,
  commandId: string
): Promise<boolean> {
  const timeoutMs = deps.timeoutMs ?? PLUGIN_COMMAND_TIMEOUT_MS
  const report = (pluginId: string, error: unknown) => {
    try {
      deps.reportError(pluginId, 'command', error)
    } catch (reportError) {
      console.error(reportError)
    }
  }

  const command = deps.commands.get(commandId)
  if (!command) {
    report(
      commandOwner(commandId),
      new PluginApiError(
        'invalidArgument',
        `Command "${commandId}" is not registered`
      )
    )
    return false
  }

  const result = await runWithTimeout(() => command.run(), timeoutMs)
  if (result.ok) return true

  const error = result.timedOut
    ? new PluginApiError(
        'timeout',
        `Command "${commandId}" timed out after ${timeoutMs}ms`,
        result.error
      )
    : result.error
  report(command.pluginId, error)
  return false
}
