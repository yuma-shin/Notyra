import type {
  ManifestError,
  ParseResult,
  RegistryEntry,
} from '@/shared/plugin/types'
import { parseRepoSpec } from './repoSpec'

const REGISTRY_SCHEMA_VERSION = 1

const ENTRY_FIELDS = ['id', 'name', 'description', 'author', 'repo'] as const

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getOwn(obj: JsonObject, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined
}

/**
 * Plugin_Registry の JSON（`{ schemaVersion: 1, plugins: [...] }`）を解析する。
 * 各エントリは id / name / description / author / repo の5項目がすべて文字列で、
 * repo が `parseRepoSpec` で解析可能でなければならない。
 * 不正な要素が1つでもあれば全体を失敗とし、検出したすべてのエラーを返す。
 * エントリの未知の項目は無視し、5項目だけを持つオブジェクトを元の順序で返す。
 */
export function parseRegistry(json: string): ParseResult<RegistryEntry[]> {
  const errors: ManifestError[] = []

  let root: unknown
  try {
    root = JSON.parse(json)
  } catch {
    return {
      ok: false,
      errors: [
        {
          category: 'structural',
          field: 'registry',
          value: json,
          code: 'invalidJson',
        },
      ],
    }
  }
  if (!isObject(root)) {
    return {
      ok: false,
      errors: [
        {
          category: 'structural',
          field: 'registry',
          value: root,
          code: 'invalidJson',
        },
      ],
    }
  }

  const schemaVersion = getOwn(root, 'schemaVersion')
  if (schemaVersion === undefined) {
    errors.push({
      category: 'structural',
      field: 'schemaVersion',
      value: schemaVersion,
      code: 'missingField',
    })
  } else if (typeof schemaVersion !== 'number') {
    errors.push({
      category: 'structural',
      field: 'schemaVersion',
      value: schemaVersion,
      code: 'typeMismatch',
    })
  } else if (schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    errors.push({
      category: 'value',
      field: 'schemaVersion',
      value: schemaVersion,
      code: 'invalidVersion',
    })
  }

  const plugins = getOwn(root, 'plugins')
  const entries: RegistryEntry[] = []
  if (plugins === undefined) {
    errors.push({
      category: 'structural',
      field: 'plugins',
      value: plugins,
      code: 'missingField',
    })
  } else if (!Array.isArray(plugins)) {
    errors.push({
      category: 'structural',
      field: 'plugins',
      value: plugins,
      code: 'typeMismatch',
    })
  } else {
    plugins.forEach((item: unknown, index) => {
      const entry = parseEntry(item, `plugins[${index}]`, errors)
      if (entry) entries.push(entry)
    })
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, value: entries }
}

function parseEntry(
  item: unknown,
  base: string,
  errors: ManifestError[]
): RegistryEntry | undefined {
  if (!isObject(item)) {
    errors.push({
      category: 'structural',
      field: base,
      value: item,
      code: 'typeMismatch',
    })
    return undefined
  }

  const values: Partial<Record<(typeof ENTRY_FIELDS)[number], string>> = {}
  let valid = true
  for (const key of ENTRY_FIELDS) {
    const value = getOwn(item, key)
    const field = `${base}.${key}`
    if (value === undefined) {
      errors.push({
        category: 'structural',
        field,
        value,
        code: 'missingField',
      })
      valid = false
    } else if (typeof value !== 'string') {
      errors.push({
        category: 'structural',
        field,
        value,
        code: 'typeMismatch',
      })
      valid = false
    } else {
      values[key] = value
    }
  }

  if (values.repo !== undefined && 'error' in parseRepoSpec(values.repo)) {
    errors.push({
      category: 'value',
      field: `${base}.repo`,
      value: values.repo,
      code: 'invalidId',
    })
    valid = false
  }

  if (!valid) return undefined
  return {
    id: values.id as string,
    name: values.name as string,
    description: values.description as string,
    author: values.author as string,
    repo: values.repo as string,
  }
}

/**
 * レジストリのエントリを検索語で絞り込む。
 * 検索語は前後の空白を除去して小文字化し、空なら全件を返す。
 * それ以外は名前または説明の小文字化が検索語を部分文字列として含むエントリを、元の順序のまま返す。
 */
export function filterRegistry(
  entries: RegistryEntry[],
  query: string
): RegistryEntry[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...entries]
  return entries.filter(
    entry =>
      entry.name.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q)
  )
}
