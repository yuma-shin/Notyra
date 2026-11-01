import grayscaleTheme from '../themes/gray.json'
import purpleTheme from '../themes/purple.json'

export interface ColorTheme {
  id: string
  name: string
  nameJa: string
  description?: string
  descriptionJa?: string
  /** Preview swatch colors for light mode [accent, background, subtle] */
  swatches: string[]
  /** Preview swatch colors for dark mode */
  swatchesDark: string[]
  light: Record<string, string>
  dark: Record<string, string>
}

export const builtinThemes: ColorTheme[] = [grayscaleTheme, purpleTheme]

const CUSTOM_THEMES_KEY = 'notyra-custom-themes'

export function loadCustomThemes(): ColorTheme[] {
  try {
    const stored = localStorage.getItem(CUSTOM_THEMES_KEY)
    if (!stored) return []
    return JSON.parse(stored) as ColorTheme[]
  } catch {
    return []
  }
}

export function saveCustomThemes(themes: ColorTheme[]): void {
  localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes))
}

export function addCustomTheme(theme: ColorTheme): void {
  const existing = loadCustomThemes().filter(t => t.id !== theme.id)
  saveCustomThemes([...existing, theme])
}

export function removeCustomTheme(id: string): void {
  const themes = loadCustomThemes().filter(t => t.id !== id)
  saveCustomThemes(themes)
}

export function validateTheme(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    typeof d.id === 'string' &&
    d.id.length > 0 &&
    typeof d.name === 'string' &&
    d.name.length > 0 &&
    Array.isArray(d.swatches) &&
    d.swatches.length > 0 &&
    Array.isArray(d.swatchesDark) &&
    d.swatchesDark.length > 0 &&
    typeof d.light === 'object' &&
    d.light !== null &&
    typeof d.dark === 'object' &&
    d.dark !== null
  )
}

// ---------------------------------------------------------------------------
// Plugin のカラーテーマ（Requirement 11.2、11.6）
// ---------------------------------------------------------------------------

/** Plugin のカラーテーマ一覧を返す関数（Load_Order 順） */
export type PluginThemeSource = () => readonly ColorTheme[]

const pluginThemeSources = new Set<{ get: PluginThemeSource }>()

/**
 * Plugin のカラーテーマの取得元を登録する。戻り値の関数で登録を解除する（冪等）。
 *
 * Plugin_Host_Window では PluginThemeRegistry、設定ウィンドウではテーマ JSON を
 * データとして読み込んだ一覧を登録する。`applyColorTheme` と `listAllThemes` は
 * 呼び出しのたびに取得元を参照するため、Plugin の読み込み・停止が即座に反映される。
 */
export function registerPluginThemeSource(
  source: PluginThemeSource
): () => void {
  const entry = { get: source }
  pluginThemeSources.add(entry)
  return () => {
    pluginThemeSources.delete(entry)
  }
}

/** 登録済みの取得元から得た Plugin のカラーテーマ */
export function listPluginThemes(): ColorTheme[] {
  const themes: ColorTheme[] = []
  for (const source of pluginThemeSources) {
    try {
      themes.push(...source.get())
    } catch (error) {
      console.error('[notyra] failed to list plugin themes:', error)
    }
  }
  return themes
}

/** テーマ一覧を連結し、テーマ ID が重複するものは先に現れた方だけを残す */
export function mergeThemes(
  ...lists: ReadonlyArray<readonly ColorTheme[]>
): ColorTheme[] {
  const seen = new Set<string>()
  const merged: ColorTheme[] = []
  for (const list of lists) {
    for (const theme of list) {
      if (seen.has(theme.id)) continue
      seen.add(theme.id)
      merged.push(theme)
    }
  }
  return merged
}

/** 組み込み → カスタム → Plugin の順のすべてのカラーテーマ（テーマ ID は一意） */
export function listAllThemes(): ColorTheme[] {
  return mergeThemes(builtinThemes, loadCustomThemes(), listPluginThemes())
}

/** Apply a color theme's CSS variables to the document root */
export function applyColorTheme(themeId: string, isDark: boolean): void {
  const allThemes = listAllThemes()
  const theme = allThemes.find(t => t.id === themeId) ?? builtinThemes[0]
  const fallback = builtinThemes[0]
  const fallbackVars = isDark ? fallback.dark : fallback.light
  const vars = isDark ? theme.dark : theme.light
  const root = document.documentElement
  for (const [key, value] of Object.entries({ ...fallbackVars, ...vars })) {
    root.style.setProperty(key, value)
  }
}

/** Get theme display name based on locale */
export function getThemeName(theme: ColorTheme, lang: string): string {
  // Plugin のテーマは nameJa を省略できる（validateTheme は必須にしていない）
  if (lang === 'ja') return theme.nameJa || theme.name
  return theme.name
}
