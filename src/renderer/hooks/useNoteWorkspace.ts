import { useEffect, useState, useRef, useCallback } from 'react'
import { useApp } from '../contexts/AppContext'
import { tauriApi as App } from '@/renderer/lib/tauriApi'
import { stripFrontMatter } from '@/renderer/utils/frontMatter'
import { filterNotesByFolder } from '@/renderer/utils/noteFilters'
import {
  invalidateEditorStateCache,
  clearEditorStateCache,
} from '@/renderer/hooks/useEditorStateCache'
import type { MarkdownNoteMeta, FolderNode, AppSettings } from '@/shared/types'
import { ANIMATION_DURATION_MS } from '@/renderer/lib/noteListAnimation'
import type { NoteListMutation } from '@/renderer/lib/noteListAnimation'
import { useNoteFileSync } from '@/renderer/hooks/useNoteFileSync'
import { sameNotePath } from '@/renderer/lib/noteSaveSession'
import { useActiveNoteEvents } from '@/renderer/hooks/useActiveNoteEvents'

export interface RootMeta {
  lastSelectedFolder?: string
  lastOpenedNotePath?: string
}

export interface UseNoteWorkspaceParams {
  rootDir: string | undefined
  rootMeta: RootMeta
  onMetaChange: (meta: Partial<RootMeta>) => void
}

export interface UseNoteWorkspaceResult {
  // ロード・初期化状態
  isLoading: boolean
  showRootDialog: boolean
  // データ
  folderTree: FolderNode | null
  allNotes: MarkdownNoteMeta[]
  filteredNotes: MarkdownNoteMeta[]
  folderFilteredNotes: MarkdownNoteMeta[]
  selectedFolder: string
  selectedTag: string | null
  selectedNote: MarkdownNoteMeta | null
  noteContent: string
  isSaving: boolean
  isNoteLocked: boolean
  saveError: string | null
  showSidebar: boolean
  showNoteList: boolean
  isNoteTransitioning: boolean
  showAllNotes: boolean
  // 操作
  onShowAllNotes: () => void
  onSelectFolder: (relativePath: string) => void
  onSelectTag: (tag: string | null) => void
  onSelectNote: (note: MarkdownNoteMeta) => Promise<void>
  onContentChange: (content: string) => void
  onCreateNote: (title: string) => Promise<void>
  onCreateFolder: (folderName: string) => Promise<void>
  onDeleteNote: (note: MarkdownNoteMeta) => Promise<void>
  onDeleteFolder: (folderPath: string) => Promise<void>
  onMetadataChange: (title: string, tags: string[]) => Promise<void>
  onNoteMove: (targetFolder: string) => Promise<void>
  onToggleSidebar: () => void
  onToggleNoteList: () => void
  onSaveErrorDismiss: () => void
  onLayoutModeChange: (mode: AppSettings['editorLayoutMode']) => void
  flushPendingSave: () => Promise<void>
  noteListMutation: NoteListMutation | null
  onNoteRemovalComplete: (filePath: string) => void
}

export function useNoteWorkspace({
  rootDir,
  rootMeta,
  onMetaChange,
}: UseNoteWorkspaceParams): UseNoteWorkspaceResult {
  const { settings, updateSettings } = useApp()
  const [showRootDialog, setShowRootDialog] = useState(false)
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
  // noteContent がどのノートの本文か（ノート切り替え中の本文読み込み前は前のノートを指す）。
  // Active_Note_Event を本文の読み込み完了後に発行するために使う
  const [contentNotePath, setContentNotePath] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showSidebar, setShowSidebar] = useState(settings.showSidebar ?? true)
  const [showNoteList, setShowNoteList] = useState(
    settings.showNoteList ?? true
  )
  const [isNoteTransitioning, setIsNoteTransitioning] = useState(false)
  const [_noteAnimationDirection, setNoteAnimationDirection] = useState<
    'forward' | 'backward'
  >('forward')
  const [showAllNotes, setShowAllNotes] = useState(false)
  const [noteListMutation, setNoteListMutation] =
    useState<NoteListMutation | null>(null)
  const rootDirRef = useRef<string | undefined>(rootDir)
  const selectedNoteRef = useRef<MarkdownNoteMeta | null>(null)

  const {
    session: saves,
    isSaving,
    isLocked: isNoteLocked,
  } = useNoteFileSync({
    path: selectedNote?.filePath ?? null,
    onSaved: () => setSaveError(null),
    onError: error =>
      setSaveError(error instanceof Error ? error.message : String(error)),
    onRebind: path => {
      const current = selectedNoteRef.current
      if (current) invalidateEditorStateCache(current.filePath)
      const next =
        current && path ? { ...current, filePath: path, id: path } : null
      selectedNoteRef.current = next
      setSelectedNote(next)
      setContentNotePath(null)
      onMetaChange({ lastOpenedNotePath: path ?? '' })
    },
    onReload: (content, path) => {
      setNoteContent(content?.content ?? '')
      setContentNotePath(content ? path : null)
      if (content) {
        const next = {
          ...content.meta,
          ...selectedNoteRef.current,
          title: content.meta.title,
          filePath: path ?? content.meta.filePath,
        }
        selectedNoteRef.current = next
        setSelectedNote(next)
      } else {
        selectedNoteRef.current = null
        setSelectedNote(null)
      }
    },
    async onStructure() {
      if (!rootDir) return
      const { notes, tree } =
        await App.markdown.scanNotesAndBuildFolderTree(rootDir)
      // A root switch during the scan must not populate the new workspace
      // with the previous root's notes.
      if (rootDirRef.current !== rootDir) return
      setAllNotes(notes)
      setFolderTree(tree)
      const scoped = showAllNotes
        ? notes
        : filterNotesByFolder(notes, selectedFolder)
      setFolderFilteredNotes(scoped)
      setFilteredNotes(
        selectedTag
          ? scoped.filter(note => note.tags?.includes(selectedTag))
          : scoped
      )
      const current = selectedNoteRef.current
      const updated =
        current &&
        notes.find(note => sameNotePath(note.filePath, current.filePath))
      if (updated) {
        selectedNoteRef.current = updated
        setSelectedNote(updated)
      }
    },
  })

  // rootDir の最新値を ref に反映（onCloseRequested クロージャーから参照）
  useEffect(() => {
    rootDirRef.current = rootDir
  }, [rootDir])

  // selectedNote の最新値を ref に反映（onNoteRemovalComplete クロージャーから参照）
  useEffect(() => {
    selectedNoteRef.current = selectedNote
  }, [selectedNote])

  // ウィンドウ終了時に未使用画像をクリーンアップする
  useEffect(() => {
    let unlisten: (() => void) | null = null
    let isClosing = false

    const setup = async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      unlisten = await win.onCloseRequested(async event => {
        if (isClosing) return
        event.preventDefault()
        isClosing = true

        if (rootDirRef.current) {
          try {
            await App.image.cleanupAll(rootDirRef.current)
          } catch (error) {
            console.error('Failed to cleanup images on close:', error)
          }
        }

        await win.destroy()
      })
    }

    setup()

    return () => {
      unlisten?.()
    }
  }, [])

  // 初期化
  useEffect(() => {
    const initialize = async () => {
      // ルート変更時はキャッシュを全クリアし、旧ルートの表示状態をリセットする
      clearEditorStateCache()
      setSelectedNote(null)
      setNoteContent('')
      setContentNotePath(null)
      setAllNotes([])
      setFilteredNotes([])
      setFolderFilteredNotes([])
      setFolderTree(null)
      setSelectedFolder('')
      setShowAllNotes(false)
      setIsLoading(true)

      if (!rootDir) {
        setShowRootDialog(true)
        setIsLoading(false)
        return
      }

      const exists = await App.markdown.checkRootExists(rootDir)
      if (!exists) {
        setShowRootDialog(true)
        setIsLoading(false)
        return
      }

      setShowRootDialog(false)

      // サイドバー・ノートリストの表示状態を復元
      setShowSidebar(settings.showSidebar ?? true)
      setShowNoteList(settings.showNoteList ?? true)

      // 前回選択していたフォルダを復元
      const lastFolder = rootMeta.lastSelectedFolder ?? ''
      setSelectedFolder(lastFolder)

      await loadNotes(lastFolder)
      setIsLoading(false)
    }

    initialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootDir])

  // ノートを読み込む
  const loadNotes = async (folderPath?: string) => {
    if (!rootDir || !App) return

    try {
      const { notes, tree } =
        await App.markdown.scanNotesAndBuildFolderTree(rootDir)
      setAllNotes(notes)
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
      if (rootMeta.lastOpenedNotePath) {
        const lastNote = notes.find(
          n => n.filePath === rootMeta.lastOpenedNotePath
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
            onSelectNote(lastNote)
          }
        }
      }
    } catch (error) {
      console.error('Failed to load notes:', error)
    }
  }

  // すべてのノートを表示
  const onShowAllNotes = () => {
    setShowAllNotes(true)
    setSelectedFolder('')
    setSelectedTag(null)
    setFilteredNotes(allNotes)
    setFolderFilteredNotes(allNotes)
  }

  // フォルダ選択
  const onSelectFolder = (relativePath: string) => {
    setSelectedFolder(relativePath)
    onMetaChange({ lastSelectedFolder: relativePath })
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
  const onSelectTag = (tag: string | null) => {
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
  const onSelectNote = async (note: MarkdownNoteMeta) => {
    if (saves.isLocked || selectedNoteRef.current?.id === note.id) return
    await saves.flush()
    if (saves.isLocked) return

    // 直前に選択中のノートがある場合のみ、切替のフェードアウト演出を行う
    // （ノート作成直後の初回選択等、フェードアウトすべき対象が無い場合は待機を省略する）
    const isSwitchingNote = selectedNote !== null

    if (isSwitchingNote) {
      // アニメーション方向を決定（現在のノートのインデックスと比較）
      const currentIndex = filteredNotes.findIndex(
        n => n.id === selectedNote.id
      )
      const newIndex = filteredNotes.findIndex(n => n.id === note.id)
      setNoteAnimationDirection(
        newIndex > currentIndex ? 'forward' : 'backward'
      )

      setIsNoteTransitioning(true)

      // フェードアウト完了を待つ
      await new Promise(resolve => setTimeout(resolve, 150))
      if (saves.isLocked) {
        setIsNoteTransitioning(false)
        return
      }
    }

    selectedNoteRef.current = note
    saves.bind(note.filePath)
    setSelectedNote(note)
    onMetaChange({ lastOpenedNotePath: note.filePath })

    try {
      const version = saves.version
      const content = await App.markdown.getNoteContent(note.filePath)
      if (content && saves.version === version) {
        setNoteContent(content.content)
        setContentNotePath(note.filePath)
      }
    } catch (error) {
      console.error('Failed to load note content:', error)
    }

    if (isSwitchingNote) {
      // フェードイン開始
      setTimeout(() => {
        setIsNoteTransitioning(false)
      }, 50)
    }
  }

  // The shared session owns timer snapshots and awaits in-flight saves.
  const onContentChange = (content: string) => {
    if (!saves.schedule(content)) return
    setNoteContent(content)
    setContentNotePath(selectedNoteRef.current?.filePath ?? null)
  }

  const flushPendingSave = () => saves.flush()

  // レイアウトモード変更
  const onLayoutModeChange = (mode: AppSettings['editorLayoutMode']) => {
    updateSettings({ editorLayoutMode: mode })
  }

  // サイドバー・ノートリストのトグル
  const onToggleSidebar = () => {
    const newValue = !showSidebar
    setShowSidebar(newValue)
    updateSettings({ showSidebar: newValue })
  }

  const onToggleNoteList = () => {
    const newValue = !showNoteList
    setShowNoteList(newValue)
    updateSettings({ showNoteList: newValue })
  }

  // ノート作成
  const onCreateNote = async (title: string) => {
    if (!rootDir) return

    try {
      const filePath = await App.markdown.createNote(
        rootDir,
        selectedFolder,
        title
      )
      if (filePath) {
        // 1. 楽観的メタデータを構築（スキャン完了を待たずに即座にUI更新）
        const now = new Date().toISOString()
        const optimisticNote: MarkdownNoteMeta = {
          id: filePath,
          filePath,
          relativePath: selectedFolder
            ? `${selectedFolder}/${title}.md`
            : `${title}.md`,
          title,
          excerpt: '',
          tags: [],
          createdAt: now,
          updatedAt: now,
        }

        // 2. filteredNotes/allNotesに楽観的に追加し、mutationを即座に発行
        setFilteredNotes(prev => [optimisticNote, ...prev])
        setAllNotes(prev => [optimisticNote, ...prev])
        setFolderFilteredNotes(prev => [optimisticNote, ...prev])
        setNoteListMutation({ type: 'create', filePath, at: Date.now() })

        // 3. 新しいノートを即座に選択（即座のフィードバック）
        onSelectNote(optimisticNote)

        // 4. バックグラウンドでスキャンし、正確なメタデータで差し替え
        const { notes, tree } =
          await App.markdown.scanNotesAndBuildFolderTree(rootDir)
        setAllNotes(notes)
        setFolderTree(tree)

        // 現在の表示範囲を維持して、正確なノートデータに差し替える
        const filtered = showAllNotes
          ? notes
          : filterNotesByFolder(notes, selectedFolder)
        setFilteredNotes(filtered)
        setFolderFilteredNotes(filtered)

        // 5. 正確なノートデータで選択を更新
        const actualNote = notes.find(n => n.filePath === filePath)
        if (actualNote) {
          setSelectedNote(actualNote)
        }
      }
    } catch (error) {
      console.error('Failed to create note:', error)
    }
  }

  // フォルダ作成
  const onCreateFolder = async (folderName: string) => {
    if (!rootDir) return

    try {
      const newPath = selectedFolder
        ? `${selectedFolder}/${folderName}`
        : folderName
      const success = await App.markdown.createFolder(rootDir, newPath)
      if (success) {
        await loadNotes()
      }
    } catch (error) {
      console.error('Failed to create folder:', error)
    }
  }

  // メタデータ変更
  const onMetadataChange = async (title: string, tags: string[]) => {
    if (!selectedNote) return

    if (saves.isLocked) return
    await saves.flush()

    try {
      await saves.runWrite(async () => {
        // 手動でfrontmatterをパース（gray-matterはRenderer processでBufferエラーになるため）
        const frontmatter: Record<string, any> = {}
        let content = noteContent

        // frontmatterの抽出
        if (noteContent.startsWith('---\n')) {
          const endIndex = noteContent.indexOf('\n---\n', 4)
          if (endIndex !== -1) {
            const frontmatterText = noteContent.substring(4, endIndex)
            content = stripFrontMatter(noteContent)

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
      })
    } catch (error) {
      console.error('Failed to update metadata:', error)
    }
  }

  // ノート移動
  const onNoteMove = async (targetFolder: string) => {
    if (!selectedNote || !rootDir || saves.isLocked) return
    await saves.flush()

    try {
      await saves.runWrite(async () => {
        const newFilePath = await App.markdown.moveNote(
          rootDir,
          selectedNote.filePath,
          targetFolder
        )

        if (newFilePath) {
          // ノートリストを再読み込み
          const { notes, tree } =
            await App.markdown.scanNotesAndBuildFolderTree(rootDir)
          setAllNotes(notes)
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
            selectedNoteRef.current = movedNote
            saves.bind(movedNote.filePath)
            setSelectedNote(movedNote)
            setContentNotePath(movedNote.filePath)
            onMetaChange({ lastOpenedNotePath: movedNote.filePath })
          }
        }
      })
    } catch (error) {
      console.error('Failed to move note:', error)
    }
  }

  // ノート削除（実際の削除処理。確認ダイアログの表示制御は呼び出し側が担当する）
  const onDeleteNote = async (note: MarkdownNoteMeta) => {
    if (!rootDir || saves.isPathLocked(note.filePath)) return
    await saves.flush()

    try {
      await saves.runWrite(async () => {
        const success = await App.markdown.deleteNote(note.filePath)
        if (success) {
          if (selectedNoteRef.current?.filePath === note.filePath)
            saves.bind(null)
          // ノート削除時にキャッシュを無効化
          invalidateEditorStateCache(note.filePath)

          // ノートに紐づく画像を削除（fire-and-forget）
          const noteBaseName =
            note.filePath.replace(/\.md$/i, '').split(/[/\\]/).pop() || ''
          if (noteBaseName) {
            App.image
              .deleteNoteImages(rootDir, noteBaseName)
              .catch((err: unknown) =>
                console.error('Failed to delete note images:', err)
              )
          }

          // 1. Mutation発行（退去アニメーション開始）
          setNoteListMutation({
            type: 'delete',
            filePath: note.filePath,
            at: Date.now(),
          })

          // 2. filteredNotesから対象を楽観的に除外
          setFilteredNotes(prev =>
            prev.filter(n => n.filePath !== note.filePath)
          )
          setAllNotes(prev => prev.filter(n => n.filePath !== note.filePath))

          // 3. アニメーション完了後にフォルダツリー等を再スキャン
          setTimeout(() => {
            loadNotes()
          }, ANIMATION_DURATION_MS + 50)
        }
      }, [note.filePath])
    } catch (error) {
      console.error('Failed to delete:', error)
    }
  }

  // フォルダ削除（実際の削除処理。確認ダイアログの表示制御は呼び出し側が担当する）
  const onDeleteFolder = async (folderPath: string) => {
    if (!rootDir || saves.isLocked) return
    await saves.flush()

    try {
      await saves.runWrite(async () => {
        const success = await App.markdown.deleteFolder(rootDir, folderPath)
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
            selectedNoteRef.current = null
            saves.bind(null)
            setSelectedNote(null)
            setNoteContent('')
          }
          await loadNotes()
        }
      }, [])
    } catch (error) {
      console.error('Failed to delete:', error)
    }
  }

  // ノート退去アニメーション完了時のコールバック
  const onNoteRemovalComplete = useCallback((filePath: string) => {
    if (selectedNoteRef.current?.filePath === filePath) {
      setSelectedNote(null)
      setNoteContent('')
    }
  }, [])

  const onSaveErrorDismiss = () => {
    void saves
      .retryReconcile()
      .then(() => setSaveError(null))
      .catch(error => setSaveError(String(error)))
  }

  // Active_Note_Event の発行（PluginHostProvider の外では何もしない）
  useActiveNoteEvents({
    windowKind: 'main',
    path: selectedNote?.filePath ?? null,
    title: selectedNote?.title ?? '',
    rootFolder: rootDir ?? '',
    body: noteContent,
    bodyPath: contentNotePath,
  })

  return {
    isLoading,
    showRootDialog,
    folderTree,
    allNotes,
    filteredNotes,
    folderFilteredNotes,
    selectedFolder,
    selectedTag,
    selectedNote,
    noteContent,
    isSaving,
    isNoteLocked,
    saveError,
    showSidebar,
    showNoteList,
    isNoteTransitioning,
    showAllNotes,
    onShowAllNotes,
    onSelectFolder,
    onSelectTag,
    onSelectNote,
    onContentChange,
    onCreateNote,
    onCreateFolder,
    onDeleteNote,
    onDeleteFolder,
    onMetadataChange,
    onNoteMove,
    onToggleSidebar,
    onToggleNoteList,
    onSaveErrorDismiss,
    onLayoutModeChange,
    flushPendingSave,
    noteListMutation,
    onNoteRemovalComplete,
  }
}
