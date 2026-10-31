import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from '../contexts/AppContext'
import { PluginHostProvider } from '../contexts/PluginHostContext'
import { ToastProvider } from '../components/ui/toast'
import { CustomTitleBar } from '../components/CustomTitleBar'
import { WelcomeScreen } from '../components/WelcomeScreen'
import { CreateNoteDialog } from '../components/CreateNoteDialog'
import { CreateFolderDialog } from '../components/CreateFolderDialog'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { AppShell } from '../components/AppShell'
import { SkeletonScreen } from '../components/SkeletonScreen'
import { useNoteWorkspace } from '../hooks/useNoteWorkspace'
import { useRootFolders } from '../hooks/useRootFolders'
import { useDelayedLoading } from '../hooks/useDelayedLoading'
import { useNavigationHistory } from '../hooks/useNavigationHistory'
import { tauriApi as App } from '@/renderer/lib/tauriApi'
import type { RootFolderTabBarProps } from '../components/RootFolderTabBar'
import type { MarkdownNoteMeta } from '@/shared/types'

const DEFAULT_SIDEBAR_WIDTH = 256
const DEFAULT_NOTE_LIST_WIDTH = 320

export function MainScreen() {
  return (
    <ToastProvider>
      <PluginHostProvider windowKind="main">
        <MainScreenContent />
      </PluginHostProvider>
    </ToastProvider>
  )
}

function MainScreenContent() {
  const { t } = useTranslation()
  const { settings, updateSettings, isLoading: settingsLoading } = useApp()
  const rootFolders = useRootFolders()
  const activeRootPath = rootFolders.activeRootFolder?.path

  const workspace = useNoteWorkspace({
    rootDir: activeRootPath,
    rootMeta: {
      lastSelectedFolder: rootFolders.activeRootFolder?.lastSelectedFolder,
      lastOpenedNotePath: rootFolders.activeRootFolder?.lastOpenedNotePath,
    },
    onMetaChange: meta => {
      if (activeRootPath) {
        rootFolders.updateRootMeta(activeRootPath, meta)
      }
    },
  })

  const isLoading = workspace.isLoading || settingsLoading
  const showSkeleton = useDelayedLoading(isLoading)

  const navigation = useNavigationHistory({
    activeRootFolder: activeRootPath,
  })

  const isNavigatingRef = useRef(false)

  // ノート選択のラッパー: 通常の選択時のみ履歴に push する
  const handleSelectNote = (note: MarkdownNoteMeta) => {
    workspace.onSelectNote(note)
    if (!isNavigatingRef.current) {
      navigation.push(note.filePath)
    }
  }

  // 戻る操作: goBack で取得したパスに該当するノートを表示（push しない）
  const handleGoBack = async () => {
    const filePath = await navigation.goBack()
    if (filePath) {
      const note = workspace.allNotes.find(n => n.filePath === filePath)
      if (note) {
        isNavigatingRef.current = true
        workspace.onSelectNote(note)
        isNavigatingRef.current = false
      }
    }
  }

  // 進む操作: goForward で取得したパスに該当するノートを表示（push しない）
  const handleGoForward = async () => {
    const filePath = await navigation.goForward()
    if (filePath) {
      const note = workspace.allNotes.find(n => n.filePath === filePath)
      if (note) {
        isNavigatingRef.current = true
        workspace.onSelectNote(note)
        isNavigatingRef.current = false
      }
    }
  }

  const [showCreateNoteDialog, setShowCreateNoteDialog] = useState(false)
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'note' | 'folder'
    data: any
  } | null>(null)

  // タブ追加: フォルダ選択ダイアログを開き、選択されたフォルダを登録する
  const handleAddRootFolder = async () => {
    try {
      const path = await App.markdown.selectRootFolder()
      if (path) {
        rootFolders.addRootFolder(path)
      }
    } catch (error) {
      console.error('Failed to select root folder:', error)
    }
  }

  // タブ切替: 保留中の変更を確定させてからアクティブなルートフォルダを切り替える
  const handleSelectTab = (path: string) => {
    if (path === activeRootPath) return
    workspace.flushPendingSave().finally(() => {
      rootFolders.setActiveRootFolder(path)
    })
  }

  const tabBar: RootFolderTabBarProps = {
    tabs: rootFolders.rootFolders.map(folder => ({
      path: folder.path,
      name: folder.path.split(/[\\/]/).filter(Boolean).pop() ?? folder.path,
      status: rootFolders.rootStatus[folder.path] ?? 'ok',
    })),
    activePath: activeRootPath,
    onSelect: handleSelectTab,
    onClose: (path: string) => {
      navigation.removeRootHistory(path)
      rootFolders.removeRootFolder(path)
    },
    onAdd: handleAddRootFolder,
    onReorder: rootFolders.reorderRootFolders,
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
  // 削除処理（IPC呼び出し＋一覧再読込）の完了を待たず、ダイアログは
  // ユーザー操作に対して即座に閉じる。削除自体はバックグラウンドで継続する。
  const handleDeleteConfirm = () => {
    if (!deleteTarget) return
    const target = deleteTarget

    setShowDeleteConfirm(false)
    setDeleteTarget(null)

    if (target.type === 'note') {
      void workspace.onDeleteNote(target.data as MarkdownNoteMeta)
    } else {
      void workspace.onDeleteFolder(target.data as string)
    }
  }

  if (showSkeleton) {
    return (
      <SkeletonScreen
        noteListWidth={settings.noteListWidth ?? DEFAULT_NOTE_LIST_WIDTH}
        showNoteList={settings.showNoteList ?? true}
        showSidebar={settings.showSidebar ?? true}
        sidebarWidth={settings.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH}
        tabBar={tabBar}
      />
    )
  }

  if (isLoading) {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-background">
        <CustomTitleBar tabBar={tabBar} />
        <div className="flex-1 bg-background" />
      </div>
    )
  }

  if (rootFolders.rootFolders.length === 0 || workspace.showRootDialog) {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <CustomTitleBar tabBar={tabBar} />
        <WelcomeScreen onSelect={rootFolders.addRootFolder} />
      </div>
    )
  }

  return (
    <>
      <AppShell
        activeRootPath={activeRootPath}
        canGoBack={navigation.canGoBack}
        canGoForward={navigation.canGoForward}
        onCreateFolder={() => setShowCreateFolderDialog(true)}
        onCreateNote={() => setShowCreateNoteDialog(true)}
        onDeleteFolder={handleDeleteFolderConfirm}
        onDeleteNote={handleDeleteNoteConfirm}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onNoteListWidthCommit={width =>
          updateSettings({ noteListWidth: width })
        }
        onSelectNote={handleSelectNote}
        onSidebarWidthCommit={width => updateSettings({ sidebarWidth: width })}
        onSidePanelViewChange={viewId =>
          updateSettings({ sidePanelActiveView: viewId })
        }
        onSidePanelWidthCommit={width =>
          updateSettings({ sidePanelWidth: width })
        }
        onToggleSidePanel={() =>
          updateSettings({ sidePanelOpen: !settings.sidePanelOpen })
        }
        settings={settings}
        tabBar={tabBar}
        workspace={workspace}
      />

      {/* ダイアログ */}
      <CreateNoteDialog
        isOpen={showCreateNoteDialog}
        onClose={() => setShowCreateNoteDialog(false)}
        onSubmit={workspace.onCreateNote}
      />
      <CreateFolderDialog
        currentPath={workspace.selectedFolder || t('metadata.root')}
        isOpen={showCreateFolderDialog}
        onClose={() => setShowCreateFolderDialog(false)}
        onSubmit={workspace.onCreateFolder}
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
