import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MarkdownExtensionRegistry } from '@/renderer/lib/plugins/host/registries'
import { useMarkdownProcessing } from '@/renderer/hooks/useMarkdownProcessing'
import { usePdfExport } from '@/renderer/hooks/usePdfExport'
const pdf = vi.hoisted(() => vi.fn(async () => ({ success: true })))
vi.mock('@/renderer/lib/tauriApi', () => ({ tauriApi: { export: { pdf } } }))

it('applies plugin Markdown extensions to PDF exports', async () => {
  const registry = new MarkdownExtensionRegistry()
  registry.registerRehype('pdf-plugin', () => (tree: { children: unknown[] }) => {
    tree.children.push({ type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: 'PDF plugin extension' }] })
  })
  mocked.host = { registries: { markdown: registry }, reportError: vi.fn() }
  const hook = renderHook(() => usePdfExport())
  await act(async () => { expect(await hook.result.current.exportPdf('# Title', undefined, 'Title')).toEqual({ success: true }) })
  expect(pdf).toHaveBeenCalledWith(expect.stringContaining('<p>PDF plugin extension</p>'), 'Title')
})

const mocked = vi.hoisted(() => ({ host: null as unknown }))
vi.mock('@/renderer/contexts/PluginHostContext', () => ({
  usePluginHost: () => mocked.host,
}))
afterEach(() => {
  cleanup()
  mocked.host = null
})

it('reprocesses on registration and disposal, keeps the last HTML after errors, and retries only on the next edit', async () => {
  const registry = new MarkdownExtensionRegistry(),
    reportError = vi.fn()
  mocked.host = { registries: { markdown: registry }, reportError }
  const hook = renderHook(({ content }) => useMarkdownProcessing(content), {
    initialProps: { content: '# First' },
  })
  await waitFor(() => expect(hook.result.current).toContain('First'))
  const calls = vi.fn()
  let dispose!: { dispose(): void }
  act(() => {
    dispose = registry.registerRemark('good', () => () => {
      calls()
    })
  })
  await waitFor(() => expect(calls).toHaveBeenCalled())
  const oldHtml = hook.result.current
  const bad = vi.fn(() => {
    throw new Error('bad markdown')
  })
  act(() => {
    registry.registerRemark('bad', () => bad)
  })
  await waitFor(() =>
    expect(reportError).toHaveBeenCalledWith(
      'bad',
      'markdown',
      expect.any(Error)
    )
  )
  expect(hook.result.current).toBe(oldHtml)
  expect(bad).toHaveBeenCalledTimes(1)
  hook.rerender({ content: '# Second' })
  await waitFor(() => expect(hook.result.current).toContain('Second'))
  expect(bad).toHaveBeenCalledTimes(1)
  const count = calls.mock.calls.length
  act(() => {
    dispose.dispose()
  })
  await act(async () => {
    await Promise.resolve()
  })
  expect(calls).toHaveBeenCalledTimes(count)
})
