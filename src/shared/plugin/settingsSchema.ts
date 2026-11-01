// Plugin_Settings の値の型検証と既定値解決（Requirement 17.2, 17.5, 17.9）

import type { SettingDeclaration, SettingValue } from './types'

export type SettingValidationErrorCode =
  | 'typeMismatch'
  | 'emptyNumber'
  | 'notFinite'
  | 'unknownOption'

export type SettingValidation =
  | { ok: true; value: SettingValue }
  | { ok: false; code: SettingValidationErrorCode }

/**
 * 入力値が宣言の型に合うかを検証する。
 *
 * - string: 任意の文字列
 * - number: 有限の数値、または前後空白を除いて空でなく `Number(raw)` が有限になる文字列（数値に変換して返す）
 * - boolean: `true` / `false`
 * - select: `options` の `value` のいずれか
 */
export function validateSettingValue(
  decl: SettingDeclaration,
  value: unknown
): SettingValidation {
  switch (decl.type) {
    case 'string':
      return typeof value === 'string'
        ? { ok: true, value }
        : { ok: false, code: 'typeMismatch' }
    case 'number':
      return validateNumber(value)
    case 'boolean':
      return typeof value === 'boolean'
        ? { ok: true, value }
        : { ok: false, code: 'typeMismatch' }
    case 'select':
      if (typeof value !== 'string') return { ok: false, code: 'typeMismatch' }
      return decl.options.some(option => option.value === value)
        ? { ok: true, value }
        : { ok: false, code: 'unknownOption' }
  }
}

function validateNumber(value: unknown): SettingValidation {
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { ok: true, value }
      : { ok: false, code: 'notFinite' }
  }
  if (typeof value === 'string') {
    if (value.trim() === '') return { ok: false, code: 'emptyNumber' }
    const parsed = Number(value)
    return Number.isFinite(parsed)
      ? { ok: true, value: parsed }
      : { ok: false, code: 'notFinite' }
  }
  return { ok: false, code: 'typeMismatch' }
}

/**
 * 永続化された値を宣言に照らして解決する。
 * 未保存（`undefined`）または宣言の型に合わない値は、宣言の既定値を返す。
 * 永続化済みの値は JSON プリミティブのため、number 型では文字列からの変換を行わない。
 */
export function resolveSettingValue(
  decl: SettingDeclaration,
  stored: unknown
): SettingValue {
  if (isStoredValueValid(decl, stored)) return stored
  return decl.default
}

function isStoredValueValid(
  decl: SettingDeclaration,
  stored: unknown
): stored is SettingValue {
  switch (decl.type) {
    case 'string':
      return typeof stored === 'string'
    case 'number':
      return typeof stored === 'number' && Number.isFinite(stored)
    case 'boolean':
      return typeof stored === 'boolean'
    case 'select':
      return (
        typeof stored === 'string' &&
        decl.options.some(option => option.value === stored)
      )
  }
}
