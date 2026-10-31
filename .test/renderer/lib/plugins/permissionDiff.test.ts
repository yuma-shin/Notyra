import { describe, expect, it } from 'vitest'
import { diffConsent } from '@/renderer/lib/plugins/permissionDiff'
import type {
  FeatureManifest,
  ThemeManifest,
} from '@/shared/plugin/types'

const feature = (
  overrides: Partial<FeatureManifest> = {}
): FeatureManifest => ({
  id: 'sample',
  version: '1.0.0',
  displayName: 'Sample',
  notyraVersion: '*',
  type: 'feature',
  main: 'index.js',
  permissions: [],
  ...overrides,
})

describe('diffConsent', () => {
  it('returns only newly declared permissions and destinations', () => {
    const result = diffConsent(
      { permissions: ['clipboard'], destinations: ['api.example.com'] },
      feature({
        permissions: [{ name: 'network' }, { name: 'clipboard' }],
        networkDestinations: ['api.example.com', '*.example.org'],
      })
    )
    expect(result.addedPermissions).toEqual(['network'])
    expect(result.addedDestinations).toEqual(['*.example.org'])
    expect(result.nextConsent).toEqual({
      permissions: ['network', 'clipboard'],
      destinations: ['api.example.com', '*.example.org'],
    })
  })

  it('drops consents no longer declared and reports no additions', () => {
    const result = diffConsent(
      {
        permissions: ['clipboard', 'network'],
        destinations: ['api.example.com'],
      },
      feature({ permissions: [{ name: 'clipboard' }] })
    )
    expect(result.addedPermissions).toEqual([])
    expect(result.addedDestinations).toEqual([])
    expect(result.nextConsent).toEqual({
      permissions: ['clipboard'],
      destinations: [],
    })
  })

  it('treats theme manifests as declaring nothing', () => {
    const theme: ThemeManifest = {
      id: 'theme',
      version: '1.0.0',
      displayName: 'Theme',
      notyraVersion: '*',
      type: 'theme',
      theme: 'theme.json',
    }
    const result = diffConsent(
      { permissions: ['network'], destinations: ['localhost'] },
      theme
    )
    expect(result).toEqual({
      addedPermissions: [],
      addedDestinations: [],
      nextConsent: { permissions: [], destinations: [] },
    })
  })

  it('deduplicates in declaration order and does not mutate inputs', () => {
    const consented = { permissions: [], destinations: [] }
    const manifest = feature({
      permissions: [{ name: 'network' }, { name: 'network' }],
      networkDestinations: ['b.example.com', 'a.example.com', 'b.example.com'],
    })
    const snapshot = structuredClone({ consented, manifest })
    const result = diffConsent(consented, manifest)
    expect(result.addedPermissions).toEqual(['network'])
    expect(result.addedDestinations).toEqual(['b.example.com', 'a.example.com'])
    expect({ consented, manifest }).toEqual(snapshot)
    expect(result.nextConsent.destinations).not.toBe(
      manifest.networkDestinations
    )
  })
})
