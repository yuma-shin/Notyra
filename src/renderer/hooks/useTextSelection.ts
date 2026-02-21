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

      if (!text) {
        // 選択なし: カーソル位置にマーカーを挿入しカーソルを内側に置く
        const insert = `${prefix}${suffix}`
        view.dispatch({
          changes: { from: selection.from, to: selection.from, insert },
          selection: { anchor: selection.from + prefix.length },
        })
        onComplete?.()
        view.focus()
        return
      }

      // 既にフォーマット済みか確認
      const beforeText = view.state.sliceDoc(
        Math.max(0, selection.from - prefix.length),
        selection.from
      )
      const afterText = view.state.sliceDoc(
        selection.to,
        Math.min(view.state.doc.length, selection.to + suffix.length)
      )

      if (beforeText === prefix && afterText === suffix) {
        // フォーマット解除
        view.dispatch({
          changes: [
            { from: selection.from - prefix.length, to: selection.from, insert: '' },
            { from: selection.to, to: selection.to + suffix.length, insert: '' },
          ],
          selection: {
            anchor: selection.from - prefix.length,
            head: selection.to - prefix.length,
          },
        })
      } else {
        // フォーマット適用
        const formatted = `${prefix}${text}${suffix}`
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: formatted },
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
        changes: { from: selection.from, to: selection.to, insert: formatted },
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

      let formatted: string
      if (!text) {
        // 選択なし: テンプレートを挿入
        formatted = `> [!${type}]\n> `
        view.dispatch({
          changes: { from: selection.from, to: selection.from, insert: formatted },
          selection: { anchor: selection.from + formatted.length },
        })
      } else {
        formatted = `> [!${type}]\n> ${text.split('\n').join('\n> ')}`
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: formatted },
          selection: { anchor: selection.from, head: selection.from + formatted.length },
        })
      }

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

      if (!text) {
        // 選択なし: 現在行に適用
        const line = view.state.doc.lineAt(selection.from)
        const lineText = line.text
        let newText: string
        if (type === 'bullet') {
          newText = /^- /.test(lineText)
            ? lineText.slice(2)
            : `- ${lineText.replace(/^(- |\d+\. )/, '')}`
        } else {
          newText = /^\d+\. /.test(lineText)
            ? lineText.replace(/^\d+\. /, '')
            : `1. ${lineText.replace(/^(- |\d+\. )/, '')}`
        }
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: newText },
          selection: { anchor: line.from + newText.length },
        })
        onComplete?.()
        view.focus()
        return
      }

      const lines = text.split('\n')
      const nonEmptyLines = lines.filter(line => !/^\s*$/.test(line))
      const allBullet =
        nonEmptyLines.length > 0 &&
        nonEmptyLines.every(line => /^- /.test(line))
      const allOrdered =
        nonEmptyLines.length > 0 &&
        nonEmptyLines.every(line => /^\d+\. /.test(line))

      let transformed: string[]

      if (type === 'bullet' && allBullet) {
        transformed = lines.map(line =>
          /^- /.test(line) ? line.slice(2) : line
        )
      } else if (type === 'ordered' && allOrdered) {
        transformed = lines.map(line =>
          /^\d+\. /.test(line) ? line.replace(/^\d+\. /, '') : line
        )
      } else if (type === 'bullet') {
        transformed = lines.map(line => {
          if (/^\s*$/.test(line)) return line
          const content = line.replace(/^(- |\d+\. )/, '')
          return `- ${content}`
        })
      } else {
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
        changes: { from: selection.from, to: selection.to, insert: result },
        selection: { anchor: selection.from, head: selection.from + result.length },
      })

      onComplete?.()
      view.focus()
    },
    []
  )

  const applyHeading = useCallback(
    (
      editorView: EditorView | null,
      level: 1 | 2 | 3 | 4 | 5 | 6,
      onComplete?: () => void
    ) => {
      if (!editorView) return
      const view = editorView
      const selection = view.state.selection.main
      const text = view.state.sliceDoc(selection.from, selection.to)

      const prefix = `${'#'.repeat(level)} `

      if (!text) {
        // 選択なし: 現在行に適用
        const line = view.state.doc.lineAt(selection.from)
        const lineText = line.text
        const alreadyPrefixed = lineText.startsWith(prefix)
        const newText = alreadyPrefixed
          ? lineText.slice(prefix.length)
          : `${prefix}${lineText.replace(/^#{1,6} /, '')}`
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: newText },
          selection: { anchor: line.from + newText.length },
        })
        onComplete?.()
        view.focus()
        return
      }

      const lines = text.split('\n')
      const nonEmptyLines = lines.filter(line => !/^\s*$/.test(line))
      const allPrefixed =
        nonEmptyLines.length > 0 &&
        nonEmptyLines.every(line => line.startsWith(prefix))

      const transformed = allPrefixed
        ? lines.map(line =>
            line.startsWith(prefix) ? line.slice(prefix.length) : line
          )
        : lines.map(line => {
            if (/^\s*$/.test(line)) return line
            return `${prefix}${line.replace(/^#{1,6} /, '')}`
          })

      const result = transformed.join('\n')
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: result },
        selection: { anchor: selection.from, head: selection.from + result.length },
      })
      onComplete?.()
      view.focus()
    },
    []
  )

  const applyQuote = useCallback(
    (editorView: EditorView | null, onComplete?: () => void) => {
      if (!editorView) return
      const view = editorView
      const selection = view.state.selection.main
      const text = view.state.sliceDoc(selection.from, selection.to)

      const prefix = '> '

      if (!text) {
        // 選択なし: 現在行に適用
        const line = view.state.doc.lineAt(selection.from)
        const lineText = line.text
        const alreadyPrefixed = lineText.startsWith(prefix)
        const newText = alreadyPrefixed ? lineText.slice(prefix.length) : `${prefix}${lineText}`
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: newText },
          selection: { anchor: line.from + newText.length },
        })
        onComplete?.()
        view.focus()
        return
      }

      const lines = text.split('\n')
      const nonEmptyLines = lines.filter(line => !/^\s*$/.test(line))
      const allPrefixed =
        nonEmptyLines.length > 0 &&
        nonEmptyLines.every(line => line.startsWith(prefix))

      const transformed = allPrefixed
        ? lines.map(line =>
            line.startsWith(prefix) ? line.slice(prefix.length) : line
          )
        : lines.map(line => (/^\s*$/.test(line) ? line : `${prefix}${line}`))

      const result = transformed.join('\n')
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: result },
        selection: { anchor: selection.from, head: selection.from + result.length },
      })
      onComplete?.()
      view.focus()
    },
    []
  )

  const applyCheckbox = useCallback(
    (editorView: EditorView | null, onComplete?: () => void) => {
      if (!editorView) return
      const view = editorView
      const selection = view.state.selection.main
      const text = view.state.sliceDoc(selection.from, selection.to)

      if (!text) {
        // 選択なし: 現在行に適用
        const line = view.state.doc.lineAt(selection.from)
        const lineText = line.text
        let newText: string
        if (/^- \[[ x]\] /.test(lineText)) {
          newText = lineText.replace(/^- \[[ x]\] /, '')
        } else {
          const content = lineText.replace(/^(- \[[ x]\] |[-*+] |\d+\. )/, '')
          newText = `- [ ] ${content}`
        }
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: newText },
          selection: { anchor: line.from + newText.length },
        })
        onComplete?.()
        view.focus()
        return
      }

      const lines = text.split('\n')
      const nonEmptyLines = lines.filter(line => !/^\s*$/.test(line))
      const allCheckbox =
        nonEmptyLines.length > 0 &&
        nonEmptyLines.every(line => /^- \[[ x]\] /.test(line))

      const transformed = allCheckbox
        ? lines.map(line => line.replace(/^- \[[ x]\] /, ''))
        : lines.map(line => {
            if (/^\s*$/.test(line)) return line
            const content = line.replace(/^(- \[[ x]\] |[-*+] |\d+\. )/, '')
            return `- [ ] ${content}`
          })

      const result = transformed.join('\n')
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: result },
        selection: { anchor: selection.from, head: selection.from + result.length },
      })
      onComplete?.()
      view.focus()
    },
    []
  )

  const applyTable = useCallback(
    (
      editorView: EditorView | null,
      dataRows: number,
      cols: number,
      onComplete?: () => void
    ) => {
      if (!editorView) return
      const view = editorView
      const selection = view.state.selection.main

      const headerCells = Array.from({ length: cols }, (_, i) => `Col${i + 1}`)
      const header = `| ${headerCells.join(' | ')} |`
      const separator = `| ${Array(cols).fill('---').join(' | ')} |`
      const dataRow = `| ${Array(cols).fill('   ').join(' | ')} |`
      const rows = [header, separator, ...Array(dataRows).fill(dataRow)]
      const table = `${rows.join('\n')}\n`

      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert: table },
        selection: { anchor: selection.from + table.length },
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
    applyHeading,
    applyQuote,
    applyCheckbox,
    applyTable,
  }
}
