// Manifest_Parser / Manifest_Printer（Requirement 2）
//
// Plugin の package.json を検証済みの PluginManifest に変換し、
// PluginManifest を package.json 形式の JSON に書き出す。

import semver from 'semver'

import {
  PERMISSIONS,
  type FeatureManifest,
  type ManifestError,
  type ParseResult,
  type Permission,
  type PermissionDeclaration,
  type PluginAuthor,
  type PluginManifest,
  type SelectOption,
  type SettingDeclaration,
  type StructuralErrorCode,
  type ThemeManifest,
  type ValueErrorCode,
} from './types'

// ---------------------------------------------------------------------------
// Declared_Destination の書式（Requirement 2.10）
// ---------------------------------------------------------------------------

const PORT =
  '(?:6553[0-5]|655[0-2]\\d|65[0-4]\\d{2}|6[0-4]\\d{3}|[1-5]\\d{4}|[1-9]\\d{0,3})'
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?'
// 最後のラベルは英字を1文字以上含む（数字のみのホスト名と IPv4 を区別するため）
const LAST_LABEL = `(?=[A-Za-z0-9-]*[A-Za-z])${LABEL}`
const HOSTNAME = `(?:${LABEL}\\.)*${LAST_LABEL}`
const WILDCARD = `\\*\\.${HOSTNAME}`
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4 = `${OCTET}(?:\\.${OCTET}){3}`
const H16 = '[0-9A-Fa-f]{1,4}'
const LS32 = `(?:${H16}:${H16}|${IPV4})`
const IPV6 = [
  `(?:${H16}:){6}${LS32}`,
  `::(?:${H16}:){5}${LS32}`,
  `(?:${H16})?::(?:${H16}:){4}${LS32}`,
  `(?:(?:${H16}:){0,1}${H16})?::(?:${H16}:){3}${LS32}`,
  `(?:(?:${H16}:){0,2}${H16})?::(?:${H16}:){2}${LS32}`,
  `(?:(?:${H16}:){0,3}${H16})?::${H16}:${LS32}`,
  `(?:(?:${H16}:){0,4}${H16})?::${LS32}`,
  `(?:(?:${H16}:){0,5}${H16})?::${H16}`,
  `(?:(?:${H16}:){0,6}${H16})?::`,
]
  .map(alt => `(?:${alt})`)
  .join('|')

/**
 * Declared_Destination の書式。ホスト名（先頭 `*.` のワイルドカード可）、
 * IPv4、角括弧付き IPv6 と、任意のポート（1〜65535）。
 * 分類・照合は Rust 側（destination.rs）で行う。
 */
export const DECLARED_DESTINATION_PATTERN: RegExp = new RegExp(
  `^(?:${WILDCARD}|${IPV4}|${HOSTNAME}|\\[(?:${IPV6})\\])(?::${PORT})?$`
)

// ---------------------------------------------------------------------------
// 項目値の規則
// ---------------------------------------------------------------------------

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
const RESERVED_IDS: ReadonlySet<string> = new Set([
  'node_modules',
  'favicon.ico',
])
const MAX_ID_LENGTH = 214

/** Requirement 2.3: npm のパッケージ名規則を満たし、スコープを含まない */
export function isValidPluginId(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= MAX_ID_LENGTH &&
    PLUGIN_ID_PATTERN.test(name) &&
    !RESERVED_IDS.has(name)
  )
}

/** Requirement 2.4: semver 形式（`v` 接頭辞と前後の空白は不可） */
export function isValidPluginVersion(version: string): boolean {
  return (
    /^\d/.test(version) &&
    version === version.trim() &&
    semver.valid(version) !== null
  )
}

/** Requirement 2.5: node-semver の範囲構文として解析できる */
export function isValidVersionRange(range: string): boolean {
  return semver.validRange(range, { includePrerelease: true }) !== null
}

/** Requirement 2.10 */
export function isValidDeclaredDestination(dest: string): boolean {
  return DECLARED_DESTINATION_PATTERN.test(dest)
}

/** 相対パスで、`..` セグメント・絶対パス・`\`・`:` を含まない */
function isSafeRelativePath(path: string, extensions: readonly string[]) {
  if (path === '' || path.startsWith('/')) return false
  if (path.includes('\\') || path.includes(':')) return false
  const segments = path.split('/')
  if (segments.some(s => s === '..' || s === '')) return false
  const lower = path.toLowerCase()
  return extensions.some(ext => lower.endsWith(ext))
}

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS)

// ---------------------------------------------------------------------------
// 解析ユーティリティ
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getOwn(obj: JsonObject, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined
}

class ErrorCollector {
  readonly errors: ManifestError[] = []

  structural(field: string, value: unknown, code: StructuralErrorCode) {
    this.errors.push({ category: 'structural', field, value, code })
  }

  value(field: string, value: unknown, code: ValueErrorCode) {
    this.errors.push({ category: 'value', field, value, code })
  }

  /** 必須の文字列項目。欠落は missingField、型不一致は typeMismatch */
  requiredString(obj: JsonObject, key: string, field: string) {
    const value = getOwn(obj, key)
    if (value === undefined) {
      this.structural(field, value, 'missingField')
      return undefined
    }
    if (typeof value !== 'string') {
      this.structural(field, value, 'typeMismatch')
      return undefined
    }
    return value
  }

  /** 任意の文字列項目。型不一致は typeMismatch */
  optionalString(obj: JsonObject, key: string, field: string) {
    const value = getOwn(obj, key)
    if (value === undefined) return { ok: true as const, value: undefined }
    if (typeof value !== 'string') {
      this.structural(field, value, 'typeMismatch')
      return { ok: false as const }
    }
    return { ok: true as const, value }
  }
}

// ---------------------------------------------------------------------------
// parseManifest
// ---------------------------------------------------------------------------

/**
 * Plugin の package.json を検証してマニフェストオブジェクトに変換する。
 * すべての項目を検査し、エラーが1件以上あればすべてのエラーを返す。
 */
export function parseManifest(json: string): ParseResult<PluginManifest> {
  const c = new ErrorCollector()

  let root: unknown
  try {
    root = JSON.parse(json)
  } catch {
    c.structural('package.json', json, 'invalidJson')
    return { ok: false, errors: c.errors }
  }
  if (!isObject(root)) {
    c.structural('package.json', root, 'invalidJson')
    return { ok: false, errors: c.errors }
  }

  // --- package.json の標準フィールド ---
  const id = c.requiredString(root, 'name', 'name')
  if (id !== undefined && !isValidPluginId(id)) {
    c.value('name', id, 'invalidId')
  }

  const version = c.requiredString(root, 'version', 'version')
  if (version !== undefined && !isValidPluginVersion(version)) {
    c.value('version', version, 'invalidVersion')
  }

  const description = c.optionalString(root, 'description', 'description')
  const author = parseAuthor(c, getOwn(root, 'author'))

  // --- notyra フィールド ---
  const notyra = getOwn(root, 'notyra')
  if (notyra === undefined) {
    c.structural('notyra', notyra, 'missingNotyra')
    return { ok: false, errors: c.errors }
  }
  if (!isObject(notyra)) {
    c.structural('notyra', notyra, 'typeMismatch')
    return { ok: false, errors: c.errors }
  }

  const displayName = c.requiredString(
    notyra,
    'displayName',
    'notyra.displayName'
  )
  if (displayName === '') {
    c.structural('notyra.displayName', displayName, 'missingField')
  }

  const notyraVersion = c.requiredString(
    notyra,
    'notyraVersion',
    'notyra.notyraVersion'
  )
  if (notyraVersion !== undefined && !isValidVersionRange(notyraVersion)) {
    c.value('notyra.notyraVersion', notyraVersion, 'invalidRange')
  }

  const type = c.requiredString(notyra, 'type', 'notyra.type')
  let specific:
    | Omit<FeatureManifest, keyof BaseFields>
    | Omit<ThemeManifest, keyof BaseFields>
    | undefined
  if (type === 'feature') {
    specific = parseFeatureFields(c, notyra)
  } else if (type === 'theme') {
    specific = parseThemeFields(c, notyra)
  } else if (type !== undefined) {
    c.value('notyra.type', type, 'unknownType')
  }

  if (
    c.errors.length > 0 ||
    id === undefined ||
    version === undefined ||
    displayName === undefined ||
    notyraVersion === undefined ||
    specific === undefined ||
    !description.ok ||
    !author.ok
  ) {
    return { ok: false, errors: c.errors }
  }

  const base: BaseFields = {
    id,
    version,
    ...(description.value !== undefined && { description: description.value }),
    ...(author.value !== undefined && { author: author.value }),
    displayName,
    notyraVersion,
  }
  return { ok: true, value: { ...base, ...specific } as PluginManifest }
}

type BaseFields = Pick<
  FeatureManifest,
  'id' | 'version' | 'description' | 'author' | 'displayName' | 'notyraVersion'
>

function parseAuthor(
  c: ErrorCollector,
  value: unknown
): { ok: true; value: PluginAuthor | undefined } | { ok: false } {
  if (value === undefined) return { ok: true, value: undefined }
  if (typeof value === 'string') return { ok: true, value }
  if (!isObject(value)) {
    c.structural('author', value, 'typeMismatch')
    return { ok: false }
  }
  const name = getOwn(value, 'name')
  const email = c.optionalString(value, 'email', 'author.email')
  const url = c.optionalString(value, 'url', 'author.url')
  if (typeof name !== 'string') {
    c.structural(
      'author.name',
      name,
      name === undefined ? 'missingField' : 'typeMismatch'
    )
    return { ok: false }
  }
  if (!email.ok || !url.ok) return { ok: false }
  return {
    ok: true,
    value: {
      name,
      ...(email.value !== undefined && { email: email.value }),
      ...(url.value !== undefined && { url: url.value }),
    },
  }
}

function parseFeatureFields(
  c: ErrorCollector,
  notyra: JsonObject
): Omit<FeatureManifest, keyof BaseFields> | undefined {
  const start = c.errors.length

  const main = c.requiredString(notyra, 'main', 'notyra.main')
  if (main !== undefined && !isSafeRelativePath(main, ['.js', '.mjs'])) {
    c.value('notyra.main', main, 'invalidPath')
  }

  const permissions = parsePermissions(c, notyra)
  const networkDestinations = parseDestinations(c, notyra)

  if (
    permissions?.some(p => p.name === 'network') &&
    (networkDestinations === undefined || networkDestinations.length === 0)
  ) {
    // 宛先の型不一致を既に報告している場合は重ねて報告しない
    const raw = getOwn(notyra, 'networkDestinations')
    if (raw === undefined || (Array.isArray(raw) && raw.length === 0)) {
      c.value('notyra.networkDestinations', raw, 'networkWithoutDestinations')
    }
  }

  const settings = parseSettings(c, notyra)

  if (
    c.errors.length > start ||
    main === undefined ||
    permissions === undefined
  ) {
    return undefined
  }
  return {
    type: 'feature',
    main,
    permissions,
    ...(networkDestinations !== undefined && { networkDestinations }),
    ...(settings !== undefined && { settings }),
  }
}

function parseThemeFields(
  c: ErrorCollector,
  notyra: JsonObject
): Omit<ThemeManifest, keyof BaseFields> | undefined {
  const start = c.errors.length

  const theme = c.requiredString(notyra, 'theme', 'notyra.theme')
  if (theme !== undefined && !isSafeRelativePath(theme, ['.json'])) {
    c.value('notyra.theme', theme, 'invalidPath')
  }

  const themeCss = c.optionalString(notyra, 'themeCss', 'notyra.themeCss')
  if (
    themeCss.ok &&
    themeCss.value !== undefined &&
    !isSafeRelativePath(themeCss.value, ['.css'])
  ) {
    c.value('notyra.themeCss', themeCss.value, 'invalidPath')
  }

  // Requirement 2.17: Theme_Plugin はエントリモジュールと Permission を持たない
  for (const key of ['main', 'permissions'] as const) {
    const value = getOwn(notyra, key)
    if (value !== undefined) {
      c.value(`notyra.${key}`, value, 'forbiddenForTheme')
    }
  }

  if (c.errors.length > start || theme === undefined || !themeCss.ok) {
    return undefined
  }
  return {
    type: 'theme',
    theme,
    ...(themeCss.value !== undefined && { themeCss: themeCss.value }),
  }
}

function parsePermissions(
  c: ErrorCollector,
  notyra: JsonObject
): PermissionDeclaration[] | undefined {
  const raw = getOwn(notyra, 'permissions')
  if (raw === undefined) {
    c.structural('notyra.permissions', raw, 'missingField')
    return undefined
  }
  if (!Array.isArray(raw)) {
    c.structural('notyra.permissions', raw, 'typeMismatch')
    return undefined
  }

  // 一部の要素が不正でも、正しく宣言された Permission は返す
  // （`network` と宛先の整合性検査を続けるため。エラーの有無は呼び出し側で判定）
  const result: PermissionDeclaration[] = []
  const seen = new Set<string>()
  raw.forEach((item, i) => {
    const field = `notyra.permissions[${i}]`
    if (!isObject(item)) {
      c.structural(field, item, 'typeMismatch')
      return
    }
    const name = c.requiredString(item, 'name', `${field}.name`)
    const purpose = c.optionalString(item, 'purpose', `${field}.purpose`)
    if (name === undefined) return
    if (!PERMISSION_SET.has(name)) {
      c.value(`${field}.name`, name, 'unknownPermission')
      return
    }
    if (seen.has(name)) {
      c.value(`${field}.name`, name, 'duplicatePermission')
      return
    }
    seen.add(name)
    if (!purpose.ok) return
    result.push({
      name: name as Permission,
      ...(purpose.value !== undefined && { purpose: purpose.value }),
    })
  })
  return result
}

function parseDestinations(
  c: ErrorCollector,
  notyra: JsonObject
): string[] | undefined {
  const raw = getOwn(notyra, 'networkDestinations')
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    c.structural('notyra.networkDestinations', raw, 'typeMismatch')
    return undefined
  }
  const result: string[] = []
  raw.forEach((item, i) => {
    const field = `notyra.networkDestinations[${i}]`
    if (typeof item !== 'string') {
      c.structural(field, item, 'typeMismatch')
      return
    }
    if (!isValidDeclaredDestination(item)) {
      c.value(field, item, 'invalidDestination')
      return
    }
    result.push(item)
  })
  return result
}

const SETTING_TYPES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'boolean',
  'select',
])

function parseSettings(
  c: ErrorCollector,
  notyra: JsonObject
): SettingDeclaration[] | undefined {
  const raw = getOwn(notyra, 'settings')
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    c.structural('notyra.settings', raw, 'typeMismatch')
    return undefined
  }

  const result: SettingDeclaration[] = []
  const keys = new Set<string>()
  raw.forEach((item, i) => {
    const decl = parseSetting(c, item, `notyra.settings[${i}]`)
    // 他の項目が不正な宣言のキーも重複判定に含める
    const key = isObject(item) ? getOwn(item, 'key') : undefined
    if (typeof key === 'string' && key !== '') {
      if (keys.has(key)) {
        c.value(`notyra.settings[${i}].key`, key, 'invalidSetting')
        return
      }
      keys.add(key)
    }
    if (decl !== undefined) result.push(decl)
  })
  return result
}

function parseSetting(
  c: ErrorCollector,
  item: unknown,
  field: string
): SettingDeclaration | undefined {
  if (!isObject(item)) {
    c.structural(field, item, 'typeMismatch')
    return undefined
  }
  const start = c.errors.length

  const key = c.requiredString(item, 'key', `${field}.key`)
  if (key === '') c.value(`${field}.key`, key, 'invalidSetting')
  const title = c.requiredString(item, 'title', `${field}.title`)
  const description = c.optionalString(
    item,
    'description',
    `${field}.description`
  )
  const type = c.requiredString(item, 'type', `${field}.type`)
  if (type !== undefined && !SETTING_TYPES.has(type)) {
    c.value(`${field}.type`, type, 'invalidSetting')
  }

  const defaultValue = getOwn(item, 'default')
  if (defaultValue === undefined) {
    c.structural(`${field}.default`, defaultValue, 'missingField')
  }

  let options: SelectOption[] | undefined
  if (type === 'select') {
    options = parseSelectOptions(c, getOwn(item, 'options'), field)
  }

  if (
    defaultValue !== undefined &&
    type !== undefined &&
    SETTING_TYPES.has(type) &&
    !isDefaultValid(type, defaultValue, options)
  ) {
    // select で options 自体が不正な場合は既定値の判定を行わない
    if (type !== 'select' || options !== undefined) {
      c.value(`${field}.default`, defaultValue, 'invalidSetting')
    }
  }

  if (
    c.errors.length > start ||
    key === undefined ||
    title === undefined ||
    type === undefined ||
    !description.ok
  ) {
    return undefined
  }

  const base = {
    key,
    title,
    ...(description.value !== undefined && { description: description.value }),
  }
  switch (type) {
    case 'string':
      return { ...base, type, default: defaultValue as string }
    case 'number':
      return { ...base, type, default: defaultValue as number }
    case 'boolean':
      return { ...base, type, default: defaultValue as boolean }
    case 'select':
      return {
        ...base,
        type,
        default: defaultValue as string,
        options: options as SelectOption[],
      }
    default:
      return undefined
  }
}

function isDefaultValid(
  type: string,
  value: unknown,
  options: SelectOption[] | undefined
): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'select':
      return (
        typeof value === 'string' &&
        options !== undefined &&
        options.some(o => o.value === value)
      )
    default:
      return false
  }
}

function parseSelectOptions(
  c: ErrorCollector,
  raw: unknown,
  field: string
): SelectOption[] | undefined {
  const optionsField = `${field}.options`
  if (raw === undefined) {
    c.structural(optionsField, raw, 'missingField')
    return undefined
  }
  if (!Array.isArray(raw)) {
    c.structural(optionsField, raw, 'typeMismatch')
    return undefined
  }
  if (raw.length === 0) {
    c.value(optionsField, raw, 'invalidSetting')
    return undefined
  }

  const result: SelectOption[] = []
  const values = new Set<string>()
  let failed = false
  raw.forEach((item, i) => {
    const itemField = `${optionsField}[${i}]`
    if (!isObject(item)) {
      c.structural(itemField, item, 'typeMismatch')
      failed = true
      return
    }
    const value = c.requiredString(item, 'value', `${itemField}.value`)
    const label = c.requiredString(item, 'label', `${itemField}.label`)
    if (value === undefined || label === undefined) {
      failed = true
      return
    }
    if (values.has(value)) {
      c.value(`${itemField}.value`, value, 'invalidSetting')
      failed = true
      return
    }
    values.add(value)
    result.push({ value, label })
  })
  return failed ? undefined : result
}

// ---------------------------------------------------------------------------
// printManifest
// ---------------------------------------------------------------------------

/**
 * マニフェストオブジェクトを Plugin_Manifest（package.json）形式の JSON に
 * 書き出す。`undefined` の任意項目は出力しない。
 */
export function printManifest(m: PluginManifest): string {
  const notyra: JsonObject = {
    displayName: m.displayName,
    type: m.type,
    notyraVersion: m.notyraVersion,
  }
  if (m.type === 'feature') {
    notyra.main = m.main
    notyra.permissions = m.permissions.map(p => ({
      name: p.name,
      ...(p.purpose !== undefined && { purpose: p.purpose }),
    }))
    if (m.networkDestinations !== undefined) {
      notyra.networkDestinations = [...m.networkDestinations]
    }
    if (m.settings !== undefined) {
      notyra.settings = m.settings.map(printSetting)
    }
  } else {
    notyra.theme = m.theme
    if (m.themeCss !== undefined) notyra.themeCss = m.themeCss
  }

  const pkg: JsonObject = { name: m.id, version: m.version }
  if (m.description !== undefined) pkg.description = m.description
  if (m.author !== undefined) pkg.author = printAuthor(m.author)
  pkg.notyra = notyra

  return JSON.stringify(pkg, null, 2)
}

function printAuthor(author: PluginAuthor): PluginAuthor {
  if (typeof author === 'string') return author
  return {
    name: author.name,
    ...(author.email !== undefined && { email: author.email }),
    ...(author.url !== undefined && { url: author.url }),
  }
}

function printSetting(s: SettingDeclaration): JsonObject {
  const out: JsonObject = { key: s.key, title: s.title }
  if (s.description !== undefined) out.description = s.description
  out.type = s.type
  out.default = s.default
  if (s.type === 'select') {
    out.options = s.options.map(o => ({ value: o.value, label: o.label }))
  }
  return out
}
