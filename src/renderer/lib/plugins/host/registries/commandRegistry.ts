/**
 * Plugin_Command（Requirement 16.1、16.2、16.10）。
 * 実 ID は `${pluginId}:${id}`。実行（タイムアウトとエラー報告）は呼び出し側が行う。
 */
import {
  type CommandDefinition,
  type Disposable,
  PluginApiError,
} from '@/shared/plugin/api'
import { RegistryStore } from '../registryStore'
import { qualifyId } from './ids'

export interface PluginCommand {
  /** 実 ID（`${pluginId}:${localId}`） */
  readonly id: string
  readonly localId: string
  readonly pluginId: string
  readonly title: string
  readonly run: CommandDefinition['run']
}

export class CommandRegistry {
  readonly store = new RegistryStore<PluginCommand>()

  private indexSource: readonly PluginCommand[] | null = null
  private index = new Map<string, PluginCommand>()

  /**
   * コマンドを登録する。同じ実 ID のコマンドが登録済みなら `invalidArgument` を送出する。
   */
  register(pluginId: string, definition: CommandDefinition): Disposable {
    const id = qualifyId(pluginId, definition.id)
    if (this.get(id)) {
      throw new PluginApiError(
        'invalidArgument',
        `Command "${id}" is already registered`
      )
    }
    const command: PluginCommand = Object.freeze({
      id,
      localId: definition.id,
      pluginId,
      title: definition.title,
      run: definition.run,
    })
    return this.store.register(pluginId, command)
  }

  /** 登録済みのコマンド（Load_Order 順）。変更がない限り同一参照を返す */
  getCommands = (): readonly PluginCommand[] => this.store.getItems()

  /** 実 ID からコマンドを探す */
  get(id: string): PluginCommand | undefined {
    const items = this.store.getItems()
    if (items !== this.indexSource) {
      this.index = new Map(items.map(c => [c.id, c]))
      this.indexSource = items
    }
    return this.index.get(id)
  }
}
