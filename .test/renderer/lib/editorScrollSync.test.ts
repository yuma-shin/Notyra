import { describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  mapScrollPosition,
  measurePreviewScrollAnchors,
  measureScrollAnchors,
  scrollPreviewToLine,
  scrollHiddenEditorIntoView,
} from '@/renderer/lib/editorScrollSync'

describe('Markdown block scroll mapping', () => {
  it('scrolls the hidden split editor using measured cursor geometry and scroll strategies', () => {
    const editor = document.createElement('div')
    Object.defineProperties(editor, {
      scrollHeight: { value: 2000 }, clientHeight: { value: 400 },
      scrollWidth: { value: 1200 }, clientWidth: { value: 300 },
    })
    vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue({ top: 50, left: 30 } as DOMRect)
    const view = {
      scrollDOM: editor,
      state: EditorState.create({ doc: 'a'.repeat(100) }),
      lineBlockAt: () => ({ top: 1000, height: 20 }),
      requestMeasure(request: { read(view: EditorView): unknown; write(target: unknown, view: EditorView): void }) {
        const current = this as unknown as EditorView
        request.write(request.read(current), current)
      },
      coordsAtPos: () => ({ top: 1050 - editor.scrollTop, bottom: 1070 - editor.scrollTop, left: 630 - editor.scrollLeft, right: 640 - editor.scrollLeft }),
    } as unknown as EditorView
    for (const [strategy, top, left] of [
      ['start', 995, 595], ['end', 625, 315], ['center', 810, 455], ['nearest', 625, 315],
    ] as const) {
      editor.scrollTop = 0
      editor.scrollLeft = 0
      expect(scrollHiddenEditorIntoView(view, 10, { x: strategy, y: strategy, xMargin: 5, yMargin: 5 })).toBe(true)
      expect(editor.scrollTop).toBe(top)
      expect(editor.scrollLeft).toBe(left)
    }
    editor.scrollTop = 800
    expect(scrollHiddenEditorIntoView(view, 10, { x: 'nearest', y: 'nearest', xMargin: 5, yMargin: 5 })).toBe(true)
    expect(editor.scrollTop).toBe(800)
    const virtualized = {
      ...view, coordsAtPos: () => null,
      get documentTop() { return 50 - editor.scrollTop },
      lineBlockAt: () => ({ top: 1000, height: 20 }),
    } as unknown as EditorView
    expect(scrollHiddenEditorIntoView(virtualized, 10, { x: 'start', y: 'start', xMargin: 5, yMargin: 5 })).toBe(true)
    expect(editor.scrollTop).toBe(995)
  })

  it('measures after the update and realigns a heading after virtualized heights change', () => {
    const editor = document.createElement('div')
    Object.defineProperties(editor, {
      scrollHeight: { value: 2000 }, clientHeight: { value: 400 },
    })
    vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue({ top: 50 } as DOMRect)
    const pending: Array<{
      read(view: EditorView): { top: number; left: number }
      write(target: { top: number; left: number }, view: EditorView): void
    }> = []
    let blockTop = 1000
    const coordsAtPos = vi.fn(() => ({
      top: 50 + blockTop + 15 - editor.scrollTop,
      bottom: 50 + blockTop + 35 - editor.scrollTop,
      left: 0, right: 1,
    }))
    const view = {
      scrollDOM: editor,
      state: EditorState.create({ doc: '## Heading' }),
      get documentTop() { return 50 - editor.scrollTop },
      lineBlockAt: () => ({ top: blockTop, height: 40 }),
      coordsAtPos,
      requestMeasure: (request: (typeof pending)[number]) => pending.push(request),
    } as unknown as EditorView
    scrollHiddenEditorIntoView(view, 0, {
      x: 'nearest', y: 'start', xMargin: 5, yMargin: 5,
    })
    // Layout cannot be read in scrollHandler's update/write phase.
    expect(coordsAtPos).not.toHaveBeenCalled()
    const flush = () => {
      const request = pending.shift()!
      request.write(request.read(view), view)
    }
    flush()
    expect(editor.scrollTop).toBe(995)
    blockTop = 980
    flush()
    expect(editor.scrollTop).toBe(975)
    expect(pending).toHaveLength(0)
    expect(editor.scrollTop).toBe(975)
  })

  it('navigates preview headings by source line and clamps missing or out-of-range targets', () => {
    const preview = document.createElement('div')
    preview.innerHTML = '<h2 data-source-line="3">One</h2><h2 data-source-line="20">Two</h2>'
    Object.defineProperties(preview, {
      scrollHeight: { value: 1500 },
      clientHeight: { value: 400 },
    })
    vi.spyOn(preview, 'getBoundingClientRect').mockImplementation(
      () => ({ top: 100 }) as DOMRect
    )
    for (const [index, element] of [...preview.children].entries()) {
      vi.spyOn(element, 'getClientRects').mockImplementation(
        () => [{ top: 100 + [200, 1400][index] - preview.scrollTop }] as unknown as DOMRectList
      )
    }
    expect(scrollPreviewToLine(preview, 3)).toBe(true)
    expect(preview.scrollTop).toBe(200)
    expect(scrollPreviewToLine(preview, 20)).toBe(true)
    expect(preview.scrollTop).toBe(1100)
    expect(scrollPreviewToLine(preview, 10)).toBe(true)
    expect(preview.scrollTop).toBe(200)
    expect(scrollPreviewToLine(preview, -1)).toBe(true)
    expect(preview.scrollTop).toBe(200)
    expect(scrollPreviewToLine(preview, Number.NaN)).toBe(false)
    expect(scrollPreviewToLine(document.createElement('div'), 1)).toBe(false)
  })

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
