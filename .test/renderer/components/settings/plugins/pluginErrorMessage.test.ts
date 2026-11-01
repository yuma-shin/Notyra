import { describe, it, expect } from 'vitest'
import i18n from 'i18next'
import type { TFunction } from 'i18next'
import {
  describePluginManagerError,
  formatManifestErrors,
  formatPluginApiError,
  formatPluginManagerError,
  formatResetAt,
  stringifyManifestValue,
} from '@/renderer/components/settings/plugins/pluginErrorMessage'
import type { PluginManagerError } from '@/renderer/lib/plugins/manager/pluginManager'
import { toPluginApiError } from '@/renderer/lib/plugins/pluginError'
import { PluginApiError } from '@/shared/plugin/api'
import type {
  ManifestError,
  PluginBackendErrorKind,
  PluginErrorPayload,
  StructuralErrorCode,
  ValueErrorCode,
} from '@/shared/plugin/types'

const LANGS = ['en', 'ja'] as const
const tFor = (lng: string): TFunction => i18n.getFixedT(lng)
const en = tFor('en')

/** 翻訳済みで、未解決のキーや補間が残っていないこと */
function expectTranslated(text: string) {
  expect(text).not.toMatch(/^plugins\./)
  expect(text).not.toContain('{{')
  expect(text).not.toContain('undefined')
}

/** Rust の PluginError の全種別のペイロード（Record で網羅性を保証する） */
const PAYLOADS: Record<PluginBackendErrorKind, PluginErrorPayload> = {
  repoNotFound: { kind: 'repoNotFound' },
  noRelease: { kind: 'noRelease' },
  noPackage: { kind: 'noPackage' },
  rateLimited: { kind: 'rateLimited', resetAt: null },
  network: { kind: 'network', message: 'connection refused' },
  tooLarge: { kind: 'tooLarge' },
  invalidZip: { kind: 'invalidZip', message: 'bad header' },
  manifestMissing: { kind: 'manifestMissing' },
  alreadyInstalled: { kind: 'alreadyInstalled' },
  notInstalled: { kind: 'notInstalled' },
  io: { kind: 'io', message: 'disk full' },
  permissionDenied: { kind: 'permissionDenied', permission: 'network' },
  schemeNotAllowed: { kind: 'schemeNotAllowed', scheme: 'ftp' },
  blocked: {
    kind: 'blocked',
    host: 'evil.example',
    port: 443,
    reason: 'notDeclared',
  },
  outOfScope: { kind: 'outOfScope', path: '/etc/passwd' },
  notFound: { kind: 'notFound', path: '/notes/a.md' },
  nameConflict: { kind: 'nameConflict', path: '/notes/b.md' },
  tooManyRedirects: { kind: 'tooManyRedirects' },
  responseTooLarge: { kind: 'responseTooLarge' },
  timeout: { kind: 'timeout' },
  corruptState: { kind: 'corruptState', message: 'eof' },
  invalidArgument: { kind: 'invalidArgument', message: 'bad id' },
}

const STRUCTURAL_CODES: Record<StructuralErrorCode, true> = {
  invalidJson: true,
  missingNotyra: true,
  missingField: true,
  typeMismatch: true,
}
const VALUE_CODES: Record<ValueErrorCode, true> = {
  unknownType: true,
  unknownPermission: true,
  networkWithoutDestinations: true,
  invalidRange: true,
  invalidId: true,
  invalidVersion: true,
  invalidDestination: true,
  forbiddenForTheme: true,
  invalidSetting: true,
  duplicatePermission: true,
  invalidPath: true,
}

const ALL_MANIFEST_ERRORS: ManifestError[] = [
  ...(Object.keys(STRUCTURAL_CODES) as StructuralErrorCode[]).map(
    (code): ManifestError => ({
      category: 'structural',
      code,
      field: `field.${code}`,
      value: 1,
    })
  ),
  ...(Object.keys(VALUE_CODES) as ValueErrorCode[]).map(
    (code): ManifestError => ({
      category: 'value',
      code,
      field: `field.${code}`,
      value: 'bad',
    })
  ),
]

/** PluginManagerError の全種別（Record で網羅性を保証する） */
const MANAGER_ERRORS: Record<PluginManagerError['kind'], PluginManagerError> =
  {
    repoSpec: { kind: 'repoSpec', reason: 'format' },
    manifestInvalid: { kind: 'manifestInvalid', errors: ALL_MANIFEST_ERRORS },
    idMismatch: { kind: 'idMismatch', expected: 'a', actual: 'b' },
    alreadyInstalled: { kind: 'alreadyInstalled', id: 'my-plugin' },
    incompatible: { kind: 'incompatible', range: '^9.0.0', current: '3.2.0' },
    themeInvalid: { kind: 'themeInvalid', message: 'missing colors' },
    notInstalled: { kind: 'notInstalled', id: 'gone' },
    developerModeDisabled: { kind: 'developerModeDisabled' },
    backend: {
      kind: 'backend',
      error: toPluginApiError({ kind: 'repoNotFound' }),
    },
  }

describe('formatPluginManagerError', () => {
  it.each(LANGS)('すべての種別を翻訳する（%s）', lng => {
    const t = tFor(lng)
    for (const error of Object.values(MANAGER_ERRORS)) {
      expectTranslated(formatPluginManagerError(t, error))
    }
  })

  it('repoSpec の empty と format を区別する', () => {
    expect(
      formatPluginManagerError(en, { kind: 'repoSpec', reason: 'empty' })
    ).toBe('Enter a repository')
    expect(
      formatPluginManagerError(en, { kind: 'repoSpec', reason: 'format' })
    ).toBe(en('plugins.errors.repoSpecFormat'))
  })

  it('値を補間する', () => {
    expect(formatPluginManagerError(en, MANAGER_ERRORS.idMismatch)).toBe(
      'Plugin ID mismatch (registry: a, package: b)'
    )
    const incompatible = formatPluginManagerError(
      en,
      MANAGER_ERRORS.incompatible
    )
    expect(incompatible).toContain('^9.0.0')
    expect(incompatible).toContain('3.2.0')
    expect(
      formatPluginManagerError(en, MANAGER_ERRORS.alreadyInstalled)
    ).toContain('my-plugin')
    expect(formatPluginManagerError(en, MANAGER_ERRORS.themeInvalid)).toContain(
      'missing colors'
    )
  })

  it('manifestInvalid は件数の要約とすべてのエラーを含む', () => {
    const { summary, details } = describePluginManagerError(
      en,
      MANAGER_ERRORS.manifestInvalid
    )
    expect(summary).toContain(String(ALL_MANIFEST_ERRORS.length))
    expect(details).toHaveLength(ALL_MANIFEST_ERRORS.length)
    const text = formatPluginManagerError(en, MANAGER_ERRORS.manifestInvalid)
    expect(text.split('\n')).toEqual([summary, ...details])
  })

  it('manifestInvalid 以外は詳細を持たない', () => {
    for (const error of Object.values(MANAGER_ERRORS)) {
      if (error.kind === 'manifestInvalid') continue
      expect(describePluginManagerError(en, error).details).toEqual([])
    }
  })
})

describe('formatManifestErrors', () => {
  it.each(LANGS)('すべてのカテゴリ・コードを翻訳する（%s）', lng => {
    const lines = formatManifestErrors(tFor(lng), ALL_MANIFEST_ERRORS)
    expect(lines).toHaveLength(ALL_MANIFEST_ERRORS.length)
    for (const line of lines) expectTranslated(line)
  })

  it('項目名と JSON 文字列化した値を含む', () => {
    const [line] = formatManifestErrors(en, [
      {
        category: 'value',
        code: 'invalidDestination',
        field: 'notyra.networkDestinations[0]',
        value: 'bad host',
      },
    ])
    expect(line).toContain('notyra.networkDestinations[0]')
    expect(line).toContain('"bad host"')
  })

  it('値を JSON 文字列化し、長い値は切り詰める', () => {
    expect(stringifyManifestValue({ a: 1 })).toBe('{"a":1}')
    expect(stringifyManifestValue(undefined)).toBe('undefined')
    expect(stringifyManifestValue(10n)).toBe('10')
    const long = stringifyManifestValue('x'.repeat(1000))
    expect(long.length).toBeLessThanOrEqual(201)
    expect(long.endsWith('…')).toBe(true)
  })

  it('未知のコードは項目名と値で表示する', () => {
    const [line] = formatManifestErrors(en, [
      {
        category: 'value',
        code: 'futureCode' as ValueErrorCode,
        field: 'notyra.x',
        value: 1,
      },
    ])
    expect(line).toBe('notyra.x: 1')
  })
})

describe('formatPluginApiError', () => {
  it.each(LANGS)('Rust のすべての種別を翻訳する（%s）', lng => {
    const t = tFor(lng)
    for (const payload of Object.values(PAYLOADS)) {
      expectTranslated(formatPluginApiError(t, toPluginApiError(payload)))
    }
  })

  it('Plugin_API のみの種別を翻訳する', () => {
    for (const kind of ['deleteRejected', 'pluginNotActive'] as const) {
      expectTranslated(formatPluginApiError(en, new PluginApiError(kind)))
    }
  })

  it('ペイロードのフィールドで補間する', () => {
    expect(
      formatPluginApiError(en, toPluginApiError(PAYLOADS.network))
    ).toContain('connection refused')
    expect(
      formatPluginApiError(en, toPluginApiError(PAYLOADS.outOfScope))
    ).toContain('/etc/passwd')
    expect(
      formatPluginApiError(en, toPluginApiError(PAYLOADS.permissionDenied))
    ).toContain('network')
  })

  it('Tauri の文字列エラーは message で補間する', () => {
    const text = formatPluginApiError(en, toPluginApiError('missing arg id'))
    expect(text).toContain('missing arg id')
  })

  it('rateLimited は resetAt があればローカル時刻を表示する', () => {
    const resetAt = 1_700_000_000
    const text = formatPluginApiError(
      en,
      toPluginApiError({ kind: 'rateLimited', resetAt })
    )
    expect(text).toBe(
      en('plugins.errors.rateLimitedUntil', {
        resetAt: formatResetAt(resetAt),
      })
    )
    expect(
      formatPluginApiError(en, toPluginApiError(PAYLOADS.rateLimited))
    ).toBe(en('plugins.errors.rateLimited'))
  })

  it('blocked は宛先と理由を連結する', () => {
    const text = formatPluginApiError(en, toPluginApiError(PAYLOADS.blocked))
    expect(text).toContain('evil.example:443')
    expect(text).toContain(en('plugins.errors.blockReason.notDeclared'))
  })

  it('未知の種別は unknown で表示する', () => {
    const error = new PluginApiError(
      'somethingNew' as PluginApiError['kind'],
      'boom'
    )
    expect(formatPluginApiError(en, error)).toBe(
      en('plugins.errors.unknown', { message: 'boom' })
    )
  })
})
