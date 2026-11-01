import { usePluginRegistries } from '../contexts/PluginHostContext'
import {
  type PluginColorThemes,
  usePluginColorThemesFrom,
} from './usePluginThemeSync'

/**
 * テーマ選択肢に加える Plugin のカラーテーマ（Requirement 11.2、11.6）。
 * PluginHostProvider の内側では PluginThemeRegistry、外側（設定ウィンドウ）では
 * テーマ JSON をデータとして読み込んだ一覧を返す。
 */
export function usePluginColorThemes(): PluginColorThemes {
  const { themes, errors } = usePluginColorThemesFrom(usePluginRegistries())
  return { themes, errors }
}
