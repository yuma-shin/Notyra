/**
 * Plugin_Settings の値のキャッシュと変更通知の購読（Requirement 17.7、17.8、17.11）。
 *
 * - 値は Plugin ごとに保持する。PluginHost が読み込み時に `plugin_get_settings` の結果を、
 *   `plugins:settings-changed` の受信時にその値を `setValues` で設定する
 * - 変更通知が届かなかった場合は、次に `setValues` されるまで前の値を返し続ける
 *   （定期的な再取得は行わない。Requirement 17.11）
 * - 値は永続化された生の値（`Record<string, unknown>`）。宣言に照らした解決は
 *   Plugin_API ファサードが `resolveSettingValue` で行う
 * - 購読は Plugin ごとの登録として RegistryStore に保持し、Plugin_Stop で解除される
 */
import type { Disposable } from '@/shared/plugin/api'
import { RegistryStore } from '../registryStore'

export type PluginSettingsListener = (
  values: Readonly<Record<string, unknown>>
) => void

export interface PluginSettingsStoreOptions {
  /** リスナーの例外の報告先 */
  onListenerError?(pluginId: string, error: unknown): void
}

const EMPTY_VALUES: Readonly<Record<string, unknown>> = Object.freeze({})

export class PluginSettingsStore {
  readonly store = new RegistryStore<PluginSettingsListener>()

  private readonly values = new Map<string, Readonly<Record<string, unknown>>>()
  private readonly onListenerError?: (pluginId: string, error: unknown) => void

  constructor(options: PluginSettingsStoreOptions = {}) {
    this.onListenerError = options.onListenerError
  }

  /** 保持している値（未設定なら空のオブジェクト） */
  getValues(pluginId: string): Readonly<Record<string, unknown>> {
    return this.values.get(pluginId) ?? EMPTY_VALUES
  }

  /**
   * 値を置き換え、その Plugin の購読者に通知する。
   * 通知はリスナーごとに例外を捕捉し、他のリスナーへの配信を続ける。
   */
  setValues(pluginId: string, values: Record<string, unknown>): void {
    const next = Object.freeze({ ...values })
    this.values.set(pluginId, next)
    for (const { item: listener } of this.store.getByPlugin(pluginId)) {
      try {
        listener(next)
      } catch (error) {
        this.report(pluginId, error)
      }
    }
  }

  /** 保持している値を破棄する（アンインストール後など） */
  clear(pluginId: string): void {
    this.values.delete(pluginId)
  }

  subscribe(pluginId: string, listener: PluginSettingsListener): Disposable {
    return this.store.register(pluginId, listener)
  }

  private report(pluginId: string, error: unknown): void {
    try {
      if (this.onListenerError) this.onListenerError(pluginId, error)
      else console.error(error)
    } catch (reportError) {
      console.error(reportError)
    }
  }
}
