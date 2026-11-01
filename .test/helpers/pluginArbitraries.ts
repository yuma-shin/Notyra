import fc from 'fast-check'
import type {
  FeatureManifest,
  InstalledPluginView,
  PluginManifest,
  PluginStateView,
  SettingDeclaration,
} from '@/shared/plugin/types'
import { PERMISSIONS } from '@/shared/plugin/types'
import { printManifest } from '@/shared/plugin/manifest'

export const runs = { numRuns: 100 }
export const idArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/)
export const versionArb = fc
  .tuple(fc.nat(20), fc.nat(30), fc.nat(40), fc.boolean())
  .map(([a, b, c, pre]) => `${a}.${b}.${c}${pre ? '-beta.1' : ''}`)
export const permissionsArb = fc.subarray([...PERMISSIONS])
export const destinationsArb = fc.uniqueArray(
  idArb.map(s => `${s}x.example.com`),
  { maxLength: 5 }
)
export const settingArb: fc.Arbitrary<SettingDeclaration> = fc.oneof(
  fc
    .string()
    .map(value => ({
      key: 's',
      title: '文字列',
      type: 'string' as const,
      default: value,
    })),
  fc
    .double({ noNaN: true, noDefaultInfinity: true })
    .map(value => ({
      key: 'n',
      title: '数値',
      type: 'number' as const,
      default: value,
    })),
  fc
    .boolean()
    .map(value => ({
      key: 'b',
      title: '真偽値',
      type: 'boolean' as const,
      default: value,
    })),
  idArb.map(value => ({
    key: 'o',
    title: '選択',
    type: 'select' as const,
    default: value,
    options: [{ value, label: value }],
  }))
)
export const featureArb: fc.Arbitrary<FeatureManifest> = fc
  .record({
    id: idArb,
    version: versionArb,
    displayName: fc.string().map(s => `Plugin ${s}`),
    description: fc.string(),
    author: fc.oneof(
      fc.string(),
      fc.record({ name: fc.string(), email: fc.string(), url: fc.string() })
    ),
    notyraVersion: fc.constantFrom(
      '*',
      '^3.0.0',
      '>=3.0.0-beta.1',
      '3.x || 4.x'
    ),
    type: fc.constant('feature' as const),
    main: fc.constant('dist/index.mjs'),
    permissions: permissionsArb.map(ps =>
      ps.map(name => ({ name, purpose: `Purpose: ${name}` }))
    ),
    networkDestinations: destinationsArb,
    settings: fc.uniqueArray(settingArb, {
      selector: d => d.key,
      maxLength: 4,
    }),
  })
  .map(m =>
    m.permissions.some(p => p.name === 'network') &&
    m.networkDestinations.length === 0
      ? { ...m, networkDestinations: ['api.example.com'] }
      : m
  )
export const manifestArb: fc.Arbitrary<PluginManifest> = fc.oneof(
  featureArb,
  fc.record({
    id: idArb,
    version: versionArb,
    displayName: fc.string().map(s => `Theme ${s}`),
    type: fc.constant('theme' as const),
    notyraVersion: fc.constant('*'),
    theme: fc.constant('theme.json'),
    themeCss: fc.constant('theme.css'),
  })
)
export function installed(
  manifest: PluginManifest,
  extra: Partial<InstalledPluginView> = {}
): InstalledPluginView {
  return {
    id: manifest.id,
    version: manifest.version,
    source: { type: 'github', owner: 'owner', repo: manifest.id },
    enabled: true,
    consentedPermissions: [],
    consentedDestinations: [],
    generation: 0,
    installedAt: '2026-10-31T00:00:00Z',
    packageJson: printManifest(manifest),
    ...extra,
  }
}
export function pluginState(
  plugins: InstalledPluginView[],
  developerMode = false
): PluginStateView {
  return {
    schemaVersion: 1,
    thirdPartyWarningAcknowledged: true,
    developerMode,
    plugins,
  }
}
