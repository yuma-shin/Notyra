import * as CMCommands from '@codemirror/commands'
import * as CMLanguage from '@codemirror/language'
import * as CMState from '@codemirror/state'
import * as CMView from '@codemirror/view'
import * as LezerHighlight from '@lezer/highlight'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as JsxRuntime from 'react/jsx-runtime'

/**
 * Plugin に本体と同一のインスタンスとして提供するモジュール（Requirement 15.6）。
 *
 * Plugin 側のビルドはこれらを external にし、`/@shared/<file>` の仮想モジュールに
 * 書き換える。仮想モジュールは `globalThis.__NOTYRA_SHARED__[<module>]` を参照する
 * （`src-tauri/src/plugins/protocol.rs` の `render_shared_module`）。
 */
export const SHARED_MODULES = {
  react: React,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  'react/jsx-runtime': JsxRuntime,
  '@codemirror/state': CMState,
  '@codemirror/view': CMView,
  '@codemirror/language': CMLanguage,
  '@codemirror/commands': CMCommands,
  '@lezer/highlight': LezerHighlight,
} as const

export type SharedModuleName = keyof typeof SHARED_MODULES

/** 仮想モジュールの配信パスの接頭辞（オリジン相対） */
export const SHARED_MODULE_PATH_PREFIX = '/@shared/'

/** 仮想モジュールが named export として公開しない名前 */
const EXCLUDED_EXPORT_NAMES: ReadonlySet<string> = new Set([
  'default',
  '__esModule',
])

const IDENTIFIER_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * ECMAScript の IdentifierName（ASCII の範囲）かどうか。予約語も export 名として
 * 使えるため拒否しない。Rust の `is_identifier_name` と同じ規則。
 */
export function isIdentifierName(name: string): boolean {
  return IDENTIFIER_NAME_PATTERN.test(name)
}

const MODULE_SEGMENT_PATTERN = /^[a-z0-9._-]+$/

/**
 * 共有モジュール名が npm のモジュール指定子として妥当か。
 * Rust の `is_valid_module_name` と同じ規則（`@scope/` 可、セグメントに `__` 不可）。
 */
export function isValidSharedModuleName(name: string): boolean {
  if (name.length === 0 || name.length > 214) return false
  const body = name.startsWith('@') ? name.slice(1) : name
  if (body.length === 0) return false
  return body
    .split('/')
    .every(
      seg =>
        seg !== '' &&
        seg !== '.' &&
        seg !== '..' &&
        !seg.includes('__') &&
        MODULE_SEGMENT_PATTERN.test(seg)
    )
}

/**
 * モジュールの export 名のうち、仮想モジュールの named export として公開できるもの
 * （IdentifierName であり `default` / `__esModule` でないもの）を昇順で返す。
 */
export function getExportNames(moduleObject: object): string[] {
  const names = Object.keys(moduleObject).filter(
    name => !EXCLUDED_EXPORT_NAMES.has(name) && isIdentifierName(name)
  )
  return [...new Set(names)].sort()
}

/**
 * モジュール指定子から仮想モジュールのファイル名を作る（`/` → `__`、末尾に `.js`）。
 * Rust の `shared_module_file_name` と同じ規則。
 * 例: `@codemirror/state` → `@codemirror__state.js`
 */
export function sharedModuleFileName(moduleName: string): string {
  return `${moduleName.replaceAll('/', '__')}.js`
}

/**
 * モジュール指定子から仮想モジュールのオリジン相対パスを作る。
 * 例: `react/jsx-runtime` → `/@shared/react__jsx-runtime.js`
 */
export function sharedModulePath(moduleName: string): string {
  return `${SHARED_MODULE_PATH_PREFIX}${sharedModuleFileName(moduleName)}`
}

/**
 * `plugin_register_shared_modules` に渡す、モジュール名 → export 名一覧の対応を作る。
 */
export function buildSharedModuleExports(
  modules: Readonly<Record<string, object>> = SHARED_MODULES
): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const [name, moduleObject] of Object.entries(modules)) {
    result[name] = getExportNames(moduleObject)
  }
  return result
}
