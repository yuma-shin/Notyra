import { useCallback } from 'react'
import type { EditorView } from '@codemirror/view'

type ListType = 'bullet' | 'ordered'

export function useTextSelection() {
  const handleTextSelection = useCallback(
    (
      editorView: EditorView | null,
      onSelectionChange: (
        hasSelection: boolean,
        coords?: { top: number; left: number },
        spaceBelow?: number
      ) => void
    ) => {
      if (!editorView) return

      const selection = editorView.state.selection.main
      const text = editorView.state.sliceDoc(selection.from, selection.to)

      if (text?.trim()) {
        const coords = editorView.coordsAtPos(selection.from)
        if (coords) {
          const windowHeight = window.innerHeight
          const spaceBelow = windowHeight - coords.top
          onSelectionChange(
            true,
            { top: coords.top - 60, left: coords.left },
            spaceBelow
          )
        }
      } else {
        onSelectionChange(false)
      }
    },
    []
  )

  const applyFormat = useCallback(
    (
      editorView: EditorView | null,
      prefix: string,
      suffix: string = prefix,
      onComplete?: () => void
    ) => {
      if (!editorView) return

      const view = editorView
      const selection = view.state.selection.main
      const text = view.state.sliceDoc(selection.from, selection.to)

      if (!text) return

      // Check if already formatted
      const beforeText = view.state.sliceDoc(
        Math.max(0, selection.from - prefix.length),
        selection.from
      )
      const afterText = view.state.sliceDoc(
        selection.to,
        Math.min(view.state.doc.length, selection.to + suffix.length)
      )

      if (beforeText === prefix && afterText === suffix) {
        // Remove formatting
        view.dispatch({
          changes: [
            {
              from: selection.from - prefix.length,
              to: selection.from,
              insert: '',
            },
            {
              from: selection.to,
              to: selection.to + suffix.length,
              insert: '',
            },
          ],
          selection: {
            anchor: selection.from - prefix.length,
            head: selection.to - prefix.length,
          },
        })
      } else {
        // Add formatting
        const formatted = `${prefix}${text}${suffix}`

        view.dispatch({
          changes: {
            from: selection.from,
            to: selection.to,
            insert: formatted,
          },
          selection: {
            anchor: selection.from + prefix.length,
            head: selection.to + prefix.length,
          },
        })
      }

      onComplete?.()
      view.focus()
    },
    []
  )

  const applyColor = useCallback(
    (editorView: EditorView | null, color: string, onComplete?: () => void) => {
      if (!editorView) return

      const view = editorView
      const selection = view.state.selection.main
      const text = view.state.sliceDoc(selection.from, selection.to)

      if (!text) return

      const formatted = `<span style="color: ${color};">${text}</span>`

      view.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: formatted,
        },
        selection: {
          anchor: selection.from,
          head: selection.from + formatted.length,
        },
      })

      onComplete?.()
      view.focus()
    },
    []
  )

  const applyAlert = useCallback(
    (
      editorView: EditorView | null,
      type: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION',
      onComplete?: () => void
    ) => {
      if (!editorView) return

      const view = editorView
      const selection = view.state.selection.main
      const text = view.state.sliceDoc(selection.from, selection.to)

      if (!text) return

      const formatted = `> [!${type}]\n> ${text.split('\n').join('\n> ')}`

      view.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: formatted,
        },
        selection: {
          anchor: selection.from,
          head: selection.from + formatted.length,
        },
      })

      onComplete?.()
      view.focus()
    },
    []
  )

  const applyList = useCallback(
    (
      editorView: EditorView | null,
      type: ListType,
      onComplete?: () => void
    ) => {
      if (!editorView) return

      const view = editorView
      const selection = view.state.selection.main
      const text = view.state.sliceDoc(selection.from, selection.to)

      if (!text) return

      const lines = text.split('\n')

      // Analyze each line
      const nonEmptyLines = lines.filter(line => !/^\s*$/.test(line))
      const allBullet =
        nonEmptyLines.length > 0 &&
        nonEmptyLines.every(line => /^- /.test(line))
      const allOrdered =
        nonEmptyLines.length > 0 &&
        nonEmptyLines.every(line => /^\d+\. /.test(line))

      let transformed: string[]

      if (type === 'bullet' && allBullet) {
        // Toggle off: remove bullet prefix
        transformed = lines.map(line =>
          /^- /.test(line) ? line.slice(2) : line
        )
      } else if (type === 'ordered' && allOrdered) {
        // Toggle off: remove ordered prefix
        transformed = lines.map(line =>
          /^\d+\. /.test(line) ? line.replace(/^\d+\. /, '') : line
        )
      } else if (type === 'bullet') {
        // Apply bullet: strip any existing list prefix, add `- `
        transformed = lines.map(line => {
          if (/^\s*$/.test(line)) return line
          const content = line.replace(/^(- |\d+\. )/, '')
          return `- ${content}`
        })
      } else {
        // Apply ordered: strip any existing list prefix, add `N. `
        let counter = 0
        transformed = lines.map(line => {
          if (/^\s*$/.test(line)) return line
          counter++
          const content = line.replace(/^(- |\d+\. )/, '')
          return `${counter}. ${content}`
        })
      }

      const result = transformed.join('\n')

      view.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: result,
        },
        selection: {
          anchor: selection.from,
          head: selection.from + result.length,
        },
      })

      onComplete?.()
      view.focus()
    },
    []
  )

  return {
    handleTextSelection,
    applyFormat,
    applyColor,
    applyAlert,
    applyList,
  }
}
