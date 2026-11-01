import fc from 'fast-check'
import semver from 'semver'
import { expect, it } from 'vitest'
import {
  destinationsArb,
  featureArb,
  idArb,
  installed,
  permissionsArb,
  pluginState,
  runs,
  versionArb,
} from '../../../helpers/pluginArbitraries'
import { isCompatible, isNewerVersion } from '@/renderer/lib/plugins/compat'
import { parseRepoSpec } from '@/renderer/lib/plugins/repoSpec'
import { filterRegistry, parseRegistry } from '@/renderer/lib/plugins/registry'
import {
  computeDesiredPlugins,
  diffLoaded,
} from '@/renderer/lib/plugins/reconcile'
import { resolveKeybindings } from '@/renderer/lib/plugins/keybindings'
import { diffConsent } from '@/renderer/lib/plugins/permissionDiff'

// Feature: plugin-system, Property 5: リポジトリ指定の解析
it('Property 5: normalizes repository URL variants and rejects malformed specs', () => {
  fc.assert(
    fc.property(
      idArb,
      idArb,
      fc.constantFrom('', '.git', '/', '.git/'),
      (owner, repo, suffix) => {
        expect(parseRepoSpec(` \t${owner}/${repo}\n`)).toEqual({ owner, repo })
        expect(
          parseRepoSpec(` https://github.com/${owner}/${repo}${suffix} `)
        ).toEqual({ owner, repo })
        expect(parseRepoSpec(`https://evil.example/${owner}/${repo}`)).toEqual({
          error: 'format',
        })
      }
    ),
    runs
  )
})

const entriesArb = fc.uniqueArray(
  fc.record({
    id: idArb,
    name: fc.string(),
    description: fc.string(),
    author: fc.string(),
    repo: idArb.map(id => `owner/${id}`),
  }),
  { selector: e => e.id, maxLength: 12 }
)
// Feature: plugin-system, Property 8: レジストリのラウンドトリップ
it('Property 8: round-trips registry entries and rejects any malformed entry', () => {
  fc.assert(
    fc.property(
      entriesArb,
      fc.constantFrom('id', 'name', 'description', 'author', 'repo'),
      (plugins, field) => {
        expect(
          parseRegistry(JSON.stringify({ schemaVersion: 1, plugins }))
        ).toEqual({ ok: true, value: plugins })
        expect(
          parseRegistry(
            JSON.stringify({
              schemaVersion: 1,
              plugins: [
                ...plugins,
                {
                  id: 'x',
                  name: 'n',
                  description: 'd',
                  author: 'a',
                  repo: 'o/r',
                  [field]: 42,
                },
              ],
            })
          ).ok
        ).toBe(false)
        const missing: Record<string, unknown> = {
          id: 'x',
          name: 'n',
          description: 'd',
          author: 'a',
          repo: 'o/r',
        }
        delete missing[field]
        expect(
          parseRegistry(
            JSON.stringify({ schemaVersion: 1, plugins: [...plugins, missing] })
          ).ok
        ).toBe(false)
      }
    ),
    runs
  )
})

it('registry search preserves source order and matches only name or description', () => {
  fc.assert(
    fc.property(entriesArb, fc.string(), (entries, query) => {
      const q = query.trim().toLowerCase()
      expect(filterRegistry(entries, query)).toEqual(
        entries.filter(
          e =>
            !q || [e.name, e.description].some(v => v.toLowerCase().includes(q))
        )
      )
    }),
    runs
  )
})

// Feature: plugin-system, Property 9: 互換判定は node-semver と一致する
it('Property 9: compatibility follows semver including prereleases and invalid ranges', () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.string(),
        versionArb.map(v => `>=${v}`),
        fc.constant('*')
      ),
      versionArb,
      (range, version) => {
        expect(isCompatible(range, version)).toBe(
          semver.validRange(range, { includePrerelease: true }) !== null &&
            semver.satisfies(version, range, { includePrerelease: true })
        )
      }
    ),
    runs
  )
})

// Feature: plugin-system, Property 26: 更新の検出
it('Property 26: detects only strictly newer versions', () => {
  fc.assert(
    fc.property(versionArb, versionArb, (latest, current) => {
      expect(isNewerVersion(latest, current)).toBe(semver.gt(latest, current))
    }),
    runs
  )
})

// Feature: plugin-system, Property 10: 読み込み対象の決定
it('Property 10: selects exactly eligible plugins without mutating state', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.tuple(
          featureArb,
          fc.boolean(),
          fc.boolean(),
          fc.boolean(),
          fc.boolean()
        ),
        { maxLength: 10 }
      ),
      fc.boolean(),
      (items, developerMode) => {
        const plugins = items.map(
          ([m, enabled, pending, local, compatible], i) =>
            installed(
              {
                ...m,
                id: `p-${i}`,
                notyraVersion: compatible ? '*' : '>99.0.0',
              },
              {
                enabled,
                source: local
                  ? { type: 'local', path: '/dev' }
                  : { type: 'github', owner: 'o', repo: 'r' },
                pendingConsent: pending
                  ? { addedPermissions: [], addedDestinations: [] }
                  : undefined,
              }
            )
        )
        const state = pluginState(plugins, developerMode)
        const before = JSON.stringify(state)
        const desired = computeDesiredPlugins(state, '3.2.0', 'main')
        expect(desired.map(p => p.id)).toEqual(
          plugins
            .filter((_, i) => {
              const [, enabled, pending, local, compatible] = items[i]
              return (
                enabled && !pending && (!local || developerMode) && compatible
              )
            })
            .map(p => p.id)
        )
        expect(JSON.stringify(state)).toBe(before)
        expect(diffLoaded(desired, desired)).toEqual({ toStop: [], toLoad: [] })
      }
    ),
    runs
  )
})

// Feature: plugin-system, Property 27: 更新時の同意差分
it('Property 27: removes revoked consent and reports only newly declared capabilities', () => {
  fc.assert(
    fc.property(
      permissionsArb,
      destinationsArb,
      featureArb,
      (permissions, destinations, manifest) => {
        const ps = [...new Set(manifest.permissions.map(p => p.name))]
        const ds = [...new Set(manifest.networkDestinations)]
        expect(diffConsent({ permissions, destinations }, manifest)).toEqual({
          addedPermissions: ps.filter(p => !permissions.includes(p)),
          addedDestinations: ds.filter(d => !destinations.includes(d)),
          nextConsent: { permissions: ps, destinations: ds },
        })
      }
    ),
    runs
  )
})

// Feature: plugin-system, Property 36: キーバインドの優先順位
it('Property 36: builtins win and every losing binding names its winner', () => {
  fc.assert(
    fc.property(
      fc.subarray(['Ctrl-a', 'Ctrl-b', 'Ctrl-c']),
      fc.array(fc.constantFrom('Ctrl-a', 'Ctrl-b', 'Ctrl-c', 'Ctrl-d'), {
        maxLength: 20,
      }),
      (builtin, keys) => {
        const bindings = keys.map((key, i) => ({
          key,
          pluginId: `p-${i}`,
          command: `p-${i}:cmd`,
        }))
        const result = resolveKeybindings(new Set(builtin), bindings)
        const winners = bindings.filter(
          (b, i) => !builtin.includes(b.key) && keys.indexOf(b.key) === i
        )
        expect([...result.effective.values()]).toEqual(winners)
        expect(result.conflicts).toEqual(
          bindings
            .filter(b => !winners.includes(b))
            .map(b => ({
              ...b,
              with: builtin.includes(b.key)
                ? 'builtin'
                : { pluginId: winners.find(w => w.key === b.key)?.pluginId },
            }))
        )
      }
    ),
    runs
  )
})
