import { describe, expect, it } from 'vitest'
import { filterRegistry, parseRegistry } from '@/renderer/lib/plugins/registry'
import type { RegistryEntry } from '@/shared/plugin/types'

const toc: RegistryEntry = {
  id: 'notyra-toc',
  name: '目次',
  description: '見出しから目次をサイドパネルに表示します',
  author: 'Jane Doe',
  repo: 'someone/notyra-toc',
}
const ai: RegistryEntry = {
  id: 'notyra-ai',
  name: 'AI Assistant',
  description: 'Summarize notes with an LLM',
  author: 'John',
  repo: 'https://github.com/john/notyra-ai',
}

describe('parseRegistry', () => {
  it('有効なレジストリをエントリ列に変換する', () => {
    const json = JSON.stringify({ schemaVersion: 1, plugins: [toc, ai] })
    expect(parseRegistry(json)).toEqual({ ok: true, value: [toc, ai] })
  })

  it('0件のレジストリを受け付ける', () => {
    expect(parseRegistry('{"schemaVersion":1,"plugins":[]}')).toEqual({
      ok: true,
      value: [],
    })
  })

  it('エントリの未知の項目を除いて返す', () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      plugins: [{ ...toc, stars: 10 }],
    })
    expect(parseRegistry(json)).toEqual({ ok: true, value: [toc] })
  })

  it('不正な JSON は失敗する', () => {
    const result = parseRegistry('{')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].code).toBe('invalidJson')
  })

  it.each([
    ['オブジェクト以外', '[]'],
    ['schemaVersion なし', JSON.stringify({ plugins: [] })],
    ['schemaVersion が 2', JSON.stringify({ schemaVersion: 2, plugins: [] })],
    ['schemaVersion が文字列', JSON.stringify({ schemaVersion: '1', plugins: [] })],
    ['plugins なし', JSON.stringify({ schemaVersion: 1 })],
    ['plugins が配列以外', JSON.stringify({ schemaVersion: 1, plugins: {} })],
  ])('%s は失敗する', (_label, json) => {
    expect(parseRegistry(json).ok).toBe(false)
  })

  it('1つでも不正な要素があれば全体を失敗とし、項目名と値を報告する', () => {
    const { author: _author, ...withoutAuthor } = ai
    const json = JSON.stringify({
      schemaVersion: 1,
      plugins: [toc, withoutAuthor, { ...toc, name: 42 }, { ...toc, repo: 'bad' }, null],
    })
    const result = parseRegistry(json)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toEqual([
      {
        category: 'structural',
        field: 'plugins[1].author',
        value: undefined,
        code: 'missingField',
      },
      {
        category: 'structural',
        field: 'plugins[2].name',
        value: 42,
        code: 'typeMismatch',
      },
      {
        category: 'value',
        field: 'plugins[3].repo',
        value: 'bad',
        code: 'invalidId',
      },
      {
        category: 'structural',
        field: 'plugins[4]',
        value: null,
        code: 'typeMismatch',
      },
    ])
  })
})

describe('filterRegistry', () => {
  const entries = [toc, ai]

  it.each(['', '   ', '\t'])('検索語 %j は全件を返す', query => {
    expect(filterRegistry(entries, query)).toEqual(entries)
  })

  it('名前を大文字小文字を区別せず部分一致で検索する', () => {
    expect(filterRegistry(entries, '  assist ')).toEqual([ai])
  })

  it('説明も検索対象にする', () => {
    expect(filterRegistry(entries, '見出し')).toEqual([toc])
    expect(filterRegistry(entries, 'LLM')).toEqual([ai])
  })

  it('作者やリポジトリは検索対象にしない', () => {
    expect(filterRegistry(entries, 'jane')).toEqual([])
  })

  it('元の順序を維持する', () => {
    const other = { ...toc, id: 'other', name: 'Another', description: '' }
    expect(filterRegistry([other, toc, ai], 'a')).toEqual([other, ai])
    expect(filterRegistry([ai, toc, other], 'a')).toEqual([ai, other])
  })
})
