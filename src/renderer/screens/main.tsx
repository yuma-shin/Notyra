import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../contexts/AppContext'
import { CustomTitleBar } from '../components/CustomTitleBar'
import { FolderTree } from '../components/FolderTree'
import { NoteList } from '../components/NoteList'
import { EditorView } from '../components/EditorView'
import { WelcomeScreen } from '../components/WelcomeScreen'
import { CreateNoteDialog } from '../components/CreateNoteDialog'
import { CreateFolderDialog } from '../components/CreateFolderDialog'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { MarkdownNoteMeta, FolderNode } from '@/shared/types'

const EXTERNAL_CHANGE_COOLDOWN_MS = 5000

export function MainScreen() {
  const { t } = useTranslation()
  const { settings, updateSettings, isLoading: settingsLoading } = useApp()
  const [showRootDialog, setShowRootDialog] = useState(false)
  const [showCreateNoteDialog, setShowCreateNoteDialog] = useState(false)
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'note' | 'folder'
    data: any
  } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [folderTree, setFolderTree] = useState<FolderNode | null>(null)
  const [allNotes, setAllNotes] = useState<MarkdownNoteMeta[]>([])
  const [filteredNotes, setFilteredNotes] = useState<MarkdownNoteMeta[]>([])
  const [folderFilteredNotes, setFolderFilteredNotes] = useState<
    MarkdownNoteMeta[]
  >([])
  const [selectedFolder, setSelectedFolder] = useState<string>('')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [selectedNote, setSelectedNote] = useState<MarkdownNoteMeta | null>(
    null
  )
  const [noteContent, setNoteContent] = useState<string>('')
  const [isSaving, setIsSaving] = useState(false)
  const [showSidebar, setShowSidebar] = useState(settings.showSidebar ?? true)
  const [showNoteList, setShowNoteList] = useState(
    settings.showNoteList ?? true
  )
  const [isNoteTransitioning, setIsNoteTransitioning] = useState(false)
  const [_noteAnimationDirection, setNoteAnimationDirection] = useState<
    'forward' | 'backward'
  >('forward')
  const [showAllNotes, setShowAllNotes] = useState(false)
  const lastSaveTimeRef = useRef<number>(0)
  const lastLocalEditTimeRef = useRef<number>(0)
  const lastLocalWriteTimeRef = useRef<number>(0)
  const reloadTimeoutRef = useRef<number | undefined>(undefined)
  const saveTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const App = window.App

  // 初期化
  useEffect(() => {
    const initialize = async () => {
      if (!App) {
        setIsLoading(false)
        return
      }

      if (settingsLoading) {
        return
      }

      if (!settings.rootDir) {
        setShowRootDialog(true)
        setIsLoading(false)
        return
      }

      const exists = await App.markdown.checkRootExists(settings.rootDir)
      if (!exists) {
        setShowRootDialog(true)
        setIsLoading(false)
        return
      }

      // 前回選択していたフォルダを復元
      const lastFolder = settings.lastSelectedFolder ?? ''
      setSelectedFolder(lastFolder)

      await loadNotes(lastFolder)
      setIsLoading(false)
    }

    initialize()
  }, [settings.rootDir, settingsLoading])

  // ノートを読み込む
  const loadNotes = async (folderPath?: string) => {
    if (!settings.rootDir || !App) return

    try {
      const notes = await App.markdown.scanNotes(settings.rootDir)
      setAllNotes(notes)

      const tree = await App.markdown.buildFolderTree(settings.rootDir, notes)
      setFolderTree(tree)
      const targetFolder =
        folderPath !== undefined ? folderPath : selectedFolder

      // 指定されたフォルダまたはselectedFolderに基づいてフィルタリング
      // ただし現在の表示が「すべてのノート」の場合はそのまま全件を表示する
      if (showAllNotes && folderPath === undefined) {
        setFilteredNotes(notes)
        setFolderFilteredNotes(notes)
      } else {
        const filtered = notes.filter(note => {
          if (targetFolder === '') {
            // ルートフォルダの場合は直下のノートのみ
            const dir =
              note.relativePath.includes('/') ||
              note.relativePath.includes('\\')
                ? note.relativePath.substring(
                    0,
                    Math.max(
                      note.relativePath.lastIndexOf('/'),
                      note.relativePath.lastIndexOf('\\')
                    )
                  )
                : ''
            return dir === ''
          }
          // 選択されたフォルダ直下のノートのみ
          const dir =
            note.relativePath.includes('/') || note.relativePath.includes('\\')
              ? note.relativePath.substring(
                  0,
                  Math.max(
                    note.relativePath.lastIndexOf('/'),
                    note.relativePath.lastIndexOf('\\')
                  )
                )
              : ''
          // パス区切り文字を統一して比較
          const normalizedDir = dir.replace(/\\/g, '/')
          const normalizedTargetFolder = targetFolder.replace(/\\/g, '/')
          return normalizedDir === normalizedTargetFolder
        })
        setFilteredNotes(filtered)
        setFolderFilteredNotes(filtered)
      }

      // 前回開いていたノートを開く（現在のフォルダ内にある場合のみ）
      if (settings.lastOpenedNotePath) {
        const lastNote = notes.find(
          n => n.filePath === settings.lastOpenedNotePath
        )
        if (lastNote) {
          // ノートが現在選択されているフォルダ内にあるかチェック
          const noteDir =
            lastNote.relativePath.includes('/') ||
            lastNote.relativePath.includes('\\')
              ? lastNote.relativePath.substring(
                  0,
                  Math.max(
                    lastNote.relativePath.lastIndexOf('/'),
                    lastNote.relativePath.lastIndexOf('\\')
                  )
                )
              : ''
          const normalizedNoteDir = noteDir.replace(/\\/g, '/')
          const normalizedTargetFolder = targetFolder.replace(/\\/g, '/')

          // 同じフォルダ内にある場合のみ開く
          if (normalizedNoteDir === normalizedTargetFolder) {
            handleSelectNote(lastNote)
          }
        }
      }
    } catch (error) {
      console.error('Failed to load notes:', error)
    }
  }

  // ルートフォルダ選択
  const handleRootFolderSelect = async (path: string) => {
    updateSettings({ rootDir: path })
    setShowRootDialog(false)
    setIsLoading(true)

    // 設定が保存されるのを待つ
    await new Promise(resolve => setTimeout(resolve, 100))

    await loadNotes()
    setIsLoading(false)
  }

  // ルートフォルダ再選択
  const handleChangeRootFolder = () => {
    setShowRootDialog(true)
  }

  // すべてのノートを表示
  const handleShowAllNotes = () => {
    setShowAllNotes(true)
    setSelectedFolder('')
    setSelectedTag(null)
    setFilteredNotes(allNotes)
    setFolderFilteredNotes(allNotes)
  }

  // フォルダ選択
  const handleSelectFolder = (relativePath: string) => {
    setSelectedFolder(relativePath)
    updateSettings({ lastSelectedFolder: relativePath })
    setSelectedTag(null) // タグフィルターをクリア
    setShowAllNotes(false)

    // 選択したフォルダ直下のノートのみをフィルタ（サブフォルダ内を除く）
    const filtered = allNotes.filter(note => {
      if (relativePath === '') {
        // ルートフォルダの場合は直下のノートのみ
        const dir =
          note.relativePath.includes('/') || note.relativePath.includes('\\')
            ? note.relativePath.substring(
                0,
                Math.max(
                  note.relativePath.lastIndexOf('/'),
                  note.relativePath.lastIndexOf('\\')
                )
              )
            : ''
        return dir === ''
      }
      // 選択されたフォルダ直下のノートのみ
      const dir =
        note.relativePath.includes('/') || note.relativePath.includes('\\')
          ? note.relativePath.substring(
              0,
              Math.max(
                note.relativePath.lastIndexOf('/'),
                note.relativePath.lastIndexOf('\\')
              )
            )
          : ''
      // パス区切り文字を統一して比較
      const normalizedDir = dir.replace(/\\/g, '/')
      const normalizedSelectedFolder = relativePath.replace(/\\/g, '/')
      return normalizedDir === normalizedSelectedFolder
    })
    setFilteredNotes(filtered)
  }

  // タグ選択
  const handleSelectTag = (tag: string | null) => {
    setSelectedTag(tag)
    // showAllNotesの状態は保持する

    if (tag === null) {
      // タグフィルターをクリア - 現在の表示状態に戻る
      if (showAllNotes) {
        // すべてのノートを表示
        setFilteredNotes(allNotes)
      } else {
        // 現在のフォルダの表示に戻る
        const filtered = allNotes.filter(note => {
          if (selectedFolder === '') {
            const dir =
              note.relativePath.includes('/') ||
              note.relativePath.includes('\\')
                ? note.relativePath.substring(
                    0,
                    Math.max(
                      note.relativePath.lastIndexOf('/'),
                      note.relativePath.lastIndexOf('\\')
                    )
                  )
                : ''
            return dir === ''
          }
          const dir =
            note.relativePath.includes('/') || note.relativePath.includes('\\')
              ? note.relativePath.substring(
                  0,
                  Math.max(
                    note.relativePath.lastIndexOf('/'),
                    note.relativePath.lastIndexOf('\\')
                  )
                )
              : ''
          const normalizedDir = dir.replace(/\\/g, '/')
          const normalizedSelectedFolder = selectedFolder.replace(/\\/g, '/')
          return normalizedDir === normalizedSelectedFolder
        })
        setFilteredNotes(filtered)
      }
    } else {
      // 選択したタグを持つノートをフィルタリング
      let notesInScope = allNotes

      if (showAllNotes) {
        // すべてのノートからタグフィルタリング
        notesInScope = allNotes
      } else {
        // 現在のフォルダ内からタグフィルタリング
        notesInScope = allNotes.filter(note => {
          if (selectedFolder === '') {
            const dir =
              note.relativePath.includes('/') ||
              note.relativePath.includes('\\')
                ? note.relativePath.substring(
                    0,
                    Math.max(
                      note.relativePath.lastIndexOf('/'),
                      note.relativePath.lastIndexOf('\\')
                    )
                  )
                : ''
            return dir === ''
          }
          const dir =
            note.relativePath.includes('/') || note.relativePath.includes('\\')
              ? note.relativePath.substring(
                  0,
                  Math.max(
                    note.relativePath.lastIndexOf('/'),
                    note.relativePath.lastIndexOf('\\')
                  )
                )
              : ''
          const normalizedDir = dir.replace(/\\/g, '/')
          const normalizedSelectedFolder = selectedFolder.replace(/\\/g, '/')
          return normalizedDir === normalizedSelectedFolder
        })
      }

      const filtered = notesInScope.filter(
        note => note.tags && Array.isArray(note.tags) && note.tags.includes(tag)
      )
      setFilteredNotes(filtered)
    }
  }

  // ノート選択
  const handleSelectNote = async (note: MarkdownNoteMeta) => {
    if (selectedNote?.id === note.id) return

    // アニメーション方向を決定（現在のノートのインデックスと比較）
    if (selectedNote) {
      const currentIndex = filteredNotes.findIndex(
        n => n.id === selectedNote.id
      )
      const newIndex = filteredNotes.findIndex(n => n.id === note.id)
      setNoteAnimationDirection(
        newIndex > currentIndex ? 'forward' : 'backward'
      )
    }

    setIsNoteTransitioning(true)

    // フェードアウト完了を待つ
    await new Promise(resolve => setTimeout(resolve, 150))

    setSelectedNote(note)
    updateSettings({ lastOpenedNotePath: note.filePath })

    try {
      const content = await App.markdown.getNoteContent(note.filePath)
      if (content) {
        setNoteContent(content.content)
      }
    } catch (error) {
      console.error('Failed to load note content:', error)
    }

    // フェードイン開始
    setTimeout(() => {
      setIsNoteTransitioning(false)
    }, 50)
  }

  // ファイル監視のセットアップ
  useEffect(() => {
    if (!selectedNote || !App) return

    // ファイルの監視を開始
    App.markdown.watchFile(selectedNote.filePath)

    // ファイル変更イベントのリスナーを設定
    const unsubscribe = App.markdown.onFileChanged(async changedPath => {
      if (changedPath === selectedNote.filePath) {
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

        reloadTimeoutRef.current = window.setTimeout(async () => {
          try {
            const content = await App.markdown.getNoteContent(
              selectedNote.filePath
            )
            if (content) {
              setNoteContent(content.content)
            }
          } catch (error) {
            console.error('Failed to reload note:', error)
          }
        }, 300)
      }
    })

    // クリーンアップ
    return () => {
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current)
      }
      App.markdown.unwatchFile(selectedNote.filePath)
      unsubscribe()
    }
  }, [selectedNote?.filePath])

  // ノート内容の変更
  const handleContentChange = (content: string) => {
    lastLocalEditTimeRef.current = Date.now()
    setNoteContent(content)
    debouncedSave(content)
  }

  // 自動保存（デバウンス付き）
  const debouncedSave = (() => {
    return (content: string) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
      saveTimeoutRef.current = setTimeout(async () => {
        if (!selectedNote) return
        setIsSaving(true)
        try {
          // コンテンツにfront matterが含まれているかチェック
          // front matterがない場合は、メタデータを保持したまま保存
          if (!content.startsWith('---\n')) {
            // 現在のノートからfront matterを取得
            const currentContent = await App.markdown.getNoteContent(
              selectedNote.filePath
            )
            if (currentContent?.rawContent) {
              // 生のファイル内容からfront matterを抽出
              const rawContent = currentContent.rawContent
              if (rawContent.startsWith('---\n')) {
                const endIndex = rawContent.indexOf('\n---\n', 4)
                if (endIndex !== -1) {
                  // front matterセクション全体（最後の改行を含む）
                  const frontMatterSection = rawContent.substring(
                    0,
                    endIndex + 5
                  )
                  // contentの先頭の改行を削除してから結合
                  const trimmedContent = content.replace(/^\n+/, '')
                  // front matterと新しいコンテンツを結合（front matterは既に改行で終わっているので追加不要）
                  const contentToSave = frontMatterSection + trimmedContent
                  await App.markdown.saveNote(
                    selectedNote.filePath,
                    contentToSave
                  )
                  lastSaveTimeRef.current = Date.now()
                  lastLocalWriteTimeRef.current = Date.now()
                  setIsSaving(false)
                  saveTimeoutRef.current = undefined

                  return
                }
              }
            }
          }

          // front matterが既に含まれている場合はそのまま保存
          await App.markdown.saveNote(selectedNote.filePath, content)
          lastSaveTimeRef.current = Date.now()
          lastLocalWriteTimeRef.current = Date.now()
        } catch (error) {
          console.error('Failed to save note:', error)
        } finally {
          setIsSaving(false)
          saveTimeoutRef.current = undefined
        }
      }, 1000)
    }
  })()

  // レイアウトモード変更
  const handleLayoutModeChange = (mode: typeof settings.editorLayoutMode) => {
    updateSettings({ editorLayoutMode: mode })
  }

  // サイドバー・ノートリストのトグル
  const toggleSidebar = () => {
    const newValue = !showSidebar
    setShowSidebar(newValue)
    updateSettings({ showSidebar: newValue })
  }

  const toggleNoteList = () => {
    const newValue = !showNoteList
    setShowNoteList(newValue)
    updateSettings({ showNoteList: newValue })
  }

  // ノート作成
  const handleCreateNote = async (title: string) => {
    if (!settings.rootDir) return

    try {
      const filePath = await App.markdown.createNote(
        settings.rootDir,
        selectedFolder,
        title
      )
      if (filePath) {
        // ノートリストを再読み込み
        const notes = await App.markdown.scanNotes(settings.rootDir)
        setAllNotes(notes)

        const tree = await App.markdown.buildFolderTree(settings.rootDir, notes)
        setFolderTree(tree)

        // フィルタリングされたノートリストを更新
        const filtered = notes.filter(note => {
          if (selectedFolder === '') {
            const dir =
              note.relativePath.includes('/') ||
              note.relativePath.includes('\\')
                ? note.relativePath.substring(
                    0,
                    Math.max(
                      note.relativePath.lastIndexOf('/'),
                      note.relativePath.lastIndexOf('\\')
                    )
                  )
                : ''
            return dir === ''
          }
          const dir =
            note.relativePath.includes('/') || note.relativePath.includes('\\')
              ? note.relativePath.substring(
                  0,
                  Math.max(
                    note.relativePath.lastIndexOf('/'),
                    note.relativePath.lastIndexOf('\\')
                  )
                )
              : ''
          // パス区切り文字を統一して比較
          const normalizedDir = dir.replace(/\\/g, '/')
          const normalizedSelectedFolder = selectedFolder.replace(/\\/g, '/')
          return normalizedDir === normalizedSelectedFolder
        })
        setFilteredNotes(filtered)

        // 新しく作成したノートを開く
        const newNote = notes.find(n => n.filePath === filePath)
        if (newNote) {
          handleSelectNote(newNote)
        }
      }
    } catch (error) {
      console.error('Failed to create note:', error)
    }
  }

  // フォルダ作成
  const handleCreateFolder = async (folderName: string) => {
    if (!settings.rootDir) return

    try {
      const newPath = selectedFolder
        ? `${selectedFolder}/${folderName}`
        : folderName
      const success = await App.markdown.createFolder(settings.rootDir, newPath)
      if (success) {
        await loadNotes()
      }
    } catch (error) {
      console.error('Failed to create folder:', error)
    }
  }

  // メタデータ変更
  const handleMetadataChange = async (title: string, tags: string[]) => {
    if (!selectedNote) return

    // 保留中の保存をキャンセル
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = undefined
    }

    try {
      // 手動でfrontmatterをパース（gray-matterはRenderer processでBufferエラーになるため）
      const frontmatter: Record<string, any> = {}
      let content = noteContent

      // frontmatterの抽出
      if (noteContent.startsWith('---\n')) {
        const endIndex = noteContent.indexOf('\n---\n', 4)
        if (endIndex !== -1) {
          const frontmatterText = noteContent.substring(4, endIndex)
          content = noteContent.substring(endIndex + 5)

          // 簡易的なYAMLパース
          frontmatterText.split('\n').forEach(line => {
            if (line.trim().startsWith('-')) {
              // 配列の要素
              return
            }
            const colonIndex = line.indexOf(':')
            if (colonIndex !== -1) {
              const key = line.substring(0, colonIndex).trim()
              const value = line.substring(colonIndex + 1).trim()

              // 配列の場合
              if (value === '') {
                frontmatter[key] = []
                return
              }

              frontmatter[key] = value
            }
          })

          // 配列要素を処理
          let currentKey = ''
          frontmatterText.split('\n').forEach(line => {
            const colonIndex = line.indexOf(':')
            if (
              colonIndex !== -1 &&
              line.substring(colonIndex + 1).trim() === ''
            ) {
              currentKey = line.substring(0, colonIndex).trim()
              frontmatter[currentKey] = []
            } else if (line.trim().startsWith('-') && currentKey) {
              frontmatter[currentKey].push(line.trim().substring(1).trim())
            }
          })
        }
      }

      // フロントマターを更新
      frontmatter.title = title
      frontmatter.tags = tags
      frontmatter.updatedAt = new Date().toISOString()

      // 新しいfrontmatterを生成
      const frontmatterLines = ['---']
      for (const [key, value] of Object.entries(frontmatter)) {
        if (Array.isArray(value)) {
          frontmatterLines.push(`${key}:`)
          value.forEach(item => {
            frontmatterLines.push(`  - ${item}`)
          })
        } else {
          frontmatterLines.push(`${key}: ${value}`)
        }
      }
      frontmatterLines.push('---')
      frontmatterLines.push('')

      const newContent = frontmatterLines.join('\n') + content

      // 保存
      await App.markdown.saveNote(selectedNote.filePath, newContent)

      // UI上のコンテンツは本文のみを保持（front matterは含めない）
      // contentは既にfront matterが除外された本文のみ
      // setNoteContent(content) は不要（既に現在の状態）

      // ノート一覧を再読み込み
      await loadNotes()

      // 選択中のノートを更新
      setSelectedNote({
        ...selectedNote,
        title,
        tags,
        updatedAt: frontmatter.updatedAt,
      })
    } catch (error) {
      console.error('Failed to update metadata:', error)
    }
  }

  // ノート移動
  const handleNoteMove = async (targetFolder: string) => {
    if (!selectedNote || !settings.rootDir) return

    try {
      const newFilePath = await App.markdown.moveNote(
        settings.rootDir,
        selectedNote.filePath,
        targetFolder
      )

      if (newFilePath) {
        // ノートリストを再読み込み
        const notes = await App.markdown.scanNotes(settings.rootDir)
        setAllNotes(notes)

        const tree = await App.markdown.buildFolderTree(settings.rootDir, notes)
        setFolderTree(tree)

        // 移動先のフォルダを選択
        setSelectedFolder(targetFolder)
        setShowAllNotes(false)
        setSelectedTag(null)

        // 移動先フォルダでフィルタリング
        const filtered = notes.filter(note => {
          if (targetFolder === '') {
            // ルートフォルダの場合は直下のノートのみ
            const dir =
              note.relativePath.includes('/') ||
              note.relativePath.includes('\\')
                ? note.relativePath.substring(
                    0,
                    Math.max(
                      note.relativePath.lastIndexOf('/'),
                      note.relativePath.lastIndexOf('\\')
                    )
                  )
                : ''
            return dir === ''
          }
          // 選択されたフォルダ直下のノートのみ
          const dir =
            note.relativePath.includes('/') || note.relativePath.includes('\\')
              ? note.relativePath.substring(
                  0,
                  Math.max(
                    note.relativePath.lastIndexOf('/'),
                    note.relativePath.lastIndexOf('\\')
                  )
                )
              : ''
          // パス区切り文字を統一して比較
          const normalizedDir = dir.replace(/\\/g, '/')
          const normalizedTargetFolder = targetFolder.replace(/\\/g, '/')
          return normalizedDir === normalizedTargetFolder
        })
        setFilteredNotes(filtered)
        setFolderFilteredNotes(filtered)

        // 移動後のノートを選択
        const movedNote = notes.find(n => n.filePath === newFilePath)
        if (movedNote) {
          await handleSelectNote(movedNote)
        }
      }
    } catch (error) {
      console.error('Failed to move note:', error)
    }
  }

  // ノート削除の確認
  const handleDeleteNoteConfirm = (note: MarkdownNoteMeta) => {
    setDeleteTarget({ type: 'note', data: note })
    setShowDeleteConfirm(true)
  }

  // フォルダ削除の確認
  const handleDeleteFolderConfirm = (folderPath: string) => {
    setDeleteTarget({ type: 'folder', data: folderPath })
    setShowDeleteConfirm(true)
  }

  // 削除実行
  const handleDeleteConfirm = async () => {
    if (!deleteTarget || !settings.rootDir) return

    try {
      if (deleteTarget.type === 'note') {
        const note = deleteTarget.data as MarkdownNoteMeta
        const success = await App.markdown.deleteNote(note.filePath)
        if (success) {
          // ノートに紐づく画像を削除
          const noteBaseName =
            note.filePath.replace(/\.md$/i, '').split(/[/\\]/).pop() || ''
          if (noteBaseName) {
            App.image
              .deleteNoteImages(settings.rootDir, noteBaseName)
              .catch((err: unknown) =>
                console.error('Failed to delete note images:', err)
              )
          }
          // 削除されたノートが選択中の場合はクリア
          if (selectedNote?.filePath === note.filePath) {
            setSelectedNote(null)
            setNoteContent('')
          }
          await loadNotes()
        }
      } else if (deleteTarget.type === 'folder') {
        const folderPath = deleteTarget.data as string
        const success = await App.markdown.deleteFolder(
          settings.rootDir,
          folderPath
        )
        if (success) {
          // 削除されたフォルダが選択中の場合はルートに戻す
          if (
            selectedFolder === folderPath ||
            selectedFolder.startsWith(`${folderPath}/`) ||
            selectedFolder.startsWith(`${folderPath}\\`)
          ) {
            setSelectedFolder('')
          }
          // 削除されたフォルダ内のノートが選択中の場合はクリア
          if (
            selectedNote &&
            (selectedNote.relativePath.startsWith(`${folderPath}/`) ||
              selectedNote.relativePath.startsWith(`${folderPath}\\`))
          ) {
            setSelectedNote(null)
            setNoteContent('')
          }
          await loadNotes()
        }
      }
    } catch (error) {
      console.error('Failed to delete:', error)
    } finally {
      setShowDeleteConfirm(false)
      setDeleteTarget(null)
    }
  }

  if (!App) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            Electronアプリとして実行してください
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            このアプリはElectron環境でのみ動作します。
            <br />
            ブラウザで直接開くことはできません。
          </p>
        </div>
      </div>
    )
  }

  if (isLoading || settingsLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="flex flex-col items-center justify-center gap-6">
          {/* Notyra Logo with pulse animation */}
          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-400 to-purple-600 rounded-2xl blur-xl opacity-50 animate-pulse"></div>
            <svg
              className="relative drop-shadow-2xl"
              height="80"
              viewBox="0 0 24 24"
              width="80"
            >
              <defs>
                <linearGradient
                  id="logoGradient"
                  x1="0%"
                  x2="100%"
                  y1="0%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#a78bfa" />
                  <stop offset="100%" stopColor="#c084fc" />
                </linearGradient>
              </defs>
              <path
                d="M6 2h12l6 6v14a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z"
                fill="url(#logoGradient)"
              />
              <line
                stroke="white"
                strokeLinecap="round"
                strokeWidth="1.5"
                x1="8"
                x2="16"
                y1="10"
                y2="10"
              />
              <line
                stroke="white"
                strokeLinecap="round"
                strokeWidth="1.5"
                x1="8"
                x2="16"
                y1="14"
                y2="14"
              />
              <circle cx="8" cy="18" fill="white" r="1" />
              <circle cx="12" cy="18" fill="white" r="1" />
              <circle cx="16" cy="18" fill="white" r="1" />
            </svg>
          </div>

          {/* Spinning loader */}
          <div className="relative w-16 h-16 flex items-center justify-center">
            <div className="absolute inset-0 border-4 border-purple-200 dark:border-gray-700 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-transparent border-t-purple-500 dark:border-t-purple-400 rounded-full animate-spin"></div>
          </div>

          {/* Loading text */}
          <div className="flex flex-col items-center justify-center gap-2">
            <h2 className="text-xl font-semibold bg-gradient-to-r from-purple-600 to-purple-400 bg-clip-text text-transparent">
              Notyra
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 animate-pulse">
              読み込み中...
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!settings.rootDir || showRootDialog) {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <CustomTitleBar />
        <WelcomeScreen onSelect={handleRootFolderSelect} />
      </div>
    )
  }

  return (
    <>
      <div className="h-screen flex flex-col overflow-hidden bg-white dark:bg-gray-900">
        <CustomTitleBar
          onChangeRootFolder={handleChangeRootFolder}
          onToggleNoteList={toggleNoteList}
          onToggleSidebar={toggleSidebar}
          showNoteList={showNoteList}
          showSidebar={showSidebar}
        />
        <div className="flex-1 flex overflow-hidden">
          {showSidebar && folderTree && (
            <FolderTree
              allNotes={allNotes}
              filteredNotes={folderFilteredNotes}
              node={folderTree}
              onCreateFolder={() => setShowCreateFolderDialog(true)}
              onDeleteFolder={handleDeleteFolderConfirm}
              onSelectFolder={handleSelectFolder}
              onSelectTag={handleSelectTag}
              onShowAllNotes={handleShowAllNotes}
              selectedFolder={selectedFolder}
              selectedTag={selectedTag}
              showAllNotes={showAllNotes}
              totalNotes={allNotes.length}
            />
          )}
          {showNoteList && (
            <NoteList
              notes={filteredNotes}
              onCreateNote={() => setShowCreateNoteDialog(true)}
              onDeleteNote={handleDeleteNoteConfirm}
              onSelectNote={handleSelectNote}
              selectedFolder={selectedFolder}
              selectedNote={selectedNote?.filePath || null}
            />
          )}
          {selectedNote ? (
            <div
              className={`flex-1 h-full transition-opacity duration-300 ${
                isNoteTransitioning ? 'opacity-0' : 'opacity-100'
              }`}
            >
              <EditorView
                content={noteContent}
                currentFolder={selectedFolder}
                folderTree={folderTree ?? undefined}
                isSaving={isSaving}
                layoutMode={settings.editorLayoutMode}
                noteMeta={selectedNote}
                onChange={handleContentChange}
                onLayoutModeChange={handleLayoutModeChange}
                onMetadataChange={handleMetadataChange}
                onNoteMove={handleNoteMove}
                onToggleNoteList={toggleNoteList}
                onToggleSidebar={toggleSidebar}
                rootDir={settings.rootDir}
                showNoteList={showNoteList}
                showSidebar={showSidebar}
              />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-white dark:bg-gray-950">
              <svg
                className="mb-6"
                fill="none"
                height="160"
                viewBox="0 0 240 240"
                width="160"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <linearGradient
                    id="noteGradient"
                    x1="0%"
                    x2="100%"
                    y1="0%"
                    y2="100%"
                  >
                    <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#c084fc" stopOpacity="0.4" />
                  </linearGradient>
                  <linearGradient
                    id="noteStroke"
                    x1="0%"
                    x2="100%"
                    y1="0%"
                    y2="100%"
                  >
                    <stop offset="0%" stopColor="#a78bfa" />
                    <stop offset="100%" stopColor="#c084fc" />
                  </linearGradient>
                </defs>

                {/* Shadow */}
                <ellipse
                  cx="120"
                  cy="210"
                  fill="#000"
                  opacity="0.08"
                  rx="80"
                  ry="12"
                />

                {/* Background documents stack */}
                <g opacity="0.3">
                  <rect
                    fill="#d1d5db"
                    height="140"
                    rx="8"
                    stroke="#9ca3af"
                    strokeWidth="2"
                    width="100"
                    x="70"
                    y="55"
                  />
                  <rect
                    fill="#e5e7eb"
                    height="140"
                    rx="8"
                    stroke="#9ca3af"
                    strokeWidth="2"
                    width="100"
                    x="75"
                    y="50"
                  />
                </g>

                {/* Main document */}
                <rect
                  fill="url(#noteGradient)"
                  height="140"
                  rx="8"
                  stroke="url(#noteStroke)"
                  strokeWidth="3"
                  width="100"
                  x="80"
                  y="45"
                />

                {/* Document corner fold */}
                <path
                  d="M 155 45 L 155 70 L 180 70 Z"
                  fill="url(#noteGradient)"
                  opacity="0.6"
                />
                <path
                  d="M 155 45 L 155 70 L 180 70"
                  fill="none"
                  stroke="url(#noteStroke)"
                  strokeWidth="2"
                />

                {/* Document lines */}
                <line
                  opacity="0.5"
                  stroke="#a78bfa"
                  strokeLinecap="round"
                  strokeWidth="2.5"
                  x1="95"
                  x2="150"
                  y1="75"
                  y2="75"
                />
                <line
                  opacity="0.5"
                  stroke="#a78bfa"
                  strokeLinecap="round"
                  strokeWidth="2.5"
                  x1="95"
                  x2="165"
                  y1="90"
                  y2="90"
                />
                <line
                  opacity="0.5"
                  stroke="#a78bfa"
                  strokeLinecap="round"
                  strokeWidth="2.5"
                  x1="95"
                  x2="155"
                  y1="105"
                  y2="105"
                />
                <line
                  opacity="0.5"
                  stroke="#a78bfa"
                  strokeLinecap="round"
                  strokeWidth="2.5"
                  x1="95"
                  x2="160"
                  y1="120"
                  y2="120"
                />

                {/* Markdown symbols */}
                <circle cx="95" cy="140" fill="#c084fc" opacity="0.6" r="3" />
                <circle cx="105" cy="140" fill="#c084fc" opacity="0.6" r="3" />
                <text
                  fill="#a78bfa"
                  fontFamily="monospace"
                  fontSize="14"
                  opacity="0.6"
                  x="115"
                  y="145"
                >
                  #
                </text>

                {/* Cursor/Selection indicator */}
                <g className="animate-pulse">
                  <circle
                    cx="120"
                    cy="30"
                    fill="#a78bfa"
                    opacity="0.1"
                    r="28"
                  />
                  <circle
                    cx="120"
                    cy="30"
                    fill="#a78bfa"
                    opacity="0.15"
                    r="20"
                  />
                  <path
                    d="M 120 15 L 115 25 L 120 22 L 125 25 Z"
                    fill="#a78bfa"
                    opacity="0.7"
                  />
                  <path
                    d="M 108 28 L 118 35 L 116 30 L 120 25 Z"
                    fill="#c084fc"
                    opacity="0.7"
                    transform="rotate(-30 120 30)"
                  />
                  <path
                    d="M 132 28 L 122 35 L 124 30 L 120 25 Z"
                    fill="#c084fc"
                    opacity="0.7"
                    transform="rotate(30 120 30)"
                  />
                </g>
              </svg>
              <p className="text-lg text-gray-400 dark:text-gray-500 font-medium">
                {t('editor.selectNote')}
              </p>
              <p className="text-sm text-gray-400 dark:text-gray-600 mt-2">
                {t('editor.selectNoteHint')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ダイアログ */}
      <CreateNoteDialog
        isOpen={showCreateNoteDialog}
        onClose={() => setShowCreateNoteDialog(false)}
        onSubmit={handleCreateNote}
      />
      <CreateFolderDialog
        currentPath={selectedFolder || t('metadata.root')}
        isOpen={showCreateFolderDialog}
        onClose={() => setShowCreateFolderDialog(false)}
        onSubmit={handleCreateFolder}
      />
      <ConfirmDialog
        confirmText={t('common.delete')}
        isDanger={true}
        isOpen={showDeleteConfirm}
        message={
          deleteTarget?.type === 'note'
            ? `「${(deleteTarget.data as MarkdownNoteMeta).title}」${t('dialog.deleteNoteMessage')}`
            : `「${deleteTarget?.data}」${t('dialog.deleteFolderMessage')}`
        }
        onCancel={() => {
          setShowDeleteConfirm(false)
          setDeleteTarget(null)
        }}
        onConfirm={handleDeleteConfirm}
        title={
          deleteTarget?.type === 'note'
            ? t('dialog.deleteNote')
            : t('dialog.deleteFolder')
        }
      />
    </>
  )
}
