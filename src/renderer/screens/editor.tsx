import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CustomTitleBar } from '../components/CustomTitleBar'
import { EditorView } from '../components/EditorView'
import { StatusBar } from '../components/StatusBar'
import { useApp } from '../contexts/AppContext'
import { PluginHostProvider } from '../contexts/PluginHostContext'
import { ToastProvider } from '../components/ui/toast'
import { useEditorStatus } from '@/renderer/hooks/useEditorStatus'
import { useAppVersion } from '@/renderer/hooks/useAppVersion'
import { useActiveNoteEvents } from '@/renderer/hooks/useActiveNoteEvents'
import { useNoteFileSync } from '@/renderer/hooks/useNoteFileSync'
import type { MarkdownNoteMeta } from '@/shared/types'
import type {
  EditorCursorPosition,
  SelectionStats,
} from '@/renderer/lib/codemirror/editorStatus'
import { tauriApi as App } from '@/renderer/lib/tauriApi'

export function EditorScreen() {
  return (
    <ToastProvider>
      <PluginHostProvider windowKind="note">
        <EditorScreenContent />
      </PluginHostProvider>
    </ToastProvider>
  )
}

function EditorScreenContent() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { t } = useTranslation()
  const [note, setNote] = useState<MarkdownNoteMeta | null>(null)
  const [noteContent, setNoteContent] = useState<string>('')
  const [contentNotePath, setContentNotePath] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isDeleted, setIsDeleted] = useState(false)
  const [layoutMode, setLayoutMode] = useState<'editor' | 'preview' | 'split'>(
    'split'
  )
  const noteRef = useRef<MarkdownNoteMeta | null>(null)
  const { settings } = useApp()
  const rootParam = searchParams.get('root')
  const rootDir = rootParam ? decodeURIComponent(rootParam) : undefined
  const editorStats = useEditorStatus(noteContent)
  const version = useAppVersion()
  const [cursor, setCursor] = useState<EditorCursorPosition | null>(null)
  const [selectionStats, setSelectionStats] = useState<SelectionStats | null>(
    null
  )

  const {
    session: saves,
    isLocked,
    isSaving,
  } = useNoteFileSync({
    path: note?.filePath ?? null,
    onSaved: () => setSaveError(null),
    onError: error =>
      setSaveError(error instanceof Error ? error.message : String(error)),
    onRebind: path => {
      if (path !== noteRef.current?.filePath) {
        setSearchParams(
          previous => {
            const next = new URLSearchParams(previous)
            if (path) next.set('note', encodeURIComponent(path))
            else next.delete('note')
            return next
          },
          { replace: true }
        )
      }
      setIsDeleted(path === null)
      const next =
        noteRef.current && path
          ? { ...noteRef.current, filePath: path, id: path }
          : null
      noteRef.current = next
      setNote(next)
      setContentNotePath(null)
    },
    onReload: content => {
      noteRef.current = content?.meta ?? null
      setNote(content?.meta ?? null)
      setNoteContent(content?.content ?? '')
      setContentNotePath(content?.meta.filePath ?? null)
    },
  })

  // パス変更後も、そのパスの本文を読み終わるまで通知を待つ。
  useActiveNoteEvents({
    windowKind: 'note',
    path: note?.filePath ?? null,
    title: note?.title ?? '',
    rootFolder: rootDir ?? '',
    body: noteContent,
    bodyPath: contentNotePath,
  })

  // ノート切り替え時に前ノートのカーソル/選択状態をリセットする
  useEffect(() => {
    setCursor(null)
    setSelectionStats(null)
  }, [note?.filePath])

  // テーマをドキュメントに適用
  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'dark') {
      root.classList.add('dark')
    } else if (settings.theme === 'light') {
      root.classList.remove('dark')
    } else {
      // システムテーマに従う
      const prefersDark = window.matchMedia(
        '(prefers-color-scheme: dark)'
      ).matches
      if (prefersDark) {
        root.classList.add('dark')
      } else {
        root.classList.remove('dark')
      }
    }
  }, [settings.theme])

  useEffect(() => {
    let cancelled = false
    const notePath = searchParams.get('note')
    if (notePath) {
      const path = decodeURIComponent(notePath)
      saves.bind(path)
      const version = saves.version
      void App.markdown
        .getNoteContent(path)
        .then(content => {
          if (cancelled || !content || saves.version !== version) return
          noteRef.current = content.meta
          setNoteContent(content.content)
          setContentNotePath(content.meta.filePath)
          setIsDeleted(false)
          setNote(content.meta)
        })
        .catch(error => setSaveError(String(error)))
    }
    return () => {
      cancelled = true
    }
  }, [searchParams, saves])

  const handleContentChange = (content: string) => {
    if (saves.schedule(content)) {
      setNoteContent(content)
      setContentNotePath(noteRef.current?.filePath ?? null)
    }
  }

  if (!note) {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
        <CustomTitleBar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-600 dark:text-gray-400">
              {isDeleted ? t('editor.noteDeleted') : t('common.loading')}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white dark:bg-gray-900">
      <CustomTitleBar />
      <div className="px-6 py-2 border-b border-gray-200 dark:border-gray-700">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          {note.title}
        </h1>
      </div>
      <div className="flex-1 flex overflow-hidden">
        <EditorView
          content={noteContent}
          filePath={note?.filePath}
          isSaving={isSaving}
          isStandaloneWindow={true}
          layoutMode={layoutMode}
          noteMeta={note}
          onChange={handleContentChange}
          onCursorChange={setCursor}
          onLayoutModeChange={setLayoutMode}
          onSaveErrorDismiss={() => {
            void saves
              .retryReconcile()
              .then(() => setSaveError(null))
              .catch(error => setSaveError(String(error)))
          }}
          onSelectionStatsChange={setSelectionStats}
          readOnly={isLocked}
          rootDir={rootDir}
          saveError={saveError}
        />
      </div>
      <StatusBar
        cursor={cursor}
        selectionStats={selectionStats}
        stats={editorStats}
        version={version}
      />
    </div>
  )
}
