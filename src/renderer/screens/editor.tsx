import { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CustomTitleBar } from '../components/CustomTitleBar'
import { EditorView } from '../components/EditorView'
import { useApp } from '../contexts/AppContext'
import type { MarkdownNoteMeta } from '@/shared/types'

export function EditorScreen() {
  const { App } = window
  const [searchParams] = useSearchParams()
  const [note, setNote] = useState<MarkdownNoteMeta | null>(null)
  const [noteContent, setNoteContent] = useState<string>('')
  const [layoutMode, setLayoutMode] = useState<'editor' | 'preview' | 'split'>(
    'split'
  )
  const saveTimeoutRef = useRef<number | undefined>(undefined)
  const lastSaveTimeRef = useRef<number>(0)
  const reloadTimeoutRef = useRef<number | undefined>(undefined)
  const { settings } = useApp()

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

          const timeSinceLastSave = Date.now() - lastSaveTimeRef.current
          if (timeSinceLastSave < 1000) {
            return
          }

          if (reloadTimeoutRef.current) {
            clearTimeout(reloadTimeoutRef.current)
          }

          reloadTimeoutRef.current = window.setTimeout(() => {
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
      } catch (error) {
        console.error('Failed to save note:', error)
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
          isStandaloneWindow={true}
          layoutMode={layoutMode}
          noteMeta={note}
          onChange={handleContentChange}
          onLayoutModeChange={setLayoutMode}
        />
      </div>
    </div>
  )
}
