import fc from 'fast-check'
import semver from 'semver'
import { expect, it } from 'vitest'
import { featureArb, manifestArb, runs, settingArb, versionArb } from '../../helpers/pluginArbitraries'
import { parseManifest, printManifest } from '@/shared/plugin/manifest'
import { resolveSettingValue, validateSettingValue } from '@/shared/plugin/settingsSchema'

// Feature: plugin-system, Property 1: マニフェストのラウンドトリップ
it('Property 1: round-trips feature and theme manifests', () => {
  fc.assert(fc.property(manifestArb, m => {
    const json = printManifest(m)
    expect(parseManifest(json)).toEqual({ ok: true, value: m })
    expect(json).toBe(JSON.stringify(JSON.parse(json), null, 2))
  }), runs)
})

// Feature: plugin-system, Property 2: マニフェストの項目値の受理規則
it('Property 2: accepts only valid IDs, versions, ranges and destinations', () => {
  fc.assert(fc.property(featureArb, fc.oneof(fc.string(), versionArb), (s, candidate) => {
    const base = JSON.parse(printManifest(s))
    for (const [field, value, valid] of [
      ['name', s.id, true], ['name', `@scope/${s.id}`, false],
      ['version', candidate, /^\d/.test(candidate) && candidate === candidate.trim() && semver.valid(candidate) !== null],
      ['notyraVersion', candidate, semver.validRange(candidate, { includePrerelease: true }) !== null],
      ['networkDestinations', [`${s.id}x.example.com:65535`], true],
      ['networkDestinations', [`${s.id}x.example.com:65536`], false],
    ] as const) {
      const input = structuredClone(base)
      if (field === 'name' || field === 'version') input[field] = value
      else input.notyra[field] = value
      expect(parseManifest(JSON.stringify(input)).ok).toBe(valid)
    }
  }), runs)
})

// Feature: plugin-system, Property 3: マニフェストのエラー報告
it('Property 3: aggregates independent faults with category, field and value', () => {
  fc.assert(fc.property(featureArb, fc.subarray(['id', 'version', 'main', 'permission'] as const, { minLength: 1 }), (m, faults) => {
    const input = JSON.parse(printManifest(m))
    const errors = []
    if (faults.includes('id')) { input.name = `@scope/${m.id}`; errors.push({ category: 'value', field: 'name', value: input.name }) }
    if (faults.includes('version')) { delete input.version; errors.push({ category: 'structural', field: 'version', value: undefined }) }
    if (faults.includes('main')) { input.notyra.main = 42; errors.push({ category: 'structural', field: 'notyra.main', value: 42 }) }
    if (faults.includes('permission')) { input.notyra.permissions = [{ name: 'unknown' }]; errors.push({ category: 'value', field: 'notyra.permissions[0].name', value: 'unknown' }) }
    const result = parseManifest(JSON.stringify(input))
    expect(result.ok).toBe(false)
    if (!result.ok) for (const error of errors) expect(result.errors).toContainEqual(expect.objectContaining(error))
  }), runs)
})

// Feature: plugin-system, Property 4: 未知の項目の無視
it('Property 4: ignores unknown fields on valid and invalid manifests', () => {
  fc.assert(fc.property(manifestArb, fc.jsonValue(), fc.boolean(), (m, value, invalid) => {
    const input = JSON.parse(printManifest(m))
    if (invalid) input.version = 'invalid'
    const before = parseManifest(JSON.stringify(input))
    input.notyra['unknown-future-field'] = value
    expect(parseManifest(JSON.stringify(input))).toEqual(before)
  }), runs)
})

// Feature: plugin-system, Property 37: Plugin_Settings の値の検証と既定値
it('Property 37: validates values and uses defaults for missing or invalid stored data', () => {
  fc.assert(fc.property(settingArb, fc.oneof(fc.jsonValue(), fc.constant(NaN), fc.constant(Infinity), fc.constant(undefined)), (d, v) => {
    const valid = d.type === 'string' ? typeof v === 'string' : d.type === 'boolean' ? typeof v === 'boolean' : d.type === 'select' ? typeof v === 'string' && d.options.some(o => o.value === v) : (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
    expect(validateSettingValue(d, v).ok).toBe(valid)
    expect(resolveSettingValue(d, undefined)).toBe(d.default)
    const storedValid = d.type === 'number' ? typeof v === 'number' && Number.isFinite(v) : valid
    expect(resolveSettingValue(d, v)).toBe(storedValid ? v : d.default)
  }), runs)
})

// Feature: plugin-system, Property 38: Plugin_Settings のラウンドトリップ
it('Property 38: preserves every setting type through JSON persistence', () => {
  fc.assert(fc.property(settingArb, d => {
    expect(resolveSettingValue(d, JSON.parse(JSON.stringify(d.default)))).toEqual(d.default === 0 ? 0 : d.default)
  }), runs)
})
