/**
 * Markdown ツールバーに追加する Plugin のボタン（Requirement 16.3、16.10）。
 * `command` は実 ID に解決して保持する（`:` を含まない ID は登録した Plugin のコマンド）。
 */
import type { Disposable, ToolbarButtonDefinition } from '@/shared/plugin/api'
import { RegistryStore } from '../registryStore'
import { resolveCommandId } from './ids'

export interface ToolbarButton {
  readonly pluginId: string
  /** 実行する Plugin_Command の実 ID */
  readonly command: string
  /** SVG 文字列 */
  readonly icon: string
  readonly tooltip: string
}

export class ToolbarRegistry {
  readonly store = new RegistryStore<ToolbarButton>()

  register(pluginId: string, definition: ToolbarButtonDefinition): Disposable {
    const button: ToolbarButton = Object.freeze({
      pluginId,
      command: resolveCommandId(pluginId, definition.command),
      icon: definition.icon,
      tooltip: definition.tooltip,
    })
    return this.store.register(pluginId, button)
  }

  /** 登録済みのボタン（Load_Order 順）。変更がない限り同一参照を返す */
  getButtons = (): readonly ToolbarButton[] => this.store.getItems()
}
