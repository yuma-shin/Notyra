// Plugin キーバインドの正規化と優先順位解決（Requirement 16.4, 16.8, 16.9）

import type { KeybindingConflict } from '@/shared/plugin/types'

export type KeyPlatform = 'mac' | 'other'

export interface PluginKeybinding {
  pluginId: string
  /** `normalizeKey` で正規化済みのキー */
  key: string
  /** 実 ID（`${pluginId}:${id}`）の Plugin_Command */
  command: string
}

type Modifier = 'Alt' | 'Ctrl' | 'Meta' | 'Shift'

const MODIFIER_ORDER: readonly Modifier[] = ['Alt', 'Ctrl', 'Meta', 'Shift']

function toModifier(name: string, platform: KeyPlatform): Modifier | null {
  if (/^(alt|a)$/i.test(name)) return 'Alt'
  if (/^(ctrl|control|c)$/i.test(name)) return 'Ctrl'
  if (/^(cmd|meta|m)$/i.test(name)) return 'Meta'
  if (/^(shift|s)$/i.test(name)) return 'Shift'
  if (/^mod$/i.test(name)) return platform === 'mac' ? 'Meta' : 'Ctrl'
  return null
}

function normalizeStroke(stroke: string, platform: KeyPlatform): string | null {
  // CodeMirror と同じく、末尾の `-` はキー名として扱う（例: `Ctrl--`）
  const parts = stroke.split(/-(?!$)/)
  const rawKey = parts[parts.length - 1]
  if (!rawKey) return null

  const modifiers = new Set<Modifier>()
  for (const part of parts.slice(0, -1)) {
    const modifier = toModifier(part, platform)
    if (!modifier) return null
    modifiers.add(modifier)
  }

  const key = rawKey === ' ' ? 'space' : rawKey.toLowerCase()
  const ordered = MODIFIER_ORDER.filter(m => modifiers.has(m))
  return [...ordered, key].join('-')
}

/**
 * CodeMirror 記法（`Mod-Shift-k`）のキーを正規化する。
 * `Mod` は macOS で `Meta`、それ以外で `Ctrl` に展開し、修飾キーを
 * `Alt`/`Ctrl`/`Meta`/`Shift` の順に並べ、キーを小文字化する。
 * 空白区切りの複数ストロークはストロークごとに正規化する。
 * 解析できない場合は null を返す。
 */
export function normalizeKey(
  key: string,
  platform: KeyPlatform
): string | null {
  if (key.length === 0) return null
  // CodeMirror と同じく、末尾の空白はキー名（Space）として扱う
  const strokes = key.split(/ (?!$)/)
  const normalized: string[] = []
  for (const stroke of strokes) {
    const result = normalizeStroke(stroke, platform)
    if (result === null) return null
    normalized.push(result)
  }
  return normalized.join(' ')
}

/**
 * Plugin キーバインドの有効なものと重複を求める。
 * `builtin` と `bindings[].key` は正規化済みのキーとする。
 * `bindings` は Load_Order 順（Plugin 内は登録順）。
 * 組み込みのキーと重複するものは採用せず、Plugin 同士では先のものを採用する。
 */
export function resolveKeybindings(
  builtin: ReadonlySet<string>,
  bindings: readonly PluginKeybinding[]
): {
  effective: Map<string, PluginKeybinding>
  conflicts: KeybindingConflict[]
} {
  const effective = new Map<string, PluginKeybinding>()
  const conflicts: KeybindingConflict[] = []

  for (const binding of bindings) {
    const { pluginId, key, command } = binding
    if (builtin.has(key)) {
      conflicts.push({ pluginId, key, command, with: 'builtin' })
      continue
    }
    const winner = effective.get(key)
    if (winner) {
      conflicts.push({
        pluginId,
        key,
        command,
        with: { pluginId: winner.pluginId },
      })
      continue
    }
    effective.set(key, binding)
  }

  return { effective, conflicts }
}

/** `keyEventToKeys` が参照する KeyboardEvent の項目 */
export interface KeyEventLike {
  key: string
  code?: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/** 修飾キー自体の押下や、キーを特定できない入力の `key` */
const NON_STROKE_KEYS = new Set([
  'Alt',
  'AltGraph',
  'Control',
  'Meta',
  'Shift',
  'OS',
  'Hyper',
  'Super',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Fn',
  'FnLock',
  'Dead',
  'Process',
  'Unidentified',
])

/** 記号キーの `code` と、修飾キーなしで入力される文字（US 配列） */
const CODE_BASE_KEYS: Readonly<Record<string, string>> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
}

/** `code`（物理キー）から修飾キーなしのキー名を求める。求められなければ null */
function baseKeyFromCode(code: string | undefined): string | null {
  if (!code) return null
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1].toLowerCase()
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return digit[1]
  return CODE_BASE_KEYS[code] ?? null
}

function toStroke(event: KeyEventLike, key: string): string {
  const modifiers: Modifier[] = []
  if (event.altKey) modifiers.push('Alt')
  if (event.ctrlKey) modifiers.push('Ctrl')
  if (event.metaKey) modifiers.push('Meta')
  if (event.shiftKey) modifiers.push('Shift')
  const name = key === ' ' ? 'space' : key.toLowerCase()
  return [...modifiers, name].join('-')
}

/**
 * KeyboardEvent を `normalizeKey` と同じ形式の1ストロークのキーに変換する。
 * 照合の候補を優先順に返す（修飾キーだけの押下などは空配列）。
 *
 * 1. `event.key` によるキー（例: Ctrl+Shift+K → `Ctrl-Shift-k`）
 * 2. 修飾キーで入力文字が変わった場合（Shift+1 → `!`、macOS の Option+K → `˚`）は、
 *    物理キー（`event.code`）の修飾キーなしの文字によるキー（`Shift-1`、`Alt-k`）
 */
export function keyEventToKeys(event: KeyEventLike): string[] {
  const { key } = event
  if (!key || NON_STROKE_KEYS.has(key)) return []

  const keys = [toStroke(event, key)]
  const hasModifier =
    event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
  if (hasModifier) {
    const base = baseKeyFromCode(event.code)
    if (base !== null && base !== key.toLowerCase()) {
      const fallback = toStroke(event, base)
      if (!keys.includes(fallback)) keys.push(fallback)
    }
  }
  return keys
}
