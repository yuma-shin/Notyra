// Side_Panel_View と Plugin_Command の ID の扱い（Requirement 13.2, 16.2）

/** Plugin_ID と Plugin 内の ID の区切り。Plugin_ID は `:` を含まない（npm 名規則） */
export const ID_SEPARATOR = ':'

/** Plugin 内の ID に Plugin_ID の接頭辞を付けた実 ID を返す */
export function qualifyId(pluginId: string, localId: string): string {
  return `${pluginId}${ID_SEPARATOR}${localId}`
}

/**
 * ツールバーボタン・キーバインドが指定した Plugin_Command の ID を実 ID に解決する。
 * `:` を含む ID は実 ID とみなし、そのまま返す。それ以外は呼び出し元の Plugin の
 * コマンドとみなし、接頭辞を付ける。
 */
export function resolveCommandId(pluginId: string, command: string): string {
  return command.includes(ID_SEPARATOR) ? command : qualifyId(pluginId, command)
}
