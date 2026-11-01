import { describe, expect, it } from 'vitest'
import {
  type KeyEventLike,
  keyEventToKeys,
  normalizeKey,
} from '@/renderer/lib/plugins/keybindings'

function ev(init: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...init,
  }
}

describe('keyEventToKeys', () => {
  it('normalizeKey と同じ形式のキーを返す', () => {
    expect(
      keyEventToKeys(ev({ key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true }))
    ).toEqual([normalizeKey('Mod-Shift-k', 'other')])
    expect(
      keyEventToKeys(ev({ key: 'k', code: 'KeyK', metaKey: true }))
    ).toEqual([normalizeKey('Mod-k', 'mac')])
    expect(keyEventToKeys(ev({ key: 'ArrowLeft', altKey: true }))).toEqual([
      normalizeKey('Alt-ArrowLeft', 'other'),
    ])
    expect(keyEventToKeys(ev({ key: ' ', code: 'Space', ctrlKey: true }))).toEqual(
      [normalizeKey('Ctrl-Space', 'other')]
    )
  })

  it('修飾キーで入力文字が変わった場合は物理キーの文字を候補に加える', () => {
    expect(
      keyEventToKeys(ev({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }))
    ).toEqual([
      normalizeKey('Ctrl-Shift-!', 'other'),
      normalizeKey('Ctrl-Shift-1', 'other'),
    ])
    expect(
      keyEventToKeys(ev({ key: '˚', code: 'KeyK', altKey: true }))
    ).toEqual([normalizeKey('Alt-˚', 'mac'), normalizeKey('Alt-k', 'mac')])
  })

  it('修飾キーだけの押下や IME 処理中のキーは空配列', () => {
    expect(keyEventToKeys(ev({ key: 'Control', ctrlKey: true }))).toEqual([])
    expect(keyEventToKeys(ev({ key: 'Shift', shiftKey: true }))).toEqual([])
    expect(keyEventToKeys(ev({ key: 'Process' }))).toEqual([])
  })
})
