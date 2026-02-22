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

/** Apply a color theme's CSS variables to the document root */
export function applyColorTheme(themeId: string, isDark: boolean): void {
  const theme = builtinThemes.find(t => t.id === themeId) ?? builtinThemes[0]
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
