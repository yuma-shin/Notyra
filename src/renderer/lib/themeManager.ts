import grayscaleTheme from '../themes/grayscale.json'
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

/** Apply a color theme's CSS variables to the document root */
export function applyColorTheme(themeId: string, isDark: boolean): void {
  const allThemes = [...builtinThemes, ...loadCustomThemes()]
  const theme = allThemes.find(t => t.id === themeId) ?? builtinThemes[0]
  const vars = isDark ? theme.dark : theme.light
  const root = document.documentElement
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value)
  }
}

/** Get theme display name based on locale */
export function getThemeName(theme: ColorTheme, lang: string): string {
  if (lang === 'ja') return theme.nameJa
  return theme.name
}
