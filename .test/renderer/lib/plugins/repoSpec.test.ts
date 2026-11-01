import { describe, expect, it } from 'vitest'
import { parseRepoSpec } from '@/renderer/lib/plugins/repoSpec'

describe('parseRepoSpec', () => {
  it.each([
    'owner/repo',
    '  owner/repo  ',
    'https://github.com/owner/repo',
    'https://github.com/owner/repo/',
    'https://github.com/owner/repo.git',
    'https://github.com/owner/repo.git/',
  ])('%s を owner/repo に解析する', input => {
    expect(parseRepoSpec(input)).toEqual({ owner: 'owner', repo: 'repo' })
  })

  it('リポジトリ名の . _ - を受け付ける', () => {
    expect(parseRepoSpec('my-org/notyra.plugin_toc')).toEqual({
      owner: 'my-org',
      repo: 'notyra.plugin_toc',
    })
  })

  it.each(['', '   ', '\t\n'])('空または空白のみ %j は empty', input => {
    expect(parseRepoSpec(input)).toEqual({ error: 'empty' })
  })

  it.each([
    'owner',
    'owner/repo/extra',
    'owner/',
    '/repo',
    'own er/repo',
    'owner/..',
    'owner/.',
    'http://github.com/owner/repo',
    'https://gitlab.com/owner/repo',
    'https://github.com/owner',
    'github.com/owner/repo',
  ])('%s は format', input => {
    expect(parseRepoSpec(input)).toEqual({ error: 'format' })
  })
})
