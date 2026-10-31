// Notyra 本体のキーバインド一覧（Plugin のキーバインドより優先する。Requirement 16.8）

import { defaultKeymap, historyKeymap } from '@codemirror/commands'
import { type KeyPlatform, normalizeKey } from './keybindings'

/** CodeMirror の `KeyBinding` のうちキーの決定に使う項目 */
interface KeySpec {
  key?: string
  mac?: string
  win?: string
  linux?: string
  /** 指定があれば `Shift-` 付きのキーにも割り当てられる */
  shift?: unknown
}

/**
 * `@codemirror/search` の `searchKeymap`（6.6.0）のキー。
 * `@codemirror/search` は `@uiw/react-codemirror` の basicSetup 経由の間接依存で
 * 直接 import できないため、キーだけを写している。
 */
const SEARCH_KEYMAP: readonly KeySpec[] = [
  { key: 'Mod-f' },
  { key: 'F3', shift: true },
  { key: 'Mod-g', shift: true },
  { key: 'Escape' },
  { key: 'Mod-Shift-l' },
  { key: 'Mod-Alt-g' },
  { key: 'Mod-d' },
]

/** アプリ独自のショートカット（`useNavigationHistory` の戻る・進む） */
const APP_SHORTCUTS: Readonly<Record<KeyPlatform, readonly string[]>> = {
  mac: ['Meta-[', 'Meta-]'],
  other: ['Alt-ArrowLeft', 'Alt-ArrowRight'],
}

const CODEMIRROR_KEYMAPS: readonly (readonly KeySpec[])[] = [
  defaultKeymap,
  historyKeymap,
  SEARCH_KEYMAP,
]

/**
 * CodeMirror の KeyBinding がそのプラットフォームで使うキーを返す。
 * `other` は Windows と Linux の両方を含める（どちらでも組み込みを優先するため）。
 */
function platformKeys(binding: KeySpec, platform: KeyPlatform): string[] {
  const candidates =
    platform === 'mac'
      ? [binding.mac ?? binding.key]
      : [binding.win ?? binding.key, binding.linux ?? binding.key]
  const keys: string[] = []
  for (const key of candidates) {
    if (!key) continue
    keys.push(key)
    // `shift` を持つ KeyBinding は `Shift-` 付きのキーにも割り当てられる
    if (binding.shift) keys.push(`Shift-${key}`)
  }
  return keys
}

function buildBuiltinKeybindings(platform: KeyPlatform): ReadonlySet<string> {
  const result = new Set<string>()
  const add = (key: string) => {
    const normalized = normalizeKey(key, platform)
    if (normalized !== null) result.add(normalized)
  }
  for (const keymap of CODEMIRROR_KEYMAPS) {
    for (const binding of keymap) {
      for (const key of platformKeys(binding, platform)) add(key)
    }
  }
  for (const key of APP_SHORTCUTS[platform]) add(key)
  return result
}

const cache = new Map<KeyPlatform, ReadonlySet<string>>()

/** 正規化済みの組み込みキーバインドの集合を返す */
export function getBuiltinKeybindings(
  platform: KeyPlatform
): ReadonlySet<string> {
  let keys = cache.get(platform)
  if (!keys) {
    keys = buildBuiltinKeybindings(platform)
    cache.set(platform, keys)
  }
  return keys
}
