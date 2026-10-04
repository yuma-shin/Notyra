import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@/renderer/components/EditorView'
import { measureScrollAnchors } from '@/renderer/lib/editorScrollSync'

vi.mock('@/renderer/lib/editorScrollSync', async importOriginal => {
  const original =
    await importOriginal<typeof import('@/renderer/lib/editorScrollSync')>()
  return {
    ...original,
    measurePreviewScrollAnchors: () => [{ line: 1, top: 32 }],
    measureScrollAnchors: vi.fn(() => [
      { editor: 0, preview: 0 },
      { editor: 500, preview: 1200 },
      { editor: 1600, preview: 2600 },
    ]),
  }
})
afterEach(cleanup)

describe('split editor scroll container', () => {
  it('shares the native scroller and keeps CodeMirror keyboard scrolling synchronized', async () => {
    render(
      <EditorView
        content={'# Heading\n\nBody'}
        layoutMode="split"
        onChange={() => {}}
        onLayoutModeChange={() => {}}
      />
    )
    const scroller = document.querySelector('.cm-scroller') as HTMLElement
    const editor = document.querySelector('.cm-editor') as HTMLElement
    const pane = editor.parentElement!.parentElement!
    const preview = document.querySelector('[data-split-preview]')!.parentElement!.parentElement! as HTMLElement
    Object.defineProperties(scroller, {
      scrollHeight: { value: 2000 },
      clientHeight: { value: 400 },
    })
    Object.defineProperties(pane, {
      scrollHeight: { value: 9000 },
      clientHeight: { value: 400 },
    })
    Object.defineProperties(preview, {
      scrollHeight: { value: 3000 },
      clientHeight: { value: 400 },
    })
    expect(getComputedStyle(editor).height).toBe('100%')
    expect(pane.classList.contains('overflow-hidden')).toBe(true)
    expect(pane.classList.contains('sticky')).toBe(true)
    expect(preview.contains(pane)).toBe(true)
    expect(scroller.classList.contains('split-editor-scroller')).toBe(true)
    fireEvent.wheel(scroller)
    preview.scrollTop = 1200
    fireEvent.scroll(preview)
    await waitFor(() => expect(scroller.scrollTop).toBe(500))
    fireEvent.keyDown(scroller, { key: 'PageDown' })
    scroller.scrollTop = 500
    fireEvent.scroll(scroller)
    await waitFor(() => expect(preview.scrollTop).toBe(1200))
    expect(measureScrollAnchors).toHaveBeenCalledWith(
      expect.anything(),
      scroller,
      preview,
      expect.anything()
    )
    expect(pane.scrollTop).toBe(0)
  })
})
