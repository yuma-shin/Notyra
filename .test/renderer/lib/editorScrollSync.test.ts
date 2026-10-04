import { describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  mapScrollPosition,
  measurePreviewScrollAnchors,
  measureScrollAnchors,
} from '@/renderer/lib/editorScrollSync'

describe('Markdown block scroll mapping', () => {
  const anchors = [
    { editor: 0, preview: 0 },
    { editor: 500, preview: 1200 },
    { editor: 1500, preview: 1600 },
    { editor: 2000, preview: 3000 },
  ]

  it('aligns matching blocks even when their proportions of total height differ', () => {
    expect(mapScrollPosition(anchors, 'editor', 500)).toBe(1200)
    expect(mapScrollPosition(anchors, 'preview', 1600)).toBe(1500)
    expect(mapScrollPosition(anchors, 'editor', 1000)).toBe(1400)
    expect(mapScrollPosition(anchors, 'preview', 1400)).toBe(1000)
  })

  it('clamps positions outside the document and handles missing anchors', () => {
    expect(mapScrollPosition(anchors, 'editor', -10)).toBe(0)
    expect(mapScrollPosition(anchors, 'preview', 5000)).toBe(2000)
    expect(mapScrollPosition([], 'editor', 100)).toBe(0)
  })

  it('measures off-screen source lines and ignores duplicate, hidden and stale blocks', () => {
    const editor = document.createElement('div')
    const preview = document.createElement('div')
    editor.scrollTop = 100
    preview.scrollTop = 200
    vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue({
      top: 50,
    } as DOMRect)
    vi.spyOn(preview, 'getBoundingClientRect').mockReturnValue({
      top: 50,
    } as DOMRect)
    Object.defineProperty(editor, 'scrollHeight', { value: 1000 })
    Object.defineProperty(preview, 'scrollHeight', { value: 2000 })
    preview.innerHTML =
      '<h1 data-source-line="1"></h1><li data-source-line="3"><p data-source-line="3"></p></li><p data-source-line="4"></p><p data-source-line="99"></p>'
    for (const [index, element] of [
      ...preview.children,
      preview.querySelector('li p'),
    ].entries()) {
      vi.spyOn(element as HTMLElement, 'getBoundingClientRect').mockReturnValue(
        { top: 100 + index * 100 } as DOMRect
      )
      vi.spyOn(element as HTMLElement, 'getClientRects').mockReturnValue(
        (index === 2
          ? []
          : [{ top: 100 + index * 100 }]) as unknown as DOMRectList
      )
    }
    const state = EditorState.create({ doc: 'heading\n\nlist\nhidden' })
    const lineBlockAt = vi.fn((position: number) => ({
      top: state.doc.lineAt(position).number * 50,
    }))
    const view = {
      state,
      documentTop: -45,
      lineBlockAt,
    } as unknown as EditorView
    expect(measureScrollAnchors(view, editor, preview)).toEqual([
      { editor: 0, preview: 0 },
      { editor: 55, preview: 250 },
      { editor: 155, preview: 350 },
      { editor: 1000, preview: 2000 },
    ])
    expect(lineBlockAt).toHaveBeenCalledTimes(2)
    const cachedPreview = measurePreviewScrollAnchors(preview)
    const query = vi.spyOn(preview, 'querySelectorAll')
    query.mockClear()
    expect(measureScrollAnchors(view, editor, preview, cachedPreview)).toEqual([
      { editor: 0, preview: 0 },
      { editor: 55, preview: 250 },
      { editor: 155, preview: 350 },
      { editor: 1000, preview: 2000 },
    ])
    expect(query).not.toHaveBeenCalled()
  })

  it('finds every matching block and its surrounding interval in a large document', () => {
    const large = Array.from({ length: 10001 }, (_, i) => ({
      editor: i * 20,
      preview: i * 35,
    }))
    for (const i of [1, 2, 499, 5000, 9999]) {
      expect(mapScrollPosition(large, 'editor', i * 20)).toBe(i * 35)
      expect(mapScrollPosition(large, 'preview', i * 35 + 17.5)).toBe(
        i * 20 + 10
      )
    }
    expect(mapScrollPosition([{ editor: 0, preview: 0 }], 'editor', 100)).toBe(
      0
    )
  })

  it('uses scrollable endpoints and drops blocks inside the final viewport', () => {
    const editor = document.createElement('div')
    const preview = document.createElement('div')
    Object.defineProperties(editor, {
      scrollHeight: { value: 2000 },
      clientHeight: { value: 400 },
    })
    Object.defineProperties(preview, {
      scrollHeight: { value: 3000 },
      clientHeight: { value: 400 },
    })
    const state = EditorState.create({
      doc: 'heading\nparagraph\nlast heading\nlast paragraph',
    })
    const view = {
      state,
      documentTop: 0,
      lineBlockAt: (position: number) => ({
        top: [0, 500, 1500, 1800][state.doc.lineAt(position).number - 1],
      }),
    } as unknown as EditorView
    const anchors = measureScrollAnchors(view, editor, preview, [
      { line: 1, top: 32 },
      { line: 2, top: 1200 },
      { line: 3, top: 1600 },
      { line: 4, top: 2800 },
    ])
    expect(anchors).toEqual([
      { editor: 0, preview: 0 },
      { editor: 500, preview: 1200 },
      { editor: 1600, preview: 2600 },
    ])
    expect(mapScrollPosition(anchors, 'editor', 1599)).toBeCloseTo(2598.7272727)
    expect(mapScrollPosition(anchors, 'editor', 1600)).toBe(2600)
    expect(mapScrollPosition(anchors, 'preview', 2600)).toBe(1600)
    // A near-end heading must not amplify one pixel into a ten-pixel jump.
    expect(
      mapScrollPosition(anchors, 'editor', 1600) -
        mapScrollPosition(anchors, 'editor', 1599)
    ).toBeLessThan(2)
  })
})
