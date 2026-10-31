import { describe, expect, it } from 'vitest'

import {
  DECLARED_DESTINATION_PATTERN,
  parseManifest,
  printManifest,
} from '@/shared/plugin/manifest'
import type {
  FeatureManifest,
  ManifestError,
  ThemeManifest,
} from '@/shared/plugin/types'

const featureJson = (notyra: Record<string, unknown> = {}, top = {}) =>
  JSON.stringify({
    name: 'notyra-toc',
    version: '1.0.0',
    ...top,
    notyra: {
      displayName: '目次',
      type: 'feature',
      notyraVersion: '^3.2.0',
      main: 'dist/index.js',
      permissions: [],
      ...notyra,
    },
  })

const errorsOf = (json: string): ManifestError[] => {
  const result = parseManifest(json)
  if (result.ok) throw new Error('expected parse failure')
  return result.errors
}

describe('parseManifest', () => {
  it('parses a valid feature manifest', () => {
    const result = parseManifest(
      featureJson(
        {
          permissions: [{ name: 'network', purpose: 'AI API' }],
          networkDestinations: ['api.example.com', '*.example.org:8443'],
          settings: [
            {
              key: 'depth',
              title: '深さ',
              type: 'select',
              default: '3',
              options: [
                { value: '2', label: 'H2' },
                { value: '3', label: 'H3' },
              ],
            },
          ],
          unknownKey: { ignored: true },
        },
        { description: 'toc', author: { name: 'Jane' } }
      )
    )
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'notyra-toc',
        version: '1.0.0',
        description: 'toc',
        author: { name: 'Jane' },
        displayName: '目次',
        type: 'feature',
        notyraVersion: '^3.2.0',
        main: 'dist/index.js',
        permissions: [{ name: 'network', purpose: 'AI API' }],
        networkDestinations: ['api.example.com', '*.example.org:8443'],
        settings: [
          {
            key: 'depth',
            title: '深さ',
            type: 'select',
            default: '3',
            options: [
              { value: '2', label: 'H2' },
              { value: '3', label: 'H3' },
            ],
          },
        ],
      },
    })
  })

  it('parses a valid theme manifest', () => {
    const json = JSON.stringify({
      name: 'nord-theme',
      version: '0.1.0-beta.1',
      notyra: {
        displayName: 'Nord',
        type: 'theme',
        notyraVersion: '>=3.0.0',
        theme: 'theme.json',
        themeCss: 'theme.css',
      },
    })
    expect(parseManifest(json)).toEqual({
      ok: true,
      value: {
        id: 'nord-theme',
        version: '0.1.0-beta.1',
        displayName: 'Nord',
        type: 'theme',
        notyraVersion: '>=3.0.0',
        theme: 'theme.json',
        themeCss: 'theme.css',
      },
    })
  })

  it('returns structural errors for invalid JSON and missing notyra', () => {
    expect(errorsOf('{')).toEqual([
      expect.objectContaining({ category: 'structural', code: 'invalidJson' }),
    ])
    expect(
      errorsOf(JSON.stringify({ name: 'a', version: '1.0.0' }))
    ).toContainEqual(
      expect.objectContaining({ field: 'notyra', code: 'missingNotyra' })
    )
  })

  it('collects every error with field and value', () => {
    const errors = errorsOf(
      featureJson(
        {
          notyraVersion: 'not a range',
          main: '../evil.js',
          permissions: [{ name: 'fs' }, { name: 'network' }],
        },
        { name: '@scope/pkg', version: 'v1.0.0' }
      )
    )
    expect(errors).toEqual(
      expect.arrayContaining([
        { category: 'value', field: 'name', value: '@scope/pkg', code: 'invalidId' },
        { category: 'value', field: 'version', value: 'v1.0.0', code: 'invalidVersion' },
        {
          category: 'value',
          field: 'notyra.notyraVersion',
          value: 'not a range',
          code: 'invalidRange',
        },
        { category: 'value', field: 'notyra.main', value: '../evil.js', code: 'invalidPath' },
        {
          category: 'value',
          field: 'notyra.permissions[0].name',
          value: 'fs',
          code: 'unknownPermission',
        },
        {
          category: 'value',
          field: 'notyra.networkDestinations',
          value: undefined,
          code: 'networkWithoutDestinations',
        },
      ])
    )
    expect(errors).toHaveLength(6)
  })

  it('rejects main and permissions on a theme plugin', () => {
    const errors = errorsOf(
      JSON.stringify({
        name: 'bad-theme',
        version: '1.0.0',
        notyra: {
          displayName: 'Bad',
          type: 'theme',
          notyraVersion: '*',
          theme: 'theme.json',
          main: 'index.js',
          permissions: [],
        },
      })
    )
    expect(errors.map(e => [e.field, e.code])).toEqual([
      ['notyra.main', 'forbiddenForTheme'],
      ['notyra.permissions', 'forbiddenForTheme'],
    ])
  })

  it('reports missing fields and type mismatches as structural errors', () => {
    const errors = errorsOf(
      JSON.stringify({
        name: 1,
        notyra: { type: 'feature', displayName: 'x', notyraVersion: '*' },
      })
    )
    expect(errors.map(e => [e.category, e.field, e.code])).toEqual([
      ['structural', 'name', 'typeMismatch'],
      ['structural', 'version', 'missingField'],
      ['structural', 'notyra.main', 'missingField'],
      ['structural', 'notyra.permissions', 'missingField'],
    ])
  })

  it('validates settings declarations', () => {
    const errors = errorsOf(
      featureJson({
        settings: [
          { key: 'a', title: 'A', type: 'number', default: '1' },
          { key: 'a', title: 'A2', type: 'boolean', default: true },
          {
            key: 'b',
            title: 'B',
            type: 'select',
            default: 'z',
            options: [{ value: 'x', label: 'X' }],
          },
        ],
      })
    )
    expect(errors.map(e => [e.field, e.code])).toEqual([
      ['notyra.settings[0].default', 'invalidSetting'],
      ['notyra.settings[1].key', 'invalidSetting'],
      ['notyra.settings[2].default', 'invalidSetting'],
    ])
  })

  it('reports duplicate permissions and invalid destinations', () => {
    const errors = errorsOf(
      featureJson({
        permissions: [{ name: 'clipboard' }, { name: 'clipboard' }],
        networkDestinations: ['http://example.com'],
      })
    )
    expect(errors.map(e => [e.field, e.code])).toEqual([
      ['notyra.permissions[1].name', 'duplicatePermission'],
      ['notyra.networkDestinations[0]', 'invalidDestination'],
    ])
  })
})

describe('DECLARED_DESTINATION_PATTERN', () => {
  it.each([
    'localhost',
    'api.example.com',
    '*.example.com',
    'example.com:8080',
    '192.168.0.1',
    '10.0.0.1:65535',
    '[::1]',
    '[fe80::1]:3000',
    '[::ffff:127.0.0.1]',
  ])('accepts %s', dest => {
    expect(DECLARED_DESTINATION_PATTERN.test(dest)).toBe(true)
  })

  it.each([
    '',
    'example.com:0',
    'example.com:65536',
    '*.',
    'a.*.example.com',
    '256.1.1.1',
    '::1',
    '[::1',
    'https://example.com',
    'example.com/path',
    '-bad.example.com',
  ])('rejects %s', dest => {
    expect(DECLARED_DESTINATION_PATTERN.test(dest)).toBe(false)
  })
})

describe('printManifest', () => {
  it('omits undefined optional fields and round-trips', () => {
    const feature: FeatureManifest = {
      id: 'plugin-a',
      version: '2.0.0',
      author: 'Someone',
      displayName: 'A',
      type: 'feature',
      notyraVersion: '^3.0.0 || >=4.0.0-0',
      main: 'index.mjs',
      permissions: [{ name: 'notes:read' }],
      description: undefined,
    }
    const printed = printManifest(feature)
    expect(printed).not.toContain('description')
    expect(printed).toBe(JSON.stringify(JSON.parse(printed), null, 2))
    expect(parseManifest(printed)).toEqual({ ok: true, value: feature })

    const theme: ThemeManifest = {
      id: 'theme-b',
      version: '1.0.0+build.5',
      author: { name: 'B', url: 'https://example.com' },
      displayName: 'B',
      type: 'theme',
      notyraVersion: '*',
      theme: 'themes/b.json',
    }
    expect(parseManifest(printManifest(theme))).toEqual({
      ok: true,
      value: theme,
    })
  })
})
