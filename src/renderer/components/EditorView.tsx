import { useState, useEffect, useRef, useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { githubLight, githubDark } from '@uiw/codemirror-theme-github'
import { EditorView as CodemirrorEditorView } from '@codemirror/view'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { languages } from '@codemirror/language-data'
import { MarkdownPreview } from './MarkdownPreview'
import { MetadataEditor } from './MetadataEditor'
import { MarkdownToolbar } from './editor/MarkdownToolbar'
import { SelectionToolbar } from './editor/SelectionToolbar'
import { FloatingViewButtons } from './editor/FloatingViewButtons'
import { useTextSelection } from '@/renderer/hooks/useTextSelection'
import { useEditorScrollSync } from '@/renderer/hooks/useEditorScrollSync'
import { useSplitView } from '@/renderer/hooks/useSplitView'
import { useImageInsertion } from '@/renderer/hooks/useImageInsertion'
import { usePdfExport } from '@/renderer/hooks/usePdfExport'
import type { AppSettings, MarkdownNoteMeta, FolderNode } from '@/shared/types'

const lineWrapping = CodemirrorEditorView.lineWrapping

const markdownStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '2em', fontWeight: '700' },
  { tag: tags.heading2, fontSize: '1.5em', fontWeight: '700' },
  { tag: tags.heading3, fontSize: '1.25em', fontWeight: '700' },
  { tag: tags.heading4, fontSize: '1em', fontWeight: '700' },
  { tag: tags.heading5, fontSize: '0.875em', fontWeight: '700' },
  {
    tag: tags.heading6,
    fontSize: '0.85em',
    fontWeight: '700',
    color: '#656d76',
  },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through', opacity: '0.7' },
  { tag: tags.link, color: '#0969da', textDecoration: 'underline' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.85em' },
])

interface EditorViewProps {
  content: string
  onChange: (content: string) => void
  layoutMode: AppSettings['editorLayoutMode']
  onLayoutModeChange: (mode: AppSettings['editorLayoutMode']) => void
  noteMeta?: MarkdownNoteMeta
  onMetadataChange?: (title: string, tags: string[]) => void
  onNoteMove?: (targetFolder: string) => void
  showSidebar?: boolean
  showNoteList?: boolean
  onToggleSidebar?: () => void
  onToggleNoteList?: () => void
  isStandaloneWindow?: boolean
  folderTree?: FolderNode
  currentFolder?: string
  isSaving?: boolean
  rootDir?: string
  allNotes?: MarkdownNoteMeta[]
}

export function EditorView({
  content,
  onChange,
  layoutMode,
  onLayoutModeChange,
  noteMeta,
  onMetadataChange,
  onNoteMove,
  showSidebar: _showSidebar = true,
  showNoteList: _showNoteList = true,
  isStandaloneWindow: _isStandaloneWindow = false,
  onToggleSidebar: _onToggleSidebar,
  onToggleNoteList: _onToggleNoteList,
  folderTree,
  currentFolder,
  isSaving = false,
  rootDir,
  allNotes,
}: EditorViewProps) {
  const allTags = useMemo(() => {
    if (!allNotes) return []
    const tagSet = new Set<string>()
    allNotes.forEach(note => note.tags?.forEach(tag => tagSet.add(tag)))
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'ja'))
  }, [allNotes])

  const [localContent, setLocalContent] = useState(content)
  const [currentTheme, setCurrentTheme] = useState(() => {
    const isDark = document.documentElement.classList.contains('dark')
    return isDark ? githubDark : githubLight
  })
  const editorViewRef = useRef<CodemirrorEditorView | null>(null)
  const editorScrollRef = useRef<HTMLDivElement | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const [showColorPalette, setShowColorPalette] = useState(false)
  const [showAlertPalette, setShowAlertPalette] = useState(false)
  const [showHeadingPalette, setShowHeadingPalette] = useState(false)
  const [showTablePicker, setShowTablePicker] = useState(false)
  const [showSelectionToolbar, setShowSelectionToolbar] = useState(false)
  const [selectionToolbarPos, setSelectionToolbarPos] = useState({
    top: 0,
    left: 0,
  })

  // Custom hooks
  const { splitPosition, isDragging, containerRef, setIsDragging } =
    useSplitView()
  const { handleEditorScroll, handlePreviewScroll } = useEditorScrollSync(
    layoutMode,
    editorScrollRef,
    previewScrollRef
  )
  const {
    handleTextSelection,
    applyFormat,
    applyColor,
    applyAlert,
    applyList,
    applyHeading,
    applyQuote,
    applyCheckbox,
    applyTable,
  } = useTextSelection()

  // Derive noteBaseName from noteMeta filePath (filename without extension)
  const noteBaseName = noteMeta
    ? noteMeta.filePath
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        ?.replace(/\.md$/, '')
    : undefined

  const { imageHandlerExtension, handleToolbarImageInsert, isInserting } =
    useImageInsertion({
      rootDir,
      noteBaseName,
      editorViewRef,
    })

  const {
    exportPdf,
    isExporting: isPdfExporting,
    exportHtml,
    isHtmlExporting,
  } = usePdfExport()

  const handleExportPdf = async () => {
    const title = noteMeta?.title || noteBaseName || 'untitled'
    await exportPdf(localContent, rootDir, title)
  }

  const handleExportHtml = async () => {
    const title = noteMeta?.title || noteBaseName || 'untitled'
    await exportHtml(localContent, rootDir, title)
  }

  useEffect(() => {
    setLocalContent(content)
  }, [content])

  // テーマ変更を監視
  useEffect(() => {
    const updateTheme = () => {
      const isDark = document.documentElement.classList.contains('dark')
      setCurrentTheme(isDark ? githubDark : githubLight)
    }

    updateTheme()

    const observer = new MutationObserver(updateTheme)

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => observer.disconnect()
  }, [])

  const handleChange = (value: string) => {
    setLocalContent(value)
    onChange(value)
  }

  const closeAllPalettes = () => {
    setShowColorPalette(false)
    setShowAlertPalette(false)
    setShowHeadingPalette(false)
    setShowTablePicker(false)
  }

  // エディタインスタンスを保存
  const handleEditorCreate = (view: CodemirrorEditorView) => {
    editorViewRef.current = view

    // エディタをクリックしたらパレットをすべて閉じる
    view.dom.addEventListener('mousedown', closeAllPalettes)

    // テキスト選択でフローティングツールバーを表示
    const onSelectionChange = () => {
      handleTextSelection(editorViewRef.current, (hasSelection, coords) => {
        if (hasSelection && coords) {
          setSelectionToolbarPos(coords)
          setShowSelectionToolbar(true)
        } else {
          setShowSelectionToolbar(false)
        }
      })
    }
    view.dom.addEventListener('mouseup', onSelectionChange)
    view.dom.addEventListener('keyup', onSelectionChange)
  }

  const handleApplyFormat = (prefix: string, suffix?: string) => {
    applyFormat(editorViewRef.current, prefix, suffix, closeAllPalettes)
  }

  const handleApplyColor = (color: string) => {
    applyColor(editorViewRef.current, color, closeAllPalettes)
  }

  const handleApplyAlert = (
    type: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION'
  ) => {
    applyAlert(editorViewRef.current, type, closeAllPalettes)
  }

  const handleApplyList = (type: 'bullet' | 'ordered') => {
    applyList(editorViewRef.current, type, closeAllPalettes)
  }

  const handleApplyHeading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
    applyHeading(editorViewRef.current, level, closeAllPalettes)
  }

  const handleApplyQuote = () => {
    applyQuote(editorViewRef.current, closeAllPalettes)
  }

  const handleApplyCheckbox = () => {
    applyCheckbox(editorViewRef.current, closeAllPalettes)
  }

  const handleApplyTable = (dataRows: number, cols: number) => {
    applyTable(editorViewRef.current, dataRows, cols, closeAllPalettes)
  }

  return (
    <div
      className="group/editor-view flex flex-col h-full w-full overflow-hidden relative"
      ref={containerRef}
    >
      {/* 保存中プログレスバー */}
      {isSaving && (
        <div className="absolute top-0 left-0 right-0 z-50 h-0.5 bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-500 via-purple-400 to-purple-500 animate-[progress_1s_ease-in-out_infinite]"
            style={{
              width: '40%',
              animation: 'progress 1s ease-in-out infinite',
            }}
          ></div>
        </div>
      )}

      {noteMeta && onMetadataChange && (
        <MetadataEditor
          allTags={allTags}
          currentFolder={currentFolder}
          filePath={noteMeta.filePath}
          folderTree={folderTree}
          onMove={onNoteMove}
          onSave={(title: string, tags: string[]) =>
            onMetadataChange(title, tags)
          }
          tags={noteMeta.tags || []}
          title={noteMeta.title}
        />
      )}

      {/* 固定ツールバー (プレビューモード以外で表示) */}
      {layoutMode !== 'preview' && (
        <MarkdownToolbar
          isHtmlExporting={isHtmlExporting}
          isImageInserting={isInserting}
          isPdfExporting={isPdfExporting}
          onApplyAlert={handleApplyAlert}
          onApplyCheckbox={handleApplyCheckbox}
          onApplyColor={handleApplyColor}
          onApplyFormat={handleApplyFormat}
          onApplyHeading={handleApplyHeading}
          onApplyList={handleApplyList}
          onApplyQuote={handleApplyQuote}
          onApplyTable={handleApplyTable}
          onHtmlExport={handleExportHtml}
          onImageInsert={handleToolbarImageInsert}
          onPdfExport={handleExportPdf}
          onToggleAlertPalette={() => {
            setShowColorPalette(false)
            setShowHeadingPalette(false)
            setShowTablePicker(false)
            setShowAlertPalette(v => !v)
          }}
          onToggleColorPalette={() => {
            setShowAlertPalette(false)
            setShowHeadingPalette(false)
            setShowTablePicker(false)
            setShowColorPalette(v => !v)
          }}
          onToggleHeadingPalette={() => {
            setShowColorPalette(false)
            setShowAlertPalette(false)
            setShowTablePicker(false)
            setShowHeadingPalette(v => !v)
          }}
          onToggleTablePicker={() => {
            setShowColorPalette(false)
            setShowAlertPalette(false)
            setShowHeadingPalette(false)
            setShowTablePicker(v => !v)
          }}
          showAlertPalette={showAlertPalette}
          showColorPalette={showColorPalette}
          showHeadingPalette={showHeadingPalette}
          showTablePicker={showTablePicker}
        />
      )}

      <div className="flex-1 flex min-h-0 bg-white dark:bg-[#0d1117]">
        {layoutMode === 'editor' && (
          <div className="flex-1 overflow-auto">
            <CodeMirror
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLineGutter: true,
                highlightActiveLine: true,
                bracketMatching: true,
                syntaxHighlighting: true,
              }}
              extensions={[
                markdown({ codeLanguages: languages }),
                lineWrapping,
                syntaxHighlighting(markdownStyle),
                imageHandlerExtension,
              ]}
              onChange={handleChange}
              onCreateEditor={handleEditorCreate}
              theme={currentTheme}
              value={localContent}
            />
          </div>
        )}

        {layoutMode === 'split' && (
          <>
            <div
              className="overflow-auto hide-scrollbar"
              onScroll={handleEditorScroll}
              ref={editorScrollRef}
              style={{ width: `${splitPosition}%`, flexShrink: 0 }}
            >
              <CodeMirror
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLineGutter: true,
                  highlightActiveLine: true,
                  bracketMatching: true,
                  syntaxHighlighting: true,
                }}
                extensions={[
                  markdown({ codeLanguages: languages }),
                  lineWrapping,
                  syntaxHighlighting(markdownStyle),
                  imageHandlerExtension,
                ]}
                onChange={handleChange}
                onCreateEditor={handleEditorCreate}
                theme={currentTheme}
                value={localContent}
              />
            </div>

            <button
              aria-label="Resize editor and preview panes"
              className={`w-0.5 ${
                isDragging
                  ? 'bg-blue-500 dark:bg-blue-400'
                  : 'bg-gray-300 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-600'
              } cursor-col-resize flex-shrink-0 transition-colors`}
              onMouseDown={e => {
                e.preventDefault()
                setIsDragging(true)
              }}
              type="button"
            />

            <div
              className="flex-1 overflow-auto"
              onScroll={handlePreviewScroll}
              ref={previewScrollRef}
            >
              <MarkdownPreview
                content={localContent}
                noteDir={rootDir}
                onChange={handleChange}
              />
            </div>
          </>
        )}

        {layoutMode === 'preview' && (
          <div className="flex-1 overflow-auto">
            <MarkdownPreview
              content={localContent}
              noteDir={rootDir}
              onChange={handleChange}
            />
          </div>
        )}
      </div>

      {showSelectionToolbar && (
        <SelectionToolbar
          onApplyAlert={handleApplyAlert}
          onApplyCheckbox={handleApplyCheckbox}
          onApplyColor={handleApplyColor}
          onApplyFormat={handleApplyFormat}
          onApplyList={handleApplyList}
          onApplyQuote={handleApplyQuote}
          position={selectionToolbarPos}
        />
      )}

      <FloatingViewButtons
        layoutMode={layoutMode}
        onLayoutModeChange={onLayoutModeChange}
      />
    </div>
  )
}
