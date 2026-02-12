import { useState, useEffect, useRef } from 'react'
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
import { FloatingViewButtons } from './editor/FloatingViewButtons'
import { useTextSelection } from '@/renderer/hooks/useTextSelection'
import { useEditorScrollSync } from '@/renderer/hooks/useEditorScrollSync'
import { useSplitView } from '@/renderer/hooks/useSplitView'
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
}: EditorViewProps) {
  const [localContent, setLocalContent] = useState(content)
  const [currentTheme, setCurrentTheme] = useState(() => {
    const isDark = document.documentElement.classList.contains('dark')
    return isDark ? githubDark : githubLight
  })
  const editorViewRef = useRef<CodemirrorEditorView | null>(null)
  const editorScrollRef = useRef<HTMLDivElement | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  const [showToolbar, setShowToolbar] = useState(false)
  const [toolbarPosition, setToolbarPosition] = useState({ top: 0, left: 0 })
  const [showColorPalette, setShowColorPalette] = useState(false)
  const [showAlertPalette, setShowAlertPalette] = useState(false)
  const [paletteOpenUpward, setPaletteOpenUpward] = useState(false)

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
  } = useTextSelection()

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

  // エディタインスタンスを保存
  const handleEditorCreate = (view: CodemirrorEditorView) => {
    editorViewRef.current = view

    const textSelectionHandler = () => {
      handleTextSelection(
        editorViewRef.current,
        (hasSelection, coords, spaceBelow) => {
          if (hasSelection && coords && spaceBelow !== undefined) {
            setShowColorPalette(false)
            setShowAlertPalette(false)
            setPaletteOpenUpward(spaceBelow < 400)
            setToolbarPosition(coords)
            setShowToolbar(true)
          } else {
            setShowToolbar(false)
            setShowColorPalette(false)
            setShowAlertPalette(false)
          }
        }
      )
    }

    view.dom.addEventListener('mouseup', textSelectionHandler)
    view.dom.addEventListener('keyup', textSelectionHandler)
  }

  const handleApplyFormat = (prefix: string, suffix?: string) => {
    applyFormat(editorViewRef.current, prefix, suffix, () => {
      setShowToolbar(false)
      setShowColorPalette(false)
      setShowAlertPalette(false)
    })
  }

  const handleApplyColor = (color: string) => {
    applyColor(editorViewRef.current, color, () => {
      setShowToolbar(false)
      setShowColorPalette(false)
      setShowAlertPalette(false)
    })
  }

  const handleApplyAlert = (
    type: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION'
  ) => {
    applyAlert(editorViewRef.current, type, () => {
      setShowToolbar(false)
      setShowColorPalette(false)
      setShowAlertPalette(false)
    })
  }

  const handleApplyList = (type: 'bullet' | 'ordered') => {
    applyList(editorViewRef.current, type, () => {
      setShowToolbar(false)
      setShowColorPalette(false)
      setShowAlertPalette(false)
    })
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
              <MarkdownPreview content={localContent} />
            </div>
          </>
        )}

        {layoutMode === 'preview' && (
          <div className="flex-1 overflow-auto">
            <MarkdownPreview content={localContent} />
          </div>
        )}
      </div>

      {showToolbar && (
        <MarkdownToolbar
          onApplyAlert={handleApplyAlert}
          onApplyColor={handleApplyColor}
          onApplyFormat={handleApplyFormat}
          onApplyList={handleApplyList}
          onToggleAlertPalette={() => setShowAlertPalette(!showAlertPalette)}
          onToggleColorPalette={() => setShowColorPalette(!showColorPalette)}
          paletteOpenUpward={paletteOpenUpward}
          position={toolbarPosition}
          showAlertPalette={showAlertPalette}
          showColorPalette={showColorPalette}
        />
      )}

      <FloatingViewButtons
        layoutMode={layoutMode}
        onLayoutModeChange={onLayoutModeChange}
      />
    </div>
  )
}
