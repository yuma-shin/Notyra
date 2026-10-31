import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CustomTitleBar } from '../components/CustomTitleBar'
import { EditorView } from '../components/EditorView'
import { StatusBar } from '../components/StatusBar'
import { useApp } from '../contexts/AppContext'
import { PluginHostProvider } from '../contexts/PluginHostContext'
import { ToastProvider } from '../components/ui/toast'
import { useEditorStatus } from '@/renderer/hooks/useEditorStatus'
import { useAppVersion } from '@/renderer/hooks/useAppVersion'
import { useActiveNoteEvents } from '@/renderer/hooks/useActiveNoteEvents'
import { invalidateEditorStateCache } from '@/renderer/hooks/useEditorStateCache'
import type { MarkdownNoteMeta } from '@/shared/types'
import type {
  EditorCursorPosition,
  SelectionStats,
} from '@/renderer/lib/codemirror/editorStatus'
import { tauriApi as App } from '@/renderer/lib/tauriApi'

const EXTERNAL_CHANGE_COOLDOWN_MS = 5000

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
  const [searchParams] = useSearchParams()
  const [note, setNote] = useState<MarkdownNoteMeta | null>(null)
  const [noteContent, setNoteContent] = useState<string>('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [layoutMode, setLayoutMode] = useState<'editor' | 'preview' | 'split'>(
    'split'
  )
  const saveTimeoutRef = useRef<number | undefined>(undefined)
  const lastSaveTimeRef = useRef<number>(0)
  const lastLocalEditTimeRef = useRef<number>(0)
  const lastLocalWriteTimeRef = useRef<number>(0)
  const reloadTimeoutRef = useRef<number | undefined>(undefined)
  const { settings } = useApp()
  const rootParam = searchParams.get('root')
  const rootDir = rootParam ? decodeURIComponent(rootParam) : undefined
  const editorStats = useEditorStatus(noteContent)
  const version = useAppVersion()
  const [cursor, setCursor] = useState<EditorCursorPosition | null>(null)
  const [selectionStats, setSelectionStats] = useState<SelectionStats | null>(
    null
  )

  // Active_Note_Event の発行。note と noteContent は同時に設定されるため、
  // 本文は常に表示中のノートのものとして扱う
  useActiveNoteEvents({
    windowKind: 'note',
    path: note?.filePath ?? null,
    title: note?.title ?? '',
    rootFolder: rootDir ?? '',
    body: noteContent,
    bodyPath: note?.filePath ?? null,
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
    const loadNote = async () => {
      const notePath = searchParams.get('note')
      if (!notePath) return

      try {
        const content = await App.markdown.getNoteContent(
          decodeURIComponent(notePath)
        )
        if (content) {
          setNoteContent(content.content)
          setNote(content.meta)
        }
      } catch (error) {
        console.error('Failed to load note:', error)
      }
    }

    loadNote()

    const notePath = searchParams.get('note')
    if (notePath) {
      const decodedPath = decodeURIComponent(notePath)

      // ファイルの監視を開始
      App.markdown.watchFile(decodedPath)

      // ファイル変更イベントのリスナーを設定
      const unsubscribe = App.markdown.onFileChanged(changedPath => {
        if (changedPath === decodedPath) {
          if (saveTimeoutRef.current) {
            return
          }

          const timeSinceLastEdit = Date.now() - lastLocalEditTimeRef.current
          if (timeSinceLastEdit < 2000) {
            return
          }

          const timeSinceLastLocalWrite =
            Date.now() - lastLocalWriteTimeRef.current
          if (timeSinceLastLocalWrite < EXTERNAL_CHANGE_COOLDOWN_MS) {
            return
          }

          const timeSinceLastSave = Date.now() - lastSaveTimeRef.current
          if (timeSinceLastSave < 1000) {
            return
          }

          if (reloadTimeoutRef.current) {
            clearTimeout(reloadTimeoutRef.current)
          }

          reloadTimeoutRef.current = window.setTimeout(() => {
            // 外部変更検知時にキャッシュを無効化
            invalidateEditorStateCache(decodedPath)
            loadNote()
          }, 300)
        }
      })

      // クリーンアップ
      return () => {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
        }
        if (reloadTimeoutRef.current) {
          clearTimeout(reloadTimeoutRef.current)
        }
        App.markdown.unwatchFile(decodedPath)
        unsubscribe()
      }
    }

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current)
      }
    }
  }, [searchParams])

  const handleContentChange = (content: string) => {
    lastLocalEditTimeRef.current = Date.now()
    setNoteContent(content)

    // デバウンス処理
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    saveTimeoutRef.current = window.setTimeout(async () => {
      if (!note) return
      try {
        await App.markdown.saveNote(note.filePath, content)
        lastSaveTimeRef.current = Date.now()
        lastLocalWriteTimeRef.current = Date.now()
        setSaveError(null)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('Failed to save note:', msg)
        setSaveError(msg)
      }
    }, 1000)
  }

  if (!note) {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
        <CustomTitleBar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-600 dark:text-gray-400">
              ノートを読み込んでいます...
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
          isStandaloneWindow={true}
          layoutMode={layoutMode}
          noteMeta={note}
          onChange={handleContentChange}
          onCursorChange={setCursor}
          onLayoutModeChange={setLayoutMode}
          onSaveErrorDismiss={() => setSaveError(null)}
          onSelectionStatsChange={setSelectionStats}
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
