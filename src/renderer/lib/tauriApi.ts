/**
 * Tauri API アダプター
 *
 * window.App と同一インターフェースを invoke() ベースで提供する。
 * 既存の Renderer コードはこのモジュールを import するだけで動作する。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { NoteMutation } from '@/shared/noteMutation'

import type {
  MarkdownNoteMeta,
  FolderNode,
  NoteContent,
  ImageSaveResult,
  CleanupResult,
  RootFolderEntry,
} from '@/shared/types'
import type { PluginNote } from '@/shared/plugin/api'
import type {
  ClassifiedDestination,
  DevFolder,
  DevReload,
  DisabledReason,
  FetchedPackage,
  InstallRecord,
  KeybindingConflict,
  PluginErrorEntry,
  PluginErrorSource,
  PluginHttpRequest,
  PluginHttpResponse,
  PluginStateView,
  SettingsChangedPayload,
  SettingValue,
  StopRequestPayload,
  UpdateCheck,
} from '@/shared/plugin/types'
import { toPluginApiError } from './plugins/pluginError'

// ---------------------------------------------------------------------------
// Markdown API
// ---------------------------------------------------------------------------

const markdown = {
  selectRootFolder: (): Promise<string | null> =>
    invoke<string | null>('select_root_folder'),

  checkRootExists: (rootDir: string): Promise<boolean> =>
    invoke<boolean>('check_root_exists', { rootDir }),

  scanNotes: (rootDir: string): Promise<MarkdownNoteMeta[]> =>
    invoke<{ notes: MarkdownNoteMeta[]; tree: FolderNode }>(
      'scan_notes_and_build_folder_tree',
      { rootDir }
    ).then(r => r.notes),

  buildFolderTree: (
    rootDir: string,
    _notes: MarkdownNoteMeta[]
  ): Promise<FolderNode> =>
    invoke<{ notes: MarkdownNoteMeta[]; tree: FolderNode }>(
      'scan_notes_and_build_folder_tree',
      { rootDir }
    ).then(r => r.tree),

  scanNotesAndBuildFolderTree: (
    rootDir: string
  ): Promise<{ notes: MarkdownNoteMeta[]; tree: FolderNode }> =>
    invoke<{ notes: MarkdownNoteMeta[]; tree: FolderNode }>(
      'scan_notes_and_build_folder_tree',
      { rootDir }
    ),

  getNoteContent: (filePath: string): Promise<NoteContent | null> =>
    invoke<NoteContent | null>('get_note_content', { filePath }),

  saveNote: (
    filePath: string,
    content: string,
    frontMatter?: Record<string, unknown>
  ): Promise<boolean> =>
    invoke<boolean>('save_note', { filePath, content, frontMatter }),

  createNote: (
    rootDir: string,
    folderPath: string,
    title: string
  ): Promise<string | null> =>
    invoke<string | null>('create_note', { rootDir, folderPath, title }),

  createFolder: (rootDir: string, folderPath: string): Promise<boolean> =>
    invoke<boolean>('create_folder', { rootDir, folderPath }),

  renameNote: (oldPath: string, newTitle: string): Promise<string | null> =>
    invoke<string | null>('rename_note', { oldPath, newTitle }),

  deleteNote: (filePath: string): Promise<boolean> =>
    invoke<boolean>('delete_note', { filePath }),

  moveNote: (
    rootDir: string,
    currentFilePath: string,
    targetFolder: string
  ): Promise<string | null> =>
    invoke<string | null>('move_note', {
      rootDir,
      currentFilePath,
      targetFolder,
    }),

  deleteFolder: (rootDir: string, folderPath: string): Promise<boolean> =>
    invoke<boolean>('delete_folder', { rootDir, folderPath }),

  watchFile: (filePath: string): Promise<boolean> =>
    invoke<boolean>('watch_file', { filePath }),

  unwatchFile: (filePath: string): Promise<boolean> =>
    invoke<boolean>('unwatch_file', { filePath }),

  onNoteMutation: (callback: (event: NoteMutation) => void): (() => void) =>
    subscribe<NoteMutation>('notes:mutation', callback),

  ackNoteMutation: (requestId: string, error?: string): Promise<void> =>
    invoke<void>('ack_note_mutation', { requestId, error }),

  /**
   * ファイル変更イベントを購読する。
   * Electron の ipcRenderer.on('markdown:fileChanged') に相当する。
   * 非同期で listen を登録し、同期的にアンサブスクライブ関数を返す。
   */
  onFileChanged: (callback: (filePath: string) => void): (() => void) =>
    subscribe<string>('file-changed', callback),
}

// ---------------------------------------------------------------------------
// 画像 API
// ---------------------------------------------------------------------------

const image = {
  saveFromFile: (
    rootDir: string,
    noteBaseName: string,
    sourceFilePath: string
  ): Promise<ImageSaveResult> =>
    invoke<ImageSaveResult>('save_image_from_file', {
      rootDir,
      noteBaseName,
      sourceFilePath,
    }),

  saveFromBuffer: (
    rootDir: string,
    noteBaseName: string,
    buffer: ArrayBuffer,
    extension: string
  ): Promise<ImageSaveResult> =>
    invoke<ImageSaveResult>('save_image_from_buffer', {
      rootDir,
      noteBaseName,
      buffer: Array.from(new Uint8Array(buffer)),
      extension,
    }),

  selectFile: (): Promise<string[]> => invoke<string[]>('select_image_file'),

  getAsBase64: (path: string): Promise<string> =>
    invoke<string>('read_image_as_base64', { path }),

  cleanupUnused: (
    rootDir: string,
    noteBaseName: string,
    markdownContent: string
  ): Promise<CleanupResult> =>
    invoke<CleanupResult>('cleanup_unused_images', {
      rootDir,
      noteBaseName,
      markdownContent,
    }),

  cleanupAll: (rootDir: string): Promise<CleanupResult> =>
    invoke<CleanupResult>('cleanup_all_unused_images', { rootDir }),

  deleteNoteImages: (
    rootDir: string,
    noteBaseName: string
  ): Promise<CleanupResult> =>
    invoke<CleanupResult>('delete_note_images', { rootDir, noteBaseName }),
}

// ---------------------------------------------------------------------------
// エクスポート API
// ---------------------------------------------------------------------------

export interface ExportResult {
  success: boolean
  filePath?: string
  canceled?: boolean
  error?: string
}

const exportApi = {
  html: (html: string, title: string): Promise<ExportResult> =>
    invoke<ExportResult>('export_html', { html, title }),

  /**
   * PDF エクスポート: ヘッドレス Edge で HTML を PDF に変換して保存する。
   * ファイル保存ダイアログを表示し、Edge が PDF を直接生成する（印刷ダイアログなし）。
   */
  pdf: (html: string, title: string): Promise<ExportResult> =>
    invoke<ExportResult>('export_pdf', { html, title }),

  /**
   * PDF エクスポート（フォールバック）: HTML をテンポラリファイルに書き出し、独立した印刷プレビューウィンドウを開く。
   * そのウィンドウがロード後に自動的に OS の印刷ダイアログを開く（メインアプリには影響しない）。
   */
  openPrintWindow: (html: string, title: string): Promise<void> =>
    invoke<void>('open_print_window', { html, title }),
}

// ---------------------------------------------------------------------------
// Shell API
// ---------------------------------------------------------------------------

const shell = {
  openExternal: async (url: string): Promise<boolean> => {
    try {
      await openUrl(url)
      return true
    } catch {
      return false
    }
  },
}

// ---------------------------------------------------------------------------
// ウィンドウ API
// ---------------------------------------------------------------------------

const windowApi = {
  minimize: (): Promise<void> => getCurrentWindow().minimize(),

  maximize: async (): Promise<void> => {
    const win = getCurrentWindow()
    const isMax = await win.isMaximized()
    if (isMax) {
      await win.unmaximize()
    } else {
      await win.maximize()
    }
  },

  close: (): Promise<void> => getCurrentWindow().close(),

  isMaximized: (): Promise<boolean> => getCurrentWindow().isMaximized(),

  openNoteWindow: (notePath: string, rootDir: string): Promise<boolean> =>
    invoke<boolean>('open_note_window', { notePath, rootDir }),

  openSettingsWindow: (): Promise<boolean> =>
    invoke<boolean>('open_settings_window'),
}

// ---------------------------------------------------------------------------
// プラグイン API
// ---------------------------------------------------------------------------

/**
 * プラグインコマンドを呼び出す。Rust の PluginError（および Tauri の文字列エラー）は
 * PluginApiError（`kind` を持つ）に変換して reject する。
 */
const invokePlugin = <T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> =>
  invoke<T>(command, args).catch((e: unknown) => {
    throw toPluginApiError(e)
  })

/**
 * Tauri イベントを購読し、同期的に解除関数を返す。
 * `listen()` の完了前に解除された場合も、完了時点で確実に解除する。
 */
const subscribe = <T>(
  event: string,
  callback: (payload: T) => void
): (() => void) => {
  let unlisten: (() => void) | null = null
  let disposed = false

  listen<T>(event, e => {
    if (!disposed) callback(e.payload)
  })
    .then(fn => {
      if (disposed) {
        fn()
      } else {
        unlisten = fn
      }
    })
    .catch((e: unknown) => {
      console.error(`[notyra] failed to listen ${event}:`, e)
    })

  return () => {
    if (disposed) return
    disposed = true
    if (unlisten) {
      unlisten()
      unlisten = null
    }
  }
}

/** ノートAPIに渡す登録済みルートフォルダの取得元 */
export type PluginNotesRootsProvider = () => readonly RootFolderEntry[]

let notesRootsProvider: PluginNotesRootsProvider = () => []

/**
 * ノートAPIの `roots` に使うルートフォルダの取得元を設定する。
 * `AppContext` の `settings.rootFolders` を参照する関数を渡す想定で、
 * 未設定の間は空（Rust 側ですべてのパスが範囲外になる）。
 * 戻り値の関数を呼ぶと、設定した取得元を解除する。
 */
const setNotesRootsProvider = (
  provider: PluginNotesRootsProvider
): (() => void) => {
  notesRootsProvider = provider
  return () => {
    if (notesRootsProvider === provider) {
      notesRootsProvider = () => []
    }
  }
}

const currentRoots = (): string[] => notesRootsProvider().map(r => r.path)

/** Plugin 用ノートコマンド（`roots` は呼び出しごとに自動付与する） */
const pluginNotes = {
  resolveRoot: (pluginId: string, path: string): Promise<string> =>
    invokePlugin<string>('plugin_notes_resolve_root', {
      pluginId,
      roots: currentRoots(),
      path,
    }),

  listRoots: (pluginId: string): Promise<string[]> =>
    invokePlugin<string[]>('plugin_notes_list_roots', {
      pluginId,
      roots: currentRoots(),
    }),

  list: (pluginId: string, root: string): Promise<MarkdownNoteMeta[]> =>
    invokePlugin<MarkdownNoteMeta[]>('plugin_notes_list', {
      pluginId,
      roots: currentRoots(),
      root,
    }),

  read: (pluginId: string, path: string): Promise<PluginNote> =>
    invokePlugin<PluginNote>('plugin_notes_read', {
      pluginId,
      roots: currentRoots(),
      path,
    }),

  create: (
    pluginId: string,
    input: {
      root: string
      folder?: string
      title: string
      body?: string
      frontMatter?: Record<string, unknown>
    }
  ): Promise<string> =>
    invokePlugin<string>('plugin_notes_create', {
      pluginId,
      roots: currentRoots(),
      root: input.root,
      folder: input.folder,
      title: input.title,
      body: input.body,
      frontMatter: input.frontMatter,
    }),

  update: (
    pluginId: string,
    path: string,
    body: string,
    frontMatter: Record<string, unknown>
  ): Promise<void> =>
    invokePlugin<void>('plugin_notes_update', {
      pluginId,
      roots: currentRoots(),
      path,
      body,
      frontMatter,
    }),

  rename: (pluginId: string, path: string, newTitle: string): Promise<string> =>
    invokePlugin<string>('plugin_notes_rename', {
      pluginId,
      roots: currentRoots(),
      path,
      newTitle,
    }),

  move: (
    pluginId: string,
    root: string,
    path: string,
    targetFolder: string
  ): Promise<string> =>
    invokePlugin<string>('plugin_notes_move', {
      pluginId,
      roots: currentRoots(),
      root,
      path,
      targetFolder,
    }),

  /** 確認ダイアログは呼び出し側で表示し、確定後にのみ呼ぶ（Requirement 18.12） */
  delete: (pluginId: string, root: string, path: string): Promise<void> =>
    invokePlugin<void>('plugin_notes_delete', {
      pluginId,
      roots: currentRoots(),
      root,
      path,
    }),
}

const plugins = {
  // --- 状態 ---
  getState: (): Promise<PluginStateView> =>
    invokePlugin<PluginStateView>('plugin_get_state'),

  // --- インストール ---
  fetchRelease: (
    owner: string,
    repo: string,
    pluginId?: string
  ): Promise<FetchedPackage> =>
    invokePlugin<FetchedPackage>('plugin_fetch_release', {
      owner,
      repo,
      ...(pluginId === undefined ? {} : { pluginId }),
    }),

  discardStaging: (stagingId: string): Promise<void> =>
    invokePlugin<void>('plugin_discard_staging', { stagingId }),

  commitInstall: (
    stagingId: string,
    record: InstallRecord
  ): Promise<PluginStateView> =>
    invokePlugin<PluginStateView>('plugin_commit_install', {
      stagingId,
      record,
    }),

  // --- 更新 ---
  checkUpdate: (id: string): Promise<UpdateCheck> =>
    invokePlugin<UpdateCheck>('plugin_check_update', { id }),

  applyUpdate: (
    id: string,
    stagingId: string,
    record: InstallRecord
  ): Promise<PluginStateView> =>
    invokePlugin<PluginStateView>('plugin_apply_update', {
      id,
      stagingId,
      record,
    }),

  // --- 有効化・無効化・アンインストール ---
  /** `reason` 省略時、無効化は `user` として記録される */
  setEnabled: (
    id: string,
    enabled: boolean,
    reason?: DisabledReason
  ): Promise<PluginStateView> =>
    invokePlugin<PluginStateView>('plugin_set_enabled', {
      id,
      enabled,
      reason,
    }),

  uninstall: (id: string): Promise<PluginStateView> =>
    invokePlugin<PluginStateView>('plugin_uninstall', { id }),

  // --- Third_Party_Warning・開発者モード ---
  setDeveloperMode: (enabled: boolean): Promise<PluginStateView> =>
    invokePlugin<PluginStateView>('plugin_set_developer_mode', { enabled }),

  ackThirdPartyWarning: (): Promise<PluginStateView> =>
    invokePlugin<PluginStateView>('plugin_ack_third_party_warning'),

  /** キャンセル時は `null` */
  selectDevFolder: (): Promise<DevFolder | null> =>
    invokePlugin<DevFolder | null>('plugin_select_dev_folder'),

  registerDev: (
    path: string,
    record: InstallRecord
  ): Promise<PluginStateView> =>
    invokePlugin<PluginStateView>('plugin_register_dev', { path, record }),

  /**
   * 全ウィンドウで停止してから最新の package.json を読み直す。
   * 同意が必要な追加があれば Rust 側で `pendingConsent` を記録し、停止したままにする。
   */
  reloadDev: (id: string): Promise<DevReload> =>
    invokePlugin<DevReload>('plugin_reload_dev', { id }),

  /** 再同意を記録し、`pendingConsent` を解除する */
  setDevConsent: (
    id: string,
    record: InstallRecord
  ): Promise<PluginStateView> =>
    invokePlugin<PluginStateView>('plugin_set_dev_consent', { id, record }),

  // --- ファイル・設定値 ---
  readText: (id: string, path: string): Promise<string> =>
    invokePlugin<string>('plugin_read_text', { id, path }),

  /** 同意前の staging 内のファイル（Theme_Plugin のテーマ定義の事前検証用） */
  readStagingText: (stagingId: string, path: string): Promise<string> =>
    invokePlugin<string>('plugin_read_staging_text', { stagingId, path }),

  getSettings: (id: string): Promise<Record<string, unknown>> =>
    invokePlugin<Record<string, unknown>>('plugin_get_settings', { id }),

  setSetting: (id: string, key: string, value: SettingValue): Promise<void> =>
    invokePlugin<void>('plugin_set_setting', { id, key, value }),

  // --- エラー・キーバインド重複 ---
  reportError: (
    id: string,
    source: PluginErrorSource,
    message: string
  ): Promise<void> =>
    invokePlugin<void>('plugin_report_error', { id, source, message }),

  getErrors: (): Promise<PluginErrorEntry[]> =>
    invokePlugin<PluginErrorEntry[]>('plugin_get_errors'),

  reportKeybindingConflicts: (conflicts: KeybindingConflict[]): Promise<void> =>
    invokePlugin<void>('plugin_report_keybinding_conflicts', { conflicts }),

  /** キーバインド重複にはイベントがないため、表示時に取得する */
  getKeybindingConflicts: (): Promise<KeybindingConflict[]> =>
    invokePlugin<KeybindingConflict[]>('plugin_get_keybinding_conflicts'),

  // --- ホスト実行系の補助 ---
  ackStop: (requestId: string): Promise<void> =>
    invokePlugin<void>('plugin_ack_stop', { requestId }),

  registerSharedModules: (modules: Record<string, string[]>): Promise<void> =>
    invokePlugin<void>('plugin_register_shared_modules', { modules }),

  classifyDestinations: (
    destinations: string[]
  ): Promise<ClassifiedDestination[]> =>
    invokePlugin<ClassifiedDestination[]>('plugin_classify_destinations', {
      destinations,
    }),

  /** Plugin_Registry の JSON 文字列（解析は `parseRegistry`） */
  fetchRegistry: (): Promise<string> =>
    invokePlugin<string>('plugin_fetch_registry'),

  // --- 権限付き Plugin_API ---
  clipboardRead: (id: string): Promise<string> =>
    invokePlugin<string>('plugin_clipboard_read', { id }),

  clipboardWrite: (id: string, text: string): Promise<void> =>
    invokePlugin<void>('plugin_clipboard_write', { id, text }),

  openExternal: (id: string, url: string): Promise<void> =>
    invokePlugin<void>('plugin_open_external', { id, url }),

  httpRequest: (
    pluginId: string,
    request: PluginHttpRequest
  ): Promise<PluginHttpResponse> =>
    invokePlugin<PluginHttpResponse>('plugin_http_request', {
      pluginId,
      request,
    }),

  notes: pluginNotes,
  setNotesRootsProvider,

  // --- イベント（戻り値は解除関数） ---
  onStateChanged: (callback: (state: PluginStateView) => void): (() => void) =>
    subscribe<PluginStateView>('plugins:state-changed', callback),

  onSettingsChanged: (
    callback: (e: SettingsChangedPayload) => void
  ): (() => void) =>
    subscribe<SettingsChangedPayload>('plugins:settings-changed', callback),

  onStopRequest: (callback: (e: StopRequestPayload) => void): (() => void) =>
    subscribe<StopRequestPayload>('plugins:stop-request', callback),

  onError: (callback: (e: PluginErrorEntry) => void): (() => void) =>
    subscribe<PluginErrorEntry>('plugins:error', callback),
}

// ---------------------------------------------------------------------------
// プラットフォーム検出
// ---------------------------------------------------------------------------

const platform: string =
  // @ts-expect-error — userAgentData は実験的 API
  navigator.userAgentData?.platform ?? navigator.platform ?? 'unknown'

// ---------------------------------------------------------------------------
// エクスポート
// ---------------------------------------------------------------------------

export const tauriApi = {
  markdown,
  image,
  export: exportApi,
  shell,
  window: windowApi,
  platform,
  plugins,
}
