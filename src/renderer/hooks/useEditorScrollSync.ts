import { useCallback } from 'react'
import type { AppSettings } from '@/shared/types'

export function useEditorScrollSync(
  layoutMode: AppSettings['editorLayoutMode'],
  editorScrollRef: React.RefObject<HTMLDivElement | null>,
  previewScrollRef: React.RefObject<HTMLDivElement | null>
) {
  const handleEditorScroll = useCallback(
    (_event?: React.UIEvent<HTMLDivElement>) => {
      if (layoutMode !== 'split') return

      const editorElement = editorScrollRef.current
      const previewElement = previewScrollRef.current

      if (!editorElement || !previewElement) return

      const scrollPercentage =
        editorElement.scrollTop /
        (editorElement.scrollHeight - editorElement.clientHeight)

      const targetScroll =
        scrollPercentage *
        (previewElement.scrollHeight - previewElement.clientHeight)

      previewElement.scrollTop = targetScroll
    },
    [layoutMode, editorScrollRef, previewScrollRef]
  )

  const handlePreviewScroll = useCallback(
    (_event?: React.UIEvent<HTMLDivElement>) => {
      if (layoutMode !== 'split') return

      const editorElement = editorScrollRef.current
      const previewElement = previewScrollRef.current

      if (!editorElement || !previewElement) return

      const scrollPercentage =
        previewElement.scrollTop /
        (previewElement.scrollHeight - previewElement.clientHeight)

      const targetScroll =
        scrollPercentage *
        (editorElement.scrollHeight - editorElement.clientHeight)

      editorElement.scrollTop = targetScroll
    },
    [layoutMode, editorScrollRef, previewScrollRef]
  )

  return {
    handleEditorScroll,
    handlePreviewScroll,
  }
}
