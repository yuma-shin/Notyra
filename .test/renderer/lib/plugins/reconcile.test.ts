import { describe, expect, it } from 'vitest'
import {
  computeDesiredPlugins,
  type DesiredPlugin,
  diffLoaded,
} from '@/renderer/lib/plugins/reconcile'
import type {
  InstalledPluginView,
  PluginStateView,
} from '@/shared/plugin/types'

const featurePackageJson = (id: string, range = '^3.0.0') =>
  JSON.stringify({
    name: id,
    version: '1.0.0',
    notyra: {
      displayName: id,
      type: 'feature',
      notyraVersion: range,
      main: 'dist/index.js',
      permissions: [],
    },
  })

const plugin = (
  id: string,
  overrides: Partial<InstalledPluginView> = {}
): InstalledPluginView => ({
  id,
  version: '1.0.0',
  source: { type: 'github', owner: 'o', repo: id },
  enabled: true,
  consentedPermissions: [],
  consentedDestinations: [],
  generation: 0,
  installedAt: '2026-01-01T00:00:00.000Z',
  packageJson: featurePackageJson(id),
  ...overrides,
})

const state = (
  plugins: InstalledPluginView[],
  developerMode = false
): PluginStateView => ({
  schemaVersion: 1,
  thirdPartyWarningAcknowledged: true,
  developerMode,
  plugins,
})

describe('computeDesiredPlugins', () => {
  it('returns enabled, compatible plugins in Load_Order with loadKey', () => {
    const s = state([plugin('b'), plugin('a', { generation: 2 })])
    const desired = computeDesiredPlugins(s, '3.2.0', 'main')
    expect(desired.map(d => d.id)).toEqual(['b', 'a'])
    expect(desired.map(d => d.loadKey)).toEqual(['b@1.0.0#0', 'a@1.0.0#2'])
    expect(desired.map(d => d.loadOrderIndex)).toEqual([0, 1])
    expect(desired[0].manifest.type).toBe('feature')
  })

  it('excludes disabled, incompatible, pending-consent and unparsable plugins', () => {
    const s = state([
      plugin('disabled', { enabled: false }),
      plugin('incompat', { packageJson: featurePackageJson('incompat', '^4') }),
      plugin('pending', {
        pendingConsent: { addedPermissions: ['network'], addedDestinations: [] },
      }),
      plugin('nulljson', { packageJson: null }),
      plugin('broken', { packageJson: '{' }),
      plugin('ok'),
    ])
    expect(computeDesiredPlugins(s, '3.2.0', 'note').map(d => d.id)).toEqual([
      'ok',
    ])
  })

  it('loads local plugins only while developer mode is on', () => {
    const local = plugin('dev', { source: { type: 'local', path: '/p' } })
    expect(computeDesiredPlugins(state([local], false), '3.2.0', 'main')).toEqual(
      []
    )
    expect(
      computeDesiredPlugins(state([local], true), '3.2.0', 'main').map(d => d.id)
    ).toEqual(['dev'])
  })

  it('does not mutate the input state', () => {
    const s = state([plugin('a'), plugin('b', { enabled: false })], true)
    const snapshot = structuredClone(s)
    const desired = computeDesiredPlugins(s, '3.2.0', 'main')
    desired[0].consentedPermissions.push('network')
    expect(s).toEqual(snapshot)
  })
})

describe('diffLoaded', () => {
  const desired = (id: string, loadKey: string): DesiredPlugin =>
    ({ id, loadKey }) as DesiredPlugin

  it('stops removed plugins and loads new ones', () => {
    const result = diffLoaded(
      [desired('a', 'a@1#0'), desired('c', 'c@1#0')],
      [
        { id: 'a', loadKey: 'a@1#0' },
        { id: 'b', loadKey: 'b@1#0' },
      ]
    )
    expect(result.toStop).toEqual(['b'])
    expect(result.toLoad.map(d => d.id)).toEqual(['c'])
  })

  it('lists a plugin in both toStop and toLoad when its loadKey changed', () => {
    const result = diffLoaded(
      [desired('a', 'a@2#1')],
      [{ id: 'a', loadKey: 'a@1#0' }]
    )
    expect(result.toStop).toEqual(['a'])
    expect(result.toLoad.map(d => d.loadKey)).toEqual(['a@2#1'])
  })

  it('returns empty diff when already reconciled', () => {
    const result = diffLoaded(
      [desired('a', 'a@1#0')],
      [{ id: 'a', loadKey: 'a@1#0' }]
    )
    expect(result).toEqual({ toStop: [], toLoad: [] })
  })
})
