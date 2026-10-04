import { useCallback, useEffect, useMemo, useRef } from 'react'
import { EditorView } from '@codemirror/view'
import type { AppSettings } from '@/shared/types'
import {
  mapScrollPosition,
  measurePreviewScrollAnchors,
  measureScrollAnchors,
  type PreviewScrollAnchor,
  type ScrollAnchor,
  type ScrollPane,
} from '@/renderer/lib/editorScrollSync'

export function useEditorScrollSync(
  layoutMode: AppSettings['editorLayoutMode'],
  editorScrollRef: React.RefObject<HTMLDivElement | null>,
  previewScrollRef: React.RefObject<HTMLDivElement | null>,
  editorViewRef: React.RefObject<EditorView | null>,
  filePath?: string
) {
  const lastSource = useRef<ScrollPane>('preview')
  const previewAnchors = useRef<PreviewScrollAnchor[] | null>(null)
  const anchors = useRef<ScrollAnchor[] | null>(null)
  const frame = useRef<number | null>(null)

  const synchronize = useCallback(() => {
    const preview = previewScrollRef.current
    const view = editorViewRef.current
    const editor = view?.scrollDOM
    if (layoutMode !== 'split' || !editor || !preview || !view) return

    const sourcePane = lastSource.current
    const source = sourcePane === 'editor' ? editor : preview
    const target = sourcePane === 'editor' ? preview : editor
    const targetMax = Math.max(0, target.scrollHeight - target.clientHeight)
    if (previewAnchors.current === null) {
      previewAnchors.current = measurePreviewScrollAnchors(preview)
    }
    if (anchors.current === null) {
      anchors.current = measureScrollAnchors(
        view,
        editor,
        preview,
        previewAnchors.current
      )
    }

    const mapped = mapScrollPosition(
      anchors.current,
      sourcePane,
      source.scrollTop
    )
    const position = Math.max(0, Math.min(targetMax, mapped))
    if (Math.abs(target.scrollTop - position) < 0.5) return

    target.scrollTop = position
  }, [layoutMode, previewScrollRef, editorViewRef])

  const scheduleSync = useCallback(() => {
    if (layoutMode !== 'split' || frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      synchronize()
    })
  }, [layoutMode, synchronize])

  const invalidateEditor = useCallback(() => {
    // Keep raw Markdown reachable even when it renders to a very short preview
    // (for example, a document containing many blank lines).
    const height = editorViewRef.current?.contentHeight
    if (height !== undefined) {
      previewScrollRef.current?.style.setProperty(
        '--split-content-height',
        `${Math.ceil(height)}px`
      )
    }
    anchors.current = null
    scheduleSync()
  }, [scheduleSync, editorViewRef, previewScrollRef])

  const invalidateLayout = useCallback(() => {
    previewAnchors.current = null
    invalidateEditor()
  }, [invalidateEditor])

  const handleScroll = useCallback(
    (pane: ScrollPane) => {
      const element =
        pane === 'editor' ? editorScrollRef.current : previewScrollRef.current
      if (layoutMode !== 'split' || !element) return
      // Only the pane receiving user input drives synchronization. CodeMirror
      // may adjust the follower again after measuring virtualized lines; that
      // adjustment must not scroll the pane the user is currently operating.
      if (pane !== lastSource.current) return
      scheduleSync()
    },
    [layoutMode, editorScrollRef, previewScrollRef, scheduleSync]
  )

  const handleEditorScroll = useCallback(
    () => handleScroll('editor'),
    [handleScroll]
  )
  const handlePreviewScroll = useCallback(
    () => handleScroll('preview'),
    [handleScroll]
  )

  const scrollSyncExtension = useMemo(
    () => [
      EditorView.domEventHandlers({ scroll: handleEditorScroll }),
      EditorView.updateListener.of(update => {
        // CodeMirror refines off-screen line heights as they enter the viewport.
        if (
          update.docChanged ||
          (update.selectionSet && update.view.hasFocus)
        ) {
          lastSource.current = 'editor'
        }
        if (update.geometryChanged || update.docChanged) invalidateEditor()
      }),
    ],
    [handleEditorScroll, invalidateEditor]
  )

  useEffect(() => {
    lastSource.current = 'preview'
    previewAnchors.current = null
    anchors.current = null
    if (layoutMode !== 'split') return
    const editor = editorScrollRef.current
    const preview = previewScrollRef.current
    if (!editor || !preview) return

    const sizePane = () => {
      preview.style.setProperty(
        '--split-pane-height',
        `${preview.clientHeight}px`
      )
      invalidateLayout()
    }
    sizePane()

    const resize = new ResizeObserver(sizePane)
    resize.observe(editor)
    resize.observe(preview)
    const body = preview.querySelector('.markdown-body')
    if (body) resize.observe(body)
    const previewContent =
      preview.querySelector('[data-split-preview]') ?? preview
    const mutation = new MutationObserver(invalidateLayout)
    // The common scroller also contains CodeMirror. Its virtualized DOM changes
    // during scrolling must not invalidate the unchanged preview measurements.
    mutation.observe(previewContent, { childList: true, subtree: true })
    // Images and Mermaid can change layout after Markdown has been inserted.
    preview.addEventListener('load', invalidateLayout, true)
    const driveEditor = () => {
      lastSource.current = 'editor'
    }
    const drivePreview = () => {
      lastSource.current = 'preview'
    }
    const inputEvents = [
      'wheel',
      'pointerdown',
      'touchstart',
      'keydown',
    ] as const
    for (const event of inputEvents) {
      preview.addEventListener(event, drivePreview, {
        passive: true,
        capture: true,
      })
      // Wheel and touch use the common native scroller, including over the
      // editor. Cursor movement and selection can still scroll CodeMirror.
      if (event === 'pointerdown' || event === 'keydown') {
        editor.addEventListener(event, driveEditor, {
          passive: true,
          capture: true,
        })
      }
    }
    scheduleSync()
    return () => {
      resize.disconnect()
      mutation.disconnect()
      preview.removeEventListener('load', invalidateLayout, true)
      for (const event of inputEvents) {
        editor.removeEventListener(event, driveEditor, true)
        preview.removeEventListener(event, drivePreview, true)
      }
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [
    layoutMode,
    filePath,
    editorScrollRef,
    previewScrollRef,
    scheduleSync,
    invalidateLayout,
  ])

  return { handleEditorScroll, handlePreviewScroll, scrollSyncExtension }
}
