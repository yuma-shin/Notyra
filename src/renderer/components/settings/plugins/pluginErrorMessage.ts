import type { TFunction } from 'i18next'
import type { PluginApiError, PluginErrorKind } from '@/shared/plugin/api'
import type { BlockReason, ManifestError } from '@/shared/plugin/types'
import type { PluginManagerError } from '@/renderer/lib/plugins/manager/pluginManager'
import {
  formatPluginErrorPayload,
  isPluginErrorPayload,
} from '@/renderer/lib/plugins/pluginError'

/**
 * PluginManagerError / PluginApiError を Plugins_Tab に表示する文言へ変換する。
 *
 * Plugin 由来の値（項目名・不正な値・ID など）は補間するだけで、HTML として扱わない
 * （呼び出し側は React のテキストノードとして描画する）。
 */

/** `plugins.errors.<kind>` が定義されている種別（網羅性を型で保証する） */
const ERROR_KINDS: Record<PluginErrorKind, true> = {
  // Rust の PluginError
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
  // Plugin_API のみの種別
  deleteRejected: true,
  pluginNotActive: true,
}

const BLOCK_REASONS: Record<BlockReason, true> = {
  notDeclared: true,
  redirectNotDeclared: true,
  resolvedToPrivate: true,
  resolvedToNonPrivate: true,
}

/** マニフェストエラーの値の表示上限（package.json 全体などが値になる場合に備える） */
const MAX_VALUE_LENGTH = 200

/** マニフェストエラーの不正な値を JSON 文字列として表示用に整形する */
export function stringifyManifestValue(value: unknown): string {
  let text: string
  try {
    text = JSON.stringify(value) ?? String(value)
  } catch {
    text = String(value)
  }
  return text.length > MAX_VALUE_LENGTH
    ? `${text.slice(0, MAX_VALUE_LENGTH)}…`
    : text
}

/** Manifest_Parser のエラーを1件ずつ文言にする（Requirement 3.10、2.20） */
export function formatManifestErrors(
  t: TFunction,
  errors: readonly ManifestError[]
): string[] {
  return errors.map(e => {
    const value = stringifyManifestValue(e.value)
    return t(`plugins.manifestErrors.${e.category}.${e.code}`, {
      field: e.field,
      value,
      defaultValue: `${e.field}: ${value}`,
    })
  })
}

/** UNIX 秒をローカル時刻の文字列にする */
export function formatResetAt(resetAt: number): string {
  return new Date(resetAt * 1000).toLocaleString()
}

function detailsRecord(details: unknown): Record<string, unknown> {
  return typeof details === 'object' && details !== null
    ? (details as Record<string, unknown>)
    : {}
}

/** Rust コマンド・Plugin_API のエラーを文言にする */
export function formatPluginApiError(
  t: TFunction,
  error: PluginApiError
): string {
  const kind = error.kind as string
  const details = detailsRecord(error.details)

  if (!Object.hasOwn(ERROR_KINDS, kind)) {
    const message = isPluginErrorPayload(error.details)
      ? formatPluginErrorPayload(error.details)
      : error.message
    return t('plugins.errors.unknown', { message })
  }

  if (kind === 'rateLimited' && typeof details.resetAt === 'number') {
    return t('plugins.errors.rateLimitedUntil', {
      resetAt: formatResetAt(details.resetAt),
    })
  }

  // details（Rust のペイロード）のフィールドを優先し、なければ error.message を使う
  const text = t(`plugins.errors.${kind}`, {
    message: error.message,
    ...details,
  })

  if (
    kind === 'blocked' &&
    typeof details.reason === 'string' &&
    Object.hasOwn(BLOCK_REASONS, details.reason)
  ) {
    return `${text}: ${t(`plugins.errors.blockReason.${details.reason}`)}`
  }
  return text
}

/**
 * PluginManagerError を「要約」と「詳細の行」に分けて文言にする。
 * 詳細はマニフェストエラーの全件（それ以外の種別では空）。
 */
export function describePluginManagerError(
  t: TFunction,
  error: PluginManagerError
): { summary: string; details: string[] } {
  switch (error.kind) {
    case 'repoSpec':
      return {
        summary: t(
          error.reason === 'empty'
            ? 'plugins.errors.repoSpecEmpty'
            : 'plugins.errors.repoSpecFormat'
        ),
        details: [],
      }
    case 'manifestInvalid':
      return {
        summary: t('plugins.errors.manifestInvalid', {
          count: error.errors.length,
        }),
        details: formatManifestErrors(t, error.errors),
      }
    case 'idMismatch':
      return {
        summary: t('plugins.errors.idMismatch', {
          expected: error.expected,
          actual: error.actual,
        }),
        details: [],
      }
    case 'alreadyInstalled':
      return {
        summary: t('plugins.errors.alreadyInstalledWithId', { id: error.id }),
        details: [],
      }
    case 'incompatible':
      return {
        summary: t('plugins.errors.incompatible', {
          range: error.range,
          current: error.current,
        }),
        details: [],
      }
    case 'themeInvalid':
      return {
        summary: t('plugins.errors.themeInvalid', { message: error.message }),
        details: [],
      }
    case 'notInstalled':
      return {
        summary: t('plugins.errors.notInstalled', { id: error.id }),
        details: [],
      }
    case 'developerModeDisabled':
      return {
        summary: t('plugins.errors.developerModeDisabled'),
        details: [],
      }
    case 'backend':
      return { summary: formatPluginApiError(t, error.error), details: [] }
  }
}

/**
 * PluginManagerError を1つの文字列にする。
 * マニフェストエラーは要約の後に1行ずつ全件を連結する（表示側は `whitespace-pre-line` で改行する）。
 */
export function formatPluginManagerError(
  t: TFunction,
  error: PluginManagerError
): string {
  const { summary, details } = describePluginManagerError(t, error)
  return [summary, ...details].join('\n')
}
