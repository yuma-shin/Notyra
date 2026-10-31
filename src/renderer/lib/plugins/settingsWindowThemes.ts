/**
 * 設定ウィンドウで Theme_Plugin のカラーテーマを選択肢に加える（Requirement 11.2〜11.4、11.6）。
 *
 * 設定ウィンドウでは Plugin のコードを実行しない（Requirement 8.2）ため、PluginHost を使わずに
 * `plugin_get_state` と `plugin_read_text` でテーマ JSON をデータとして読み込む。
 *
 * - 読み込み対象は Plugin_Host_Window と同じ `computeDesiredPlugins`（有効・互換・同意待ちでない・
 *   Developer_Plugin なら Developer_Mode が有効）の Theme_Plugin に限る
 * - 検証規則は PluginThemeRegistry と同じ（`validateTheme`、組み込み・カスタム・先の Plugin との
 *   テーマ ID 重複の拒否）。Load_Order 順に判定するため、Plugin 同士では先の Plugin が採用される
 * - `plugins:state-changed` で読み込み直し、無効化・アンインストールされた Plugin のテーマを外す
 */
import type { PluginStateView } from '@/shared/plugin/types'
import type { ColorTheme } from '../themeManager'
import {
  defaultReservedThemeIds,
  PluginThemeRegistry,
} from './host/registries/pluginThemeRegistry'
import { computeDesiredPlugins } from './reconcile'

export type PluginThemeLoadErrorReason =
  | 'readFailed'
  | 'invalidTheme'
  | 'duplicateId'

export interface PluginThemeLoadError {
  readonly pluginId: string
  readonly displayName: string
  readonly reason: PluginThemeLoadErrorReason
  /** reason が duplicateId のときの重複したテーマ ID */
  readonly themeId?: string
  /** reason が readFailed / invalidTheme のときの原因 */
  readonly message?: string
}

export interface PluginThemeLoadResult {
  readonly themes: readonly ColorTheme[]
  readonly errors: readonly PluginThemeLoadError[]
}

export interface LoadPluginThemesInput {
  state: PluginStateView
  appVersion: string
  readText(id: string, path: string): Promise<string>
  /** Plugin 以外のテーマ ID（組み込み・カスタム） */
  reservedThemeIds: Iterable<string>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 状態から読み込み対象の Theme_Plugin を選び、テーマ JSON を読み込んで検証する */
export async function loadPluginThemes(
  input: LoadPluginThemesInput
): Promise<PluginThemeLoadResult> {
  if (!Array.isArray(input.state?.plugins)) return { themes: [], errors: [] }

  const reserved = [...input.reservedThemeIds]
  const registry = new PluginThemeRegistry(() => reserved)
  const errors: PluginThemeLoadError[] = []

  const targets = computeDesiredPlugins(
    input.state,
    input.appVersion,
    'main'
  ).flatMap(d =>
    d.manifest.type === 'theme'
      ? [
          {
            id: d.id,
            displayName: d.manifest.displayName,
            path: d.manifest.theme,
          },
        ]
      : []
  )

  // 読み取りは並行に行い、検証は Load_Order 順に行う
  const reads = await Promise.all(
    targets.map(async target => {
      try {
        const text = await input.readText(target.id, target.path)
        return { target, ok: true as const, data: JSON.parse(text) as unknown }
      } catch (error) {
        return { target, ok: false as const, message: messageOf(error) }
      }
    })
  )

  for (const read of reads) {
    const { id, displayName } = read.target
    if (!read.ok) {
      errors.push({
        pluginId: id,
        displayName,
        reason: 'readFailed',
        message: read.message,
      })
      continue
    }
    const result = registry.register(id, read.data)
    if (!result.ok) {
      errors.push(
        result.reason === 'duplicateId'
          ? {
              pluginId: id,
              displayName,
              reason: 'duplicateId',
              themeId: result.themeId,
            }
          : {
              pluginId: id,
              displayName,
              reason: 'invalidTheme',
              message: 'The color theme definition is invalid',
            }
      )
    }
  }

  return { themes: [...registry.getThemes()], errors }
}

/** 設定ウィンドウのストアが使う tauriApi.plugins の一部 */
export interface SettingsThemeApi {
  getState(): Promise<PluginStateView>
  readText(id: string, path: string): Promise<string>
  onStateChanged(callback: (state: PluginStateView) => void): () => void
}

export interface SettingsWindowThemeStoreDeps {
  /** tauriApi.plugins。存在しない環境（部分モックなど）では null */
  getApi(): SettingsThemeApi | null
  /** アプリバージョン。取得できなければ null */
  getAppVersion(): Promise<string | null>
  getReservedThemeIds?(): Iterable<string>
}

const EMPTY_THEMES: readonly ColorTheme[] = Object.freeze([])
const EMPTY_ERRORS: readonly PluginThemeLoadError[] = Object.freeze([])

type Listener = () => void

/**
 * 設定ウィンドウの Plugin テーマの外部ストア（`useSyncExternalStore` 用）。
 * 最初の購読で読み込みと `plugins:state-changed` の購読を開始し、
 * 最後の購読解除で停止して空に戻す。読み込みが重なった場合は最後のものだけを反映する。
 */
export class SettingsWindowThemeStore {
  private readonly deps: SettingsWindowThemeStoreDeps
  private readonly listeners = new Set<Listener>()
  private themes: readonly ColorTheme[] = EMPTY_THEMES
  private errors: readonly PluginThemeLoadError[] = EMPTY_ERRORS
  private unlisten: (() => void) | null = null
  private loadToken = 0
  private appVersion: Promise<string | null> | null = null

  constructor(deps: SettingsWindowThemeStoreDeps) {
    this.deps = deps
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.start()
    return () => {
      if (!this.listeners.delete(listener)) return
      if (this.listeners.size === 0) this.stop()
    }
  }

  getThemes = (): readonly ColorTheme[] => this.themes

  getErrors = (): readonly PluginThemeLoadError[] => this.errors

  /** 読み込みを実行する（`state` 省略時は `getState()` で取得する）。完了を待てる */
  reload = async (state?: PluginStateView): Promise<void> => {
    const api = this.deps.getApi()
    if (!api) return
    const token = ++this.loadToken
    try {
      this.appVersion ??= this.deps.getAppVersion()
      const appVersion = await this.appVersion
      if (typeof appVersion !== 'string') return
      const current = state ?? (await api.getState())
      const result = await loadPluginThemes({
        state: current,
        appVersion,
        readText: (id, path) => api.readText(id, path),
        reservedThemeIds: (
          this.deps.getReservedThemeIds ?? defaultReservedThemeIds
        )(),
      })
      if (token !== this.loadToken) return
      this.set(result.themes, result.errors)
    } catch (error) {
      console.error('[notyra] failed to load plugin themes:', error)
    }
  }

  private start(): void {
    const api = this.deps.getApi()
    if (!api) return
    try {
      this.unlisten = api.onStateChanged(state => {
        void this.reload(state)
      })
    } catch (error) {
      console.error('[notyra] failed to subscribe plugin state:', error)
    }
    void this.reload()
  }

  private stop(): void {
    this.loadToken++
    try {
      this.unlisten?.()
    } catch (error) {
      console.error(error)
    }
    this.unlisten = null
    this.themes = EMPTY_THEMES
    this.errors = EMPTY_ERRORS
  }

  private set(
    themes: readonly ColorTheme[],
    errors: readonly PluginThemeLoadError[]
  ): void {
    const nextThemes = themes.length === 0 ? EMPTY_THEMES : themes
    const nextErrors = errors.length === 0 ? EMPTY_ERRORS : errors
    if (nextThemes === this.themes && nextErrors === this.errors) return
    this.themes = nextThemes
    this.errors = nextErrors
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        console.error(error)
      }
    }
  }
}
