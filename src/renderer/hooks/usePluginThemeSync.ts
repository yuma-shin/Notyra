/**
 * Plugin のカラーテーマの選択肢と適用（Requirement 11.2〜11.6）。
 *
 * - Plugin_Host_Window（PluginHostProvider の内側）: PluginThemeRegistry を購読する
 * - 設定ウィンドウ（Provider の外側）: Plugin のコードを実行せず、テーマ JSON をデータとして
 *   読み込む SettingsWindowThemeStore を購読する
 *
 * PluginHostProvider から呼ぶため、このモジュールは PluginHostContext に依存しない
 * （Provider の値を使う `usePluginColorThemes` は `usePluginColorThemes.ts`）。
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useApp } from '../contexts/AppContext'
import type { Registries } from '../lib/plugins/host/registries'
import {
  type PluginThemeLoadError,
  type SettingsThemeApi,
  SettingsWindowThemeStore,
} from '../lib/plugins/settingsWindowThemes'
import { tauriApi as App } from '../lib/tauriApi'
import {
  applyColorTheme,
  type ColorTheme,
  registerPluginThemeSource,
} from '../lib/themeManager'

/** `tauriApi.plugins` を取得する。部分モックなどで必要な関数が無ければ null */
function getSettingsThemeApi(): SettingsThemeApi | null {
  const api = (App as { plugins?: Partial<SettingsThemeApi> } | undefined)
    ?.plugins
  if (
    !api ||
    typeof api.getState !== 'function' ||
    typeof api.readText !== 'function' ||
    typeof api.onStateChanged !== 'function'
  ) {
    return null
  }
  return api as SettingsThemeApi
}

async function getAppVersion(): Promise<string | null> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    const version: unknown = await getVersion()
    return typeof version === 'string' ? version : null
  } catch (error) {
    console.error('[notyra] failed to get the app version:', error)
    return null
  }
}

/** 設定ウィンドウで共有するストア（ウィンドウごとに1つ） */
const settingsWindowThemeStore = new SettingsWindowThemeStore({
  getApi: getSettingsThemeApi,
  getAppVersion,
})

const NO_ERRORS: readonly PluginThemeLoadError[] = Object.freeze([])
const noErrors = () => NO_ERRORS

interface PluginThemeSourceAdapter {
  subscribe(listener: () => void): () => void
  getThemes(): readonly ColorTheme[]
  getErrors(): readonly PluginThemeLoadError[]
}

function useThemeSourceAdapter(
  registries: Registries | null
): PluginThemeSourceAdapter {
  return useMemo<PluginThemeSourceAdapter>(
    () =>
      registries
        ? {
            subscribe: registries.themes.store.subscribe,
            getThemes: registries.themes.getThemes,
            getErrors: noErrors,
          }
        : {
            subscribe: settingsWindowThemeStore.subscribe,
            getThemes: settingsWindowThemeStore.getThemes,
            getErrors: settingsWindowThemeStore.getErrors,
          },
    [registries]
  )
}

export interface PluginColorThemes {
  /** Plugin のカラーテーマ（Load_Order 順） */
  readonly themes: readonly ColorTheme[]
  /**
   * 選択肢に追加しなかった Theme_Plugin（設定ウィンドウのみ。
   * Plugin_Host_Window では PluginHost が Toast と Plugins_Tab に報告する）
   */
  readonly errors: readonly PluginThemeLoadError[]
}

/**
 * 指定したレジストリ（null なら設定ウィンドウのストア）から Plugin のカラーテーマを購読する
 */
export function usePluginColorThemesFrom(
  registries: Registries | null
): PluginColorThemes & { adapter: PluginThemeSourceAdapter } {
  const adapter = useThemeSourceAdapter(registries)
  const themes = useSyncExternalStore(adapter.subscribe, adapter.getThemes)
  const errors = useSyncExternalStore(adapter.subscribe, adapter.getErrors)
  return { themes, errors, adapter }
}

/**
 * Plugin のカラーテーマをこのウィンドウの `applyColorTheme` に結線する。
 *
 * - `applyColorTheme`（AppContext が呼ぶ）の検索対象に Plugin のテーマを加える
 * - Plugin のテーマの登録・解除で、選択中のテーマに関係する場合は適用し直す
 *   （起動時に Plugin の読み込みが設定の読み込みより後になる場合も含む）
 * - Plugin_Host_Window では StyleRegistry の選択中テーマ ID を同期し、
 *   Theme_Plugin の追加CSSを選択中のテーマのものだけ有効にする（Requirement 11.5）
 *
 * @param registries Plugin_Host_Window のレジストリ。設定ウィンドウでは null
 */
export function usePluginThemeSync(registries: Registries | null): void {
  const { settings, isLoading } = useApp()
  const { themes, adapter } = usePluginColorThemesFrom(registries)
  const selectedThemeId = settings.colorTheme ?? 'gray'

  useEffect(() => registerPluginThemeSource(adapter.getThemes), [adapter])

  const selectedRef = useRef(selectedThemeId)
  selectedRef.current = selectedThemeId
  const isLoadingRef = useRef(isLoading)
  isLoadingRef.current = isLoading
  const previousThemesRef = useRef<readonly ColorTheme[]>([])

  // テーマの選択・ライト/ダークの変更は AppContext が適用する。
  // ここでは Plugin のテーマの増減によって選択中のテーマの解決結果が変わる場合だけ適用し直す
  useEffect(() => {
    const previous = previousThemesRef.current
    previousThemesRef.current = themes
    if (isLoadingRef.current) return
    const selected = selectedRef.current
    const affected =
      previous.some(t => t.id === selected) ||
      themes.some(t => t.id === selected)
    if (!affected) return
    applyColorTheme(
      selected,
      document.documentElement.classList.contains('dark')
    )
  }, [themes])

  const styles = registries?.styles ?? null
  useEffect(() => {
    if (!styles) return
    styles.setActiveThemeId(isLoading ? null : selectedThemeId)
  }, [styles, isLoading, selectedThemeId])
}
