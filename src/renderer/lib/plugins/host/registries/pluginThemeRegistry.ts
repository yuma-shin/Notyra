/**
 * Theme_Plugin のカラーテーマ（Requirement 11.2〜11.4、11.6）。
 *
 * テーマ ID が組み込みテーマ・カスタムテーマ・先に登録された他の Plugin のテーマと
 * 重複する場合は登録を拒否する。Load_Order 順に読み込むため、Plugin 同士では
 * 先に読み込んだ Plugin のテーマが採用される。
 */
import type { Disposable } from '@/shared/plugin/api'
import {
  builtinThemes,
  type ColorTheme,
  loadCustomThemes,
  validateTheme,
} from '@/renderer/lib/themeManager'
import { RegistryStore } from '../registryStore'

export type ThemeRegisterResult =
  | { ok: true; disposable: Disposable }
  | { ok: false; reason: 'invalidTheme' }
  | { ok: false; reason: 'duplicateId'; themeId: string }

/** 組み込みテーマとカスタムテーマのテーマ ID */
export function defaultReservedThemeIds(): string[] {
  return [...builtinThemes, ...loadCustomThemes()].map(t => t.id)
}

export class PluginThemeRegistry {
  readonly store = new RegistryStore<ColorTheme>()

  private readonly getReservedThemeIds: () => Iterable<string>

  /**
   * @param getReservedThemeIds Plugin 以外のテーマ ID（組み込み・カスタム）。
   *   カスタムテーマは実行中に追加・削除されるため、登録のたびに呼び出す。
   */
  constructor(
    getReservedThemeIds: () => Iterable<string> = defaultReservedThemeIds
  ) {
    this.getReservedThemeIds = getReservedThemeIds
  }

  /** テーマを検証して登録する。不正なテーマと ID の重複は登録しない */
  register(pluginId: string, theme: unknown): ThemeRegisterResult {
    if (!validateTheme(theme)) return { ok: false, reason: 'invalidTheme' }
    const colorTheme = theme as ColorTheme
    if (this.isTaken(colorTheme.id)) {
      return { ok: false, reason: 'duplicateId', themeId: colorTheme.id }
    }
    return {
      ok: true,
      disposable: this.store.register(pluginId, colorTheme),
    }
  }

  /** 登録済みのテーマ（Load_Order 順）。変更がない限り同一参照を返す */
  getThemes = (): readonly ColorTheme[] => this.store.getItems()

  /** テーマ ID からテーマと提供元の Plugin_ID を探す */
  find(themeId: string): { pluginId: string; theme: ColorTheme } | undefined {
    const entry = this.store.getSnapshot().find(e => e.item.id === themeId)
    return entry ? { pluginId: entry.pluginId, theme: entry.item } : undefined
  }

  private isTaken(themeId: string): boolean {
    for (const id of this.getReservedThemeIds()) {
      if (id === themeId) return true
    }
    return this.store.getSnapshot().some(e => e.item.id === themeId)
  }
}
