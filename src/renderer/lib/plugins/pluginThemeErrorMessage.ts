import type { TFunction } from 'i18next'
import type { PluginThemeLoadError } from './settingsWindowThemes'

/** 選択肢に追加しなかった Theme_Plugin のエラー文言（Requirement 11.3、11.4） */
export function formatPluginThemeError(
  t: TFunction,
  error: PluginThemeLoadError
): string {
  const detail =
    error.reason === 'duplicateId'
      ? t('plugins.errors.themeIdDuplicate', { id: error.themeId ?? '' })
      : error.reason === 'invalidTheme'
        ? t('plugins.errors.themeInvalid', { message: error.message ?? '' })
        : t('plugins.errors.io', { message: error.message ?? '' })
  // 表示名は Plugin 由来の文言なので翻訳しない（Requirement 1.10）
  return `${error.displayName}: ${detail}`
}
