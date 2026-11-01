/**
 * Side_Panel_View（Requirement 13.1、13.2、13.6、13.10）。
 * 実 ID は `${pluginId}:${id}`。Side_Panel は Load_Order 順のスナップショットをタブとして描画する。
 */
import {
  type Disposable,
  PluginApiError,
  type SidePanelViewDefinition,
} from '@/shared/plugin/api'
import { RegistryStore } from '../registryStore'
import { qualifyId } from './ids'

export interface SidePanelView {
  /** 実 ID（`${pluginId}:${localId}`） */
  readonly id: string
  readonly localId: string
  readonly pluginId: string
  readonly title: string
  /** SVG 文字列 */
  readonly icon: string
  readonly render: SidePanelViewDefinition['render']
}

export class SidePanelRegistry {
  readonly store = new RegistryStore<SidePanelView>()

  /**
   * ビューを登録する。同じ実 ID のビューが登録済みなら `invalidArgument` を送出する。
   */
  register(pluginId: string, definition: SidePanelViewDefinition): Disposable {
    const id = qualifyId(pluginId, definition.id)
    if (this.get(id)) {
      throw new PluginApiError(
        'invalidArgument',
        `Side panel view "${id}" is already registered`
      )
    }
    const view: SidePanelView = Object.freeze({
      id,
      localId: definition.id,
      pluginId,
      title: definition.title,
      icon: definition.icon,
      render: definition.render,
    })
    return this.store.register(pluginId, view)
  }

  /** 登録済みのビュー（Load_Order 順）。変更がない限り同一参照を返す */
  getViews = (): readonly SidePanelView[] => this.store.getItems()

  get(id: string): SidePanelView | undefined {
    return this.store.getItems().find(v => v.id === id)
  }
}
