import { describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMarkdownProcessing } from '@/renderer/hooks/useMarkdownProcessing'

describe('Markdown preview source positions', () => {
  it('preserves source lines through syntax highlighting, copy buttons, tables and Mermaid', async () => {
    const content =
      '# Heading\n\n```js\nconst x = 1\n```\n\n- parent\n  - child\n\n| A | B |\n| - | - |\n| a | b |\n\n```mermaid\ngraph LR; A-->B\n```'
    const { result } = renderHook(() => useMarkdownProcessing(content))
    await waitFor(() => expect(result.current).toContain('data-source-line'))
    const body = document.createElement('div')
    body.innerHTML = result.current
    expect(body.querySelector('h1')?.getAttribute('data-source-line')).toBe('1')
    expect(
      body
        .querySelector('pre.has-line-numbers')
        ?.getAttribute('data-source-line')
    ).toBe('3')
    expect(body.querySelector('pre .copy-button')).not.toBeNull()
    expect(
      [...body.querySelectorAll('li')].map(el =>
        el.getAttribute('data-source-line')
      )
    ).toEqual(['7', '8'])
    expect(body.querySelector('table')?.getAttribute('data-source-line')).toBe(
      '10'
    )
    expect(
      body.querySelector('tbody tr')?.getAttribute('data-source-line')
    ).toBe('12')
    expect(
      body
        .querySelector('.mermaid-placeholder')
        ?.getAttribute('data-source-line')
    ).toBe('14')
  })
})
