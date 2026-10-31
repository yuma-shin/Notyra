import * as CMState from '@codemirror/state'
import * as React from 'react'
import { describe, expect, it } from 'vitest'
import {
  buildSharedModuleExports,
  getExportNames,
  isIdentifierName,
  isValidSharedModuleName,
  SHARED_MODULES,
  sharedModuleFileName,
  sharedModulePath,
} from '@/renderer/lib/plugins/host/sharedModules'

describe('SHARED_MODULES', () => {
  it('本体と同一のインスタンスを提供する', () => {
    expect(SHARED_MODULES.react).toBe(React)
    expect(SHARED_MODULES['@codemirror/state']).toBe(CMState)
  })

  it('すべてのモジュール名が Rust 側の検証規則を満たす', () => {
    for (const name of Object.keys(SHARED_MODULES)) {
      expect(isValidSharedModuleName(name)).toBe(true)
    }
  })
})

describe('sharedModuleFileName / sharedModulePath', () => {
  it('/ を __ に置き換えて .js を付ける', () => {
    expect(sharedModuleFileName('react')).toBe('react.js')
    expect(sharedModuleFileName('react/jsx-runtime')).toBe(
      'react__jsx-runtime.js'
    )
    expect(sharedModuleFileName('@codemirror/state')).toBe(
      '@codemirror__state.js'
    )
    expect(sharedModuleFileName('@scope/a/b')).toBe('@scope__a__b.js')
  })

  it('/@shared/ 配下のパスを返す', () => {
    expect(sharedModulePath('@codemirror/state')).toBe(
      '/@shared/@codemirror__state.js'
    )
  })
})

describe('isValidSharedModuleName', () => {
  it.each([
    'react',
    'react-dom/client',
    '@codemirror/state',
    '@lezer/highlight',
  ])('%s を受け付ける', name => {
    expect(isValidSharedModuleName(name)).toBe(true)
  })

  it.each(['', '@', 'React', 'a//b', '/a', 'a/', 'a/../b', 'a__b', 'a b'])(
    '%s を拒否する',
    name => {
      expect(isValidSharedModuleName(name)).toBe(false)
    }
  )
})

describe('getExportNames', () => {
  it('識別子として有効な名前だけを、default と __esModule を除いて昇順で返す', () => {
    const mod = {
      default: 1,
      __esModule: true,
      useState: 1,
      class: 1,
      $x: 1,
      'not-valid': 1,
      '1abc': 1,
      日本語: 1,
      Fragment: 1,
    }
    expect(getExportNames(mod)).toEqual(['$x', 'Fragment', 'class', 'useState'])
  })

  it('isIdentifierName は予約語を拒否しない', () => {
    expect(isIdentifierName('class')).toBe(true)
    expect(isIdentifierName('')).toBe(false)
  })
})

describe('buildSharedModuleExports', () => {
  it('すべての共有モジュールについて export 名一覧を返す', () => {
    const result = buildSharedModuleExports()
    expect(Object.keys(result).sort()).toEqual(
      Object.keys(SHARED_MODULES).sort()
    )
    expect(result.react).toContain('useState')
    expect(result.react).not.toContain('default')
    expect(result['@codemirror/state']).toContain('EditorState')
    expect(result['@codemirror/view']).toContain('EditorView')
    expect(result['react/jsx-runtime']).toContain('jsx')
  })
})
