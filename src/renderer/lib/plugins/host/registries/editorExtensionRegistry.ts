/**
 * Plugin の CodeMirror 6 Extension（Requirement 15.1〜15.4、15.7）。
 *
 * EditorView は Load_Order 順の Extension 配列を既存の extensions の末尾に連結する。
 * 不正な Extension で全エディタの再構成が失敗しないよう、登録時に
 * `EditorState.create` で単独で構成できるかを事前検証し、失敗したら登録しない。
 */
import { EditorState, type Extension } from '@codemirror/state'
import { type Disposable, PluginApiError } from '@/shared/plugin/api'
import { RegistryStore } from '../registryStore'

export class EditorExtensionRegistry {
  readonly store = new RegistryStore<Extension>()

  /**
   * Extension を検証して登録する。検証に失敗した場合は登録せず、
   * 原因を `details` に持つ `invalidArgument` を送出する。
   */
  register(pluginId: string, extension: Extension): Disposable {
    try {
      EditorState.create({ extensions: [extension] })
    } catch (error) {
      throw new PluginApiError(
        'invalidArgument',
        `Invalid editor extension: ${error instanceof Error ? error.message : String(error)}`,
        error
      )
    }
    return this.store.register(pluginId, extension)
  }

  /** 登録済みの Extension（Load_Order 順）。変更がない限り同一参照を返す */
  getExtensions = (): readonly Extension[] => this.store.getItems()
}
