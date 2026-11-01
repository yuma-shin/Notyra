/**
 * Plugin のキーバインド（Requirement 16.4、16.8〜16.10）。
 *
 * キーは登録時に `normalizeKey` で正規化し、`resolveKeybindings` の結果（有効な
 * キーバインドと重複）をスナップショットごとに1回だけ計算して保持する。
 * 組み込みのキーバインドが優先され、Plugin 同士では Load_Order が先の Plugin が優先される。
 */
import {
  type Disposable,
  type KeybindingDefinition,
  PluginApiError,
} from '@/shared/plugin/api'
import type { KeybindingConflict } from '@/shared/plugin/types'
import { getBuiltinKeybindings } from '../../builtinKeybindings'
import {
  type KeyPlatform,
  normalizeKey,
  type PluginKeybinding,
  resolveKeybindings,
} from '../../keybindings'
import { type RegistryEntry, RegistryStore } from '../registryStore'
import { resolveCommandId } from './ids'

export interface KeybindingResolution {
  /** 正規化済みキー → 採用されたキーバインド */
  readonly effective: ReadonlyMap<string, PluginKeybinding>
  readonly conflicts: readonly KeybindingConflict[]
}

export interface KeymapRegistryOptions {
  platform: KeyPlatform
  /** 正規化済みの組み込みキー。省略時は `getBuiltinKeybindings(platform)` */
  builtin?: ReadonlySet<string>
}

const EMPTY_RESOLUTION: KeybindingResolution = Object.freeze({
  effective: new Map<string, PluginKeybinding>(),
  conflicts: Object.freeze([]) as readonly KeybindingConflict[],
})

export class KeymapRegistry {
  readonly store = new RegistryStore<PluginKeybinding>()
  readonly platform: KeyPlatform

  private readonly builtin: ReadonlySet<string>
  private resolutionSource: readonly RegistryEntry<PluginKeybinding>[] | null =
    null
  private resolution: KeybindingResolution = EMPTY_RESOLUTION

  constructor(options: KeymapRegistryOptions) {
    this.platform = options.platform
    this.builtin = options.builtin ?? getBuiltinKeybindings(options.platform)
  }

  /**
   * キーバインドを登録する。キーを解析できない場合は `invalidArgument` を送出する。
   * `command` は実 ID に解決する（`:` を含まない ID は登録した Plugin のコマンド）。
   */
  register(pluginId: string, definition: KeybindingDefinition): Disposable {
    const key = normalizeKey(definition.key, this.platform)
    if (key === null) {
      throw new PluginApiError(
        'invalidArgument',
        `Invalid keybinding "${definition.key}"`
      )
    }
    const binding: PluginKeybinding = Object.freeze({
      pluginId,
      key,
      command: resolveCommandId(pluginId, definition.command),
    })
    return this.store.register(pluginId, binding)
  }

  /** 現在の登録に対する解決結果。登録が変わらない限り同一参照を返す */
  getResolution = (): KeybindingResolution => {
    const snapshot = this.store.getSnapshot()
    if (snapshot !== this.resolutionSource) {
      this.resolutionSource = snapshot
      this.resolution =
        snapshot.length === 0
          ? EMPTY_RESOLUTION
          : resolveKeybindings(
              this.builtin,
              snapshot.map(e => e.item)
            )
    }
    return this.resolution
  }

  /** 正規化済みキーに対して採用されたキーバインドを返す */
  lookup(normalizedKey: string): PluginKeybinding | undefined {
    return this.getResolution().effective.get(normalizedKey)
  }
}
