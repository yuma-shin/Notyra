import { act, cleanup, fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { useEditorScrollSync } from '@/renderer/hooks/useEditorScrollSync'
import {
  measurePreviewScrollAnchors,
  measureScrollAnchors,
} from '@/renderer/lib/editorScrollSync'

const measured = vi.hoisted(() => ({
  anchors: [
    { editor: 0, preview: 0 },
    { editor: 500, preview: 1200 },
    { editor: 1000, preview: 1600 },
    { editor: 1600, preview: 2600 },
  ],
}))

vi.mock('@/renderer/lib/editorScrollSync', async importOriginal => {
  const original =
    await importOriginal<typeof import('@/renderer/lib/editorScrollSync')>()
  return {
    ...original,
    measureScrollAnchors: vi.fn(() =>
      measured.anchors.map(anchor => ({ ...anchor }))
    ),
    measurePreviewScrollAnchors: vi.fn(() => [{ line: 1, top: 32 }]),
  }
})

describe('split-view bidirectional scrolling', () => {
  let frames: Map<number, FrameRequestCallback>
  let resizeCallback: () => void
  let disconnect: ReturnType<typeof vi.fn>
  beforeEach(() => {
    measured.anchors[1].preview = 1200
    vi.clearAllMocks()
    frames = new Map()
    let id = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resizeCallback = callback
        }
        observe() {}
        disconnect = disconnect
      }
    )
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  function flushFrame() {
    act(() => {
      const callbacks = [...frames.values()]
      frames.clear()
      for (const callback of callbacks) callback(0)
    })
  }
  function setup() {
    const editor = document.createElement('div')
    const preview = document.createElement('div')
    preview.innerHTML =
      '<div data-split-preview><div class="markdown-body"><h1 data-source-line="1">Title</h1></div></div>'
    preview.append(editor)
    Object.defineProperties(editor, {
      scrollHeight: { value: 2000 },
      clientHeight: { value: 400 },
    })
    Object.defineProperties(preview, {
      scrollHeight: { value: 3000 },
      clientHeight: { value: 400 },
    })
    const editorRef = { current: editor }
    const previewRef = { current: preview }
    const viewRef = { current: { scrollDOM: editor } as EditorView }
    const hook = renderHook(
      ({ mode }: { mode: 'split' | 'editor' }) =>
        useEditorScrollSync(mode, editorRef, previewRef, viewRef),
      { initialProps: { mode: 'split' } }
    )
    flushFrame()
    // Keyboard/selection scrolling in the editor still drives the preview.
    fireEvent.keyDown(editor, { key: 'PageDown' })
    return { editor, preview, ...hook }
  }

  it('aligns local blocks in both directions and suppresses feedback from its own scroll', () => {
    const { editor, preview, result } = setup()
    editor.scrollTop = 500
    act(() => result.current.handleEditorScroll())
    flushFrame()
    expect(preview.scrollTop).toBe(1200)
    act(() => result.current.handlePreviewScroll())
    expect(frames.size).toBe(0)
    expect(editor.scrollTop).toBe(500)

    preview.scrollTop = 1400
    fireEvent.wheel(preview)
    act(() => result.current.handlePreviewScroll())
    flushFrame()
    expect(editor.scrollTop).toBe(750)
    act(() => result.current.handleEditorScroll())
    expect(frames.size).toBe(0)
  })

  it('allows the user to take over the target before the generated scroll event arrives', () => {
    const { editor, preview, result } = setup()
    editor.scrollTop = 500
    act(() => result.current.handleEditorScroll())
    flushFrame()
    preview.scrollTop = 1600
    fireEvent.wheel(preview)
    act(() => result.current.handlePreviewScroll())
    flushFrame()
    expect(editor.scrollTop).toBe(1000)
  })

  it('resynchronizes after layout changes from the last pane the user scrolled', () => {
    const { editor, preview, result } = setup()
    preview.scrollTop = 1400
    fireEvent.wheel(preview)
    act(() => result.current.handlePreviewScroll())
    flushFrame()
    measured.anchors[1].preview = 1400
    act(() => resizeCallback())
    flushFrame()
    expect(editor.scrollTop).toBe(500)
    expect(preview.scrollTop).toBe(1400)
  })

  it('aligns document endpoints and stops synchronizing outside split mode', () => {
    const { editor, preview, result, rerender } = setup()
    editor.scrollTop = 1600
    act(() => result.current.handleEditorScroll())
    flushFrame()
    expect(preview.scrollTop).toBe(2600)
    act(() => result.current.handlePreviewScroll())
    preview.scrollTop = 0
    fireEvent.wheel(preview)
    act(() => result.current.handlePreviewScroll())
    flushFrame()
    expect(editor.scrollTop).toBe(0)
    rerender({ mode: 'editor' })
    editor.scrollTop = 500
    act(() => result.current.handleEditorScroll())
    expect(frames.size).toBe(0)
    expect(disconnect).toHaveBeenCalled()
  })

  it('approaches the bottom continuously instead of snapping at the last pixel', () => {
    const { editor, preview, result } = setup()
    const positions: number[] = []
    for (const top of [1598, 1599, 1600]) {
      editor.scrollTop = top
      act(() => result.current.handleEditorScroll())
      flushFrame()
      positions.push(preview.scrollTop)
    }
    expect(positions[2]).toBe(2600)
    expect(positions[2] - positions[1]).toBeCloseTo(positions[1] - positions[0])
    expect(positions[2] - positions[1]).toBeLessThan(2)
  })

  it('cancels a queued synchronization when the view unmounts', () => {
    const { editor, result, unmount } = setup()
    act(() => resizeCallback())
    editor.scrollTop = 500
    act(() => result.current.handleEditorScroll())
    expect(frames.size).toBe(1)
    unmount()
    expect(frames.size).toBe(0)
  })

  it('reuses measured positions across scrolling and switching the driving pane', () => {
    const { editor, preview, result } = setup()
    for (const position of [100, 200, 300, 500]) {
      editor.scrollTop = position
      act(() => result.current.handleEditorScroll())
      flushFrame()
    }
    fireEvent.wheel(preview)
    preview.scrollTop = 1400
    act(() => result.current.handlePreviewScroll())
    flushFrame()
    expect(editor.scrollTop).toBe(750)
    expect(measurePreviewScrollAnchors).toHaveBeenCalledTimes(1)
    expect(measureScrollAnchors).toHaveBeenCalledTimes(1)
    act(() => resizeCallback())
    flushFrame()
    expect(measurePreviewScrollAnchors).toHaveBeenCalledTimes(2)
    expect(measureScrollAnchors).toHaveBeenCalledTimes(2)
  })

  it('coalesces scroll events into one frame and uses the latest position', () => {
    const { editor, preview, result } = setup()
    for (const top of [100, 200, 500]) {
      editor.scrollTop = top
      act(() => result.current.handleEditorScroll())
    }
    expect(frames.size).toBe(1)
    flushFrame()
    expect(preview.scrollTop).toBe(1200)
    expect(frames.size).toBe(0)
    fireEvent.keyDown(preview, { key: 'PageDown' })
    preview.scrollTop = 1400
    act(() => result.current.handlePreviewScroll())
    flushFrame()
    expect(editor.scrollTop).toBe(750)
    expect(frames.size).toBe(0)
  })

  it('rebuilds editor positions after virtualized line measurements without remeasuring the preview', () => {
    const { editor, preview, result } = setup()
    // Read the actual listener extension through a CodeMirror state.
    const configured = EditorState.create({
      extensions: [result.current.scrollSyncExtension],
    })
    for (const listener of configured.facet(EditorView.updateListener)) {
      listener({
        geometryChanged: true,
        docChanged: false,
        selectionSet: false,
      } as Parameters<typeof listener>[0])
    }
    editor.scrollTop = 500
    act(() => result.current.handleEditorScroll())
    flushFrame()
    expect(preview.scrollTop).toBe(1200)
    expect(measurePreviewScrollAnchors).toHaveBeenCalledTimes(1)
    expect(measureScrollAnchors).toHaveBeenCalledTimes(2)
  })

  it('does not let delayed follower height corrections interrupt the driving pane', () => {
    const { editor, preview, result } = setup()
    editor.scrollTop = 500
    act(() => result.current.handleEditorScroll())
    flushFrame()
    act(() => result.current.handlePreviewScroll())
    // The follower moves again after its virtualized line heights are refined.
    preview.scrollTop = 1300
    act(() => result.current.handlePreviewScroll())
    flushFrame()
    expect(editor.scrollTop).toBe(500)
    expect(frames.size).toBe(0)
    fireEvent.pointerDown(preview)
    act(() => result.current.handlePreviewScroll())
    flushFrame()
    expect(editor.scrollTop).toBe(625)
  })

  it('uses the common scroller for wheel and touch over either pane without writing its position back', () => {
    const { editor, preview, result } = setup()
    for (const event of ['wheel', 'touchStart'] as const) {
      for (const pane of [editor, preview]) {
        fireEvent[event](pane)
        preview.scrollTop = 1400
        act(() => result.current.handlePreviewScroll())
        flushFrame()
        expect(editor.scrollTop).toBe(750)
        // A subsequent CodeMirror height correction must leave native scrolling alone.
        editor.scrollTop = 775
        act(() => result.current.handleEditorScroll())
        flushFrame()
        expect(preview.scrollTop).toBe(1400)
      }
    }
  })

  it('keeps preview measurements cached when virtualized editor DOM is replaced', async () => {
    const { editor, preview, result } = setup()
    editor.append(document.createElement('div'))
    await act(async () => {})
    fireEvent.wheel(editor)
    preview.scrollTop = 1400
    act(() => result.current.handlePreviewScroll())
    flushFrame()
    expect(measurePreviewScrollAnchors).toHaveBeenCalledTimes(1)
    preview.querySelector('[data-split-preview]')!.append(document.createElement('p'))
    await act(async () => {})
    flushFrame()
    expect(measurePreviewScrollAnchors).toHaveBeenCalledTimes(2)
  })
})
