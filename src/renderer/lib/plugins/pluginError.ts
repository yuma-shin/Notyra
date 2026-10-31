/**
 * Rust の PluginError（`{ kind, ...fields }`）を PluginApiError に変換する。
 *
 * `invoke()` が reject する値は次のいずれか。
 * - コマンドが返した PluginError のシリアライズ値
 * - Tauri が生成する文字列（引数の型不一致・未登録コマンドなど）
 * - それ以外（想定外の値）
 */
import { PluginApiError } from '@/shared/plugin/api'
import type {
  PluginBackendErrorKind,
  PluginErrorPayload,
} from '@/shared/plugin/types'

/** Rust の PluginError の種別（網羅性を型で保証するため Record で列挙する） */
const BACKEND_KINDS: Record<PluginBackendErrorKind, true> = {
  repoNotFound: true,
  noRelease: true,
  noPackage: true,
  rateLimited: true,
  network: true,
  tooLarge: true,
  invalidZip: true,
  manifestMissing: true,
  alreadyInstalled: true,
  notInstalled: true,
  io: true,
  permissionDenied: true,
  schemeNotAllowed: true,
  blocked: true,
  outOfScope: true,
  notFound: true,
  nameConflict: true,
  tooManyRedirects: true,
  responseTooLarge: true,
  timeout: true,
  corruptState: true,
  invalidArgument: true,
}

export function isPluginErrorPayload(
  value: unknown
): value is PluginErrorPayload {
  if (typeof value !== 'object' || value === null) return false
  const kind = (value as { kind?: unknown }).kind
  return typeof kind === 'string' && Object.hasOwn(BACKEND_KINDS, kind)
}

/** Rust 側の `Display` 実装と同じ文言（UI では `kind` から翻訳済みの文言を使う） */
export function formatPluginErrorPayload(e: PluginErrorPayload): string {
  switch (e.kind) {
    case 'repoNotFound':
      return 'repository not found'
    case 'noRelease':
      return 'repository has no latest release'
    case 'noPackage':
      return 'latest release has no matching plugin package asset'
    case 'rateLimited':
      return e.resetAt != null
        ? `GitHub API rate limit exceeded (resets at ${e.resetAt})`
        : 'GitHub API rate limit exceeded'
    case 'network':
      return `network error: ${e.message}`
    case 'tooLarge':
      return 'plugin package exceeds the size limit'
    case 'invalidZip':
      return `invalid zip: ${e.message}`
    case 'manifestMissing':
      return 'package.json not found at the package root'
    case 'alreadyInstalled':
      return 'plugin is already installed'
    case 'notInstalled':
      return 'plugin is not installed'
    case 'io':
      return `I/O error: ${e.message}`
    case 'permissionDenied':
      return `permission denied: ${e.permission}`
    case 'schemeNotAllowed':
      return `scheme not allowed: ${e.scheme}`
    case 'blocked':
      return `request to ${e.host}:${e.port} blocked: ${e.reason}`
    case 'outOfScope':
      return `path is outside the registered root folders: ${e.path}`
    case 'notFound':
      return `not found: ${e.path}`
    case 'nameConflict':
      return `name already exists: ${e.path}`
    case 'tooManyRedirects':
      return 'too many redirects'
    case 'responseTooLarge':
      return 'response exceeds the size limit'
    case 'timeout':
      return 'request timed out'
    case 'corruptState':
      return `plugin state is corrupt: ${e.message}`
    case 'invalidArgument':
      return `invalid argument: ${e.message}`
  }
}

/**
 * `invoke()` の reject 値を PluginApiError に変換する。
 * `details` には元の値（PluginError の場合はそのペイロード）を保持する。
 */
export function toPluginApiError(raw: unknown): PluginApiError {
  if (raw instanceof PluginApiError) return raw
  if (isPluginErrorPayload(raw)) {
    return new PluginApiError(raw.kind, formatPluginErrorPayload(raw), raw)
  }
  // Tauri が引数の解析失敗・未登録コマンドで返す文字列
  if (typeof raw === 'string') {
    return new PluginApiError('invalidArgument', raw, raw)
  }
  if (raw instanceof Error) {
    return new PluginApiError('io', raw.message, raw)
  }
  return new PluginApiError('io', String(raw), raw)
}
