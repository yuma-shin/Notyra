/**
 * Plugin_Host_Window ごとの拡張レジストリ一式（design.md「12. PluginSession とレジストリ」）。
 * PluginHost と Plugin_API ファサードには `createRegistries()` の戻り値を1つのオブジェクトとして渡す。
 */
import type { KeyPlatform } from '../../keybindings'
import { ActiveEditorRegistry } from './activeEditorRegistry'
import { ActiveNoteBus } from './activeNoteBus'
import { CommandRegistry } from './commandRegistry'
import { EditorExtensionRegistry } from './editorExtensionRegistry'
import { KeymapRegistry } from './keymapRegistry'
import { MarkdownExtensionRegistry } from './markdownExtensionRegistry'
import { PluginSettingsStore } from './pluginSettingsStore'
import {
  defaultReservedThemeIds,
  PluginThemeRegistry,
} from './pluginThemeRegistry'
import { SidePanelRegistry } from './sidePanelRegistry'
import { StyleRegistry } from './styleRegistry'
import { ToolbarRegistry } from './toolbarRegistry'

export { ActiveEditorRegistry } from './activeEditorRegistry'
export { ActiveNoteBus, type ActiveNoteListener } from './activeNoteBus'
export { CommandRegistry, type PluginCommand } from './commandRegistry'
export { EditorExtensionRegistry } from './editorExtensionRegistry'
export { qualifyId, resolveCommandId } from './ids'
export { type KeybindingResolution, KeymapRegistry } from './keymapRegistry'
export {
  type ActiveMarkdownPlugin,
  MarkdownExtensionRegistry,
  type MarkdownExtensionSnapshot,
  type MarkdownPluginKind,
} from './markdownExtensionRegistry'
export {
  type PluginSettingsListener,
  PluginSettingsStore,
} from './pluginSettingsStore'
export {
  defaultReservedThemeIds,
  PluginThemeRegistry,
  type ThemeRegisterResult,
} from './pluginThemeRegistry'
export { type SidePanelView, SidePanelRegistry } from './sidePanelRegistry'
export {
  PLUGIN_STYLE_ATTRIBUTE,
  type StyleItem,
  type StyleOptions,
  StyleRegistry,
} from './styleRegistry'
export { type ToolbarButton, ToolbarRegistry } from './toolbarRegistry'

export interface Registries {
  readonly styles: StyleRegistry
  readonly themes: PluginThemeRegistry
  readonly sidePanel: SidePanelRegistry
  readonly markdown: MarkdownExtensionRegistry
  readonly editorExtensions: EditorExtensionRegistry
  readonly commands: CommandRegistry
  readonly toolbar: ToolbarRegistry
  readonly keymaps: KeymapRegistry
  readonly activeNote: ActiveNoteBus
  readonly activeEditor: ActiveEditorRegistry
  /** Plugin_Settings の値のキャッシュと変更通知の購読 */
  readonly settings: PluginSettingsStore
  /** Plugin ごとの登録を持つすべてのレジストリに Load_Order を設定する */
  setLoadOrder(pluginIds: readonly string[]): void
}

export interface CreateRegistriesOptions {
  platform: KeyPlatform
  /** StyleRegistry が `<style>` を挿入する文書。既定は `globalThis.document` */
  document?: Document
  /** 組み込みキー（正規化済み）。既定は `getBuiltinKeybindings(platform)` */
  builtinKeybindings?: ReadonlySet<string>
  /** Plugin 以外のテーマ ID。既定は組み込みテーマとカスタムテーマ */
  getReservedThemeIds?: () => Iterable<string>
  /** Active_Note_Event のリスナーの例外の報告先 */
  onActiveNoteListenerError?(pluginId: string, error: unknown): void
  /** Plugin_Settings の変更通知のリスナーの例外の報告先 */
  onSettingsListenerError?(pluginId: string, error: unknown): void
}

export function createRegistries(options: CreateRegistriesOptions): Registries {
  const styles = new StyleRegistry(options.document ?? globalThis.document)
  const themes = new PluginThemeRegistry(
    options.getReservedThemeIds ?? defaultReservedThemeIds
  )
  const sidePanel = new SidePanelRegistry()
  const markdown = new MarkdownExtensionRegistry()
  const editorExtensions = new EditorExtensionRegistry()
  const commands = new CommandRegistry()
  const toolbar = new ToolbarRegistry()
  const keymaps = new KeymapRegistry({
    platform: options.platform,
    builtin: options.builtinKeybindings,
  })
  const activeNote = new ActiveNoteBus({
    onListenerError: options.onActiveNoteListenerError,
  })
  const activeEditor = new ActiveEditorRegistry()
  const settings = new PluginSettingsStore({
    onListenerError: options.onSettingsListenerError,
  })

  const stores = [
    styles.store,
    themes.store,
    sidePanel.store,
    editorExtensions.store,
    commands.store,
    toolbar.store,
    keymaps.store,
    activeNote.store,
    settings.store,
  ]

  return {
    styles,
    themes,
    sidePanel,
    markdown,
    editorExtensions,
    commands,
    toolbar,
    keymaps,
    activeNote,
    activeEditor,
    settings,
    setLoadOrder(pluginIds) {
      for (const store of stores) store.setLoadOrder(pluginIds)
      markdown.setLoadOrder(pluginIds)
    },
  }
}
