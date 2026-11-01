import type { EditorView } from '@codemirror/view'

export interface ScrollAnchor {
  editor: number
  preview: number
}

export type ScrollPane = keyof ScrollAnchor

export interface PreviewScrollAnchor {
  line: number
  top: number
}

type ScrollStrategy = 'nearest' | 'start' | 'end' | 'center'

function alignScrollTarget(
  current: number,
  start: number,
  end: number,
  size: number,
  margin: number,
  strategy: ScrollStrategy
): number {
  if (strategy === 'start') return start - margin
  if (strategy === 'end') return end + margin - size
  if (strategy === 'center') return (start + end - size) / 2
  if (start < current + margin) return start - margin
  if (end > current + size - margin) return end + margin - size
  return current
}

/** CodeMirror skips overflow:hidden ancestors, which split mode uses for native wheel scrolling. */
export function scrollHiddenEditorIntoView(
  view: EditorView,
  position: number,
  options: {
    x: ScrollStrategy
    y: ScrollStrategy
    xMargin: number
    yMargin: number
  },
  onScroll?: () => void
): boolean {
  // scrollHandler runs during CodeMirror's write phase. Measure in the next
  // read phase instead of calling coordsAtPos while an update is in progress.
  let remainingMeasurements = 2
  const measure = {
    key: scrollHiddenEditorIntoView,
    read(current: EditorView) {
      const editor = current.scrollDOM
      const bounds = editor.getBoundingClientRect()
      const pos = Math.min(position, current.state.doc.length)
      const cursor = current.coordsAtPos(pos)
      const block = current.lineBlockAt(pos)
      const target =
        cursor &&
        !(options.y === 'start' && pos === current.state.doc.lineAt(pos).from)
          ? cursor
          : {
              top: current.documentTop + block.top,
              bottom: current.documentTop + block.top + block.height,
            }
      const top = editor.scrollTop + target.top - bounds.top - editor.clientTop
      let left = editor.scrollLeft
      if (cursor) {
        const from =
          editor.scrollLeft + cursor.left - bounds.left - editor.clientLeft
        left = Math.max(
          0,
          Math.min(
            editor.scrollWidth - editor.clientWidth,
            alignScrollTarget(
              left,
              from,
              from + cursor.right - cursor.left,
              editor.clientWidth,
              options.xMargin,
              options.x
            )
          )
        )
      }
      return {
        top: Math.max(
          0,
          Math.min(
            editor.scrollHeight - editor.clientHeight,
            alignScrollTarget(
              editor.scrollTop,
              top,
              top + target.bottom - target.top,
              editor.clientHeight,
              options.yMargin,
              options.y
            )
          )
        ),
        left,
      }
    },
    write(target: { top: number; left: number }, current: EditorView) {
      const moved =
        Math.abs(current.scrollDOM.scrollTop - target.top) > 1 ||
        Math.abs(current.scrollDOM.scrollLeft - target.left) > 1
      current.scrollDOM.scrollTop = target.top
      current.scrollDOM.scrollLeft = target.left
      onScroll?.()
      // Rendering an off-screen line can refine its estimated height. Align
      // again after that measurement so a large heading is fully visible.
      if (moved && --remainingMeasurements > 0) current.requestMeasure(measure)
    },
  }
  view.requestMeasure(measure)
  return true
}

/** Navigate a preview to the rendered block nearest the requested source line. */
export function scrollPreviewToLine(
  preview: HTMLElement,
  line: number
): boolean {
  if (!Number.isFinite(line)) return false
  const lineNumber = Math.max(1, Math.trunc(line))
  const anchors = measurePreviewScrollAnchors(preview)
  if (anchors.length === 0) return false
  let target = anchors[0]
  for (const anchor of anchors) {
    if (anchor.line <= lineNumber && anchor.line >= target.line) target = anchor
  }
  preview.scrollTop = Math.max(
    0,
    Math.min(preview.scrollHeight - preview.clientHeight, target.top)
  )
  return true
}

/** Preview layout is unchanged by scrolling, so measure it only when it changes. */
export function measurePreviewScrollAnchors(
  preview: HTMLElement
): PreviewScrollAnchor[] {
  const origin =
    preview.getBoundingClientRect().top + preview.clientTop - preview.scrollTop
  const anchors: PreviewScrollAnchor[] = []
  const seenLines = new Set<number>()
  for (const element of preview.querySelectorAll<HTMLElement>(
    '[data-source-line]'
  )) {
    const line = Number(element.dataset.sourceLine)
    if (!Number.isInteger(line) || line < 1 || seenLines.has(line)) continue
    const rects = element.getClientRects()
    if (rects.length === 0) continue
    seenLines.add(line)
    anchors.push({ line, top: rects[0].top - origin })
  }
  return anchors
}

/** Measure source lines through CodeMirror, including lines outside its viewport. */
export function measureScrollAnchors(
  view: EditorView,
  editor: HTMLElement,
  preview: HTMLElement,
  previewAnchors = measurePreviewScrollAnchors(preview)
): ScrollAnchor[] {
  const anchors: ScrollAnchor[] = [{ editor: 0, preview: 0 }]
  const editorOrigin =
    view.documentTop -
    editor.getBoundingClientRect().top -
    editor.clientTop +
    editor.scrollTop
  const editorMax = Math.max(0, editor.scrollHeight - editor.clientHeight)
  const previewMax = Math.max(0, preview.scrollHeight - preview.clientHeight)
  // Blend toward the shared endpoint over at least one viewport. A block just
  // above one pane's limit may still leave many blocks in the other pane; using
  // it as the last anchor would turn a small wheel step into a large movement.
  const editorTail = Math.max(0, editorMax - editor.clientHeight)
  const previewTail = Math.max(0, previewMax - preview.clientHeight)
  for (const { line, top } of previewAnchors) {
    if (line > view.state.doc.lines) continue
    const anchor = {
      editor:
        editorOrigin + view.lineBlockAt(view.state.doc.line(line).from).top,
      preview: top,
    }
    const previous = anchors[anchors.length - 1]
    // Nested blocks can share a line; folded lines can share a vertical position.
    if (
      anchor.editor > previous.editor &&
      anchor.preview > previous.preview &&
      anchor.editor <= editorTail &&
      anchor.preview <= previewTail
    ) {
      anchors.push(anchor)
    }
  }

  // Map the scrollable endpoints, not the content bottoms. Otherwise the last
  // viewport needs a discontinuous jump when either pane reaches its limit.
  if (editorMax > 0 && previewMax > 0)
    anchors.push({ editor: editorMax, preview: previewMax })
  return anchors
}

/** Interpolate only between neighboring corresponding Markdown blocks. */
export function mapScrollPosition(
  anchors: readonly ScrollAnchor[],
  source: ScrollPane,
  position: number
): number {
  const target = source === 'editor' ? 'preview' : 'editor'
  if (anchors.length === 0) return 0
  if (position <= anchors[0][source]) return anchors[0][target]
  const last = anchors[anchors.length - 1]
  if (position >= last[source]) return last[target]
  let low = 1
  let high = anchors.length - 1
  while (low < high) {
    const middle = (low + high) >>> 1
    if (anchors[middle][source] < position) low = middle + 1
    else high = middle
  }
  const next = anchors[low]
  const previous = anchors[low - 1]
  const fraction =
    (position - previous[source]) / (next[source] - previous[source])
  return previous[target] + fraction * (next[target] - previous[target])
}
