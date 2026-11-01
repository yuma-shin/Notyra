import { Compartment, EditorState } from '@codemirror/state'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { idArb, runs } from '../../../helpers/pluginArbitraries'
import { createRegistries } from '@/renderer/lib/plugins/host/registries'

function colorTheme(id: string) {
  return {
    id,
    name: id,
    nameJa: id,
    swatches: ['#000'],
    swatchesDark: ['#fff'],
    light: {},
    dark: {},
  }
}

// Feature: plugin-system, Property 29: テーマ ID の一意性
it('Property 29: accepts only theme IDs absent from builtin, custom and prior plugin themes', () => {
  fc.assert(
    fc.property(
      fc.array(idArb, { maxLength: 20 }),
      fc.subarray(['gray', 'custom', 'a']),
      (ids, reserved) => {
        const r = createRegistries({
          platform: 'other',
          getReservedThemeIds: () => reserved,
        })
        const seen = new Set(reserved)
        ids.forEach((id, i) => {
          expect(r.themes.register(`p-${i}`, colorTheme(id)).ok).toBe(
            !seen.has(id)
          )
          seen.add(id)
        })
        const actual = r.themes.getThemes().map(t => t.id)
        expect(new Set([...reserved, ...actual]).size).toBe(
          reserved.length + actual.length
        )
      }
    ),
    runs
  )
})

// Feature: plugin-system, Property 30: テーマの追加CSSは選択中だけ有効
it('Property 30: applies CSS only from the currently selected theme plugin', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(idArb, { maxLength: 12 }),
      fc.nat(),
      (ids, choice) => {
        const doc = document.implementation.createHTMLDocument()
        const r = createRegistries({ platform: 'other', document: doc })
        ids.forEach(id => r.styles.add(id, `/* ${id} */`, { whenThemeId: id }))
        for (const selected of [
          ids[choice % (ids.length || 1)] ?? 'builtin',
          'builtin',
          ...ids,
        ]) {
          r.styles.setActiveThemeId(selected)
          expect(
            [...doc.querySelectorAll('style[data-plugin-id]')].map(el =>
              el.getAttribute('data-plugin-id')
            )
          ).toEqual(ids.includes(selected) ? [selected] : [])
        }
      }
    ),
    runs
  )
})

// Feature: plugin-system, Property 35: エディタ拡張の適用・解除で本文が変わらない
it('Property 35: CodeMirror reconfiguration preserves arbitrary document content', () => {
  fc.assert(
    fc.property(
      fc.string(),
      fc.array(fc.boolean(), { maxLength: 30 }),
      (doc, ops) => {
        const registry = createRegistries({ platform: 'other' }).editorExtensions
        const disposables: Array<{ dispose(): void }> = []
        const compartment = new Compartment()
        let state = EditorState.create({
          doc,
          extensions: [compartment.of([])],
        })
        const normalized = state.doc.toString()
        for (const add of ops) {
          if (add) disposables.push(registry.register('p', EditorState.tabSize.of(8)))
          else disposables.pop()?.dispose()
          state = state.update({
            effects: compartment.reconfigure(
              [...registry.getExtensions()]
            ),
          }).state
          expect(state.doc.toString()).toBe(normalized)
        }
      }
    ),
    runs
  )
})
