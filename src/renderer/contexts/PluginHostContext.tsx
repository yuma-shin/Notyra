/**
 * Plugin_Host_Window（メインウィンドウとノートウィンドウ）に PluginHost をマウントする
 * Provider（design.md「11. PluginHost」）。設定画面ではマウントしない（Requirement 8.2）。
 *
 * - レジストリは Provider ごとに1回だけ生成し、PluginHost を作り直しても同じものを使う
 * - PluginHost はアプリバージョンの取得後に生成して `start()` し、アンマウント時に `dispose()` する
 *   （React の StrictMode で effect が二重実行されても、Plugin_API はウィンドウ単位の slot が
 *   現在の PluginHost に委譲するため安全）
 * - `tauriApi.plugins` が無い環境（既存テストの部分モックなど）では PluginHost を起動しない
 * - ノートAPIの `roots` と `notes.delete` の確認ダイアログをここで結線する
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { PluginErrorSource } from '@/shared/plugin/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useToast } from '../components/ui/toast'
import { usePluginKeymaps } from '../hooks/usePluginKeymaps'
import { usePluginThemeSync } from '../hooks/usePluginThemeSync'
import type { KeyPlatform } from '../lib/plugins/keybindings'
import type { NoteDeleteConfirmation } from '../lib/plugins/host/pluginApi'
import {
  PluginHost,
  REGISTRATION_ERROR_SOURCES,
} from '../lib/plugins/host/pluginHost'
import {
  createRegistries,
  type Registries,
} from '../lib/plugins/host/registries'
import type { PluginWindowKind } from '../lib/plugins/reconcile'
import { tauriApi as App } from '../lib/tauriApi'
import { useApp } from './AppContext'

export interface PluginHostContextValue {
  readonly windowKind: PluginWindowKind
  /** このウィンドウの拡張レジストリ（PluginHost の起動前から利用できる） */
  readonly registries: Registries
  /** 起動済みの PluginHost。起動前・起動できない環境では null */
  readonly host: PluginHost | null
  /** Plugin のエラーを Toast と Plugins_Tab に報告する（PluginHost が無ければコンソールに出力） */
  reportError(pluginId: string, source: PluginErrorSource, error: unknown): void
}

const PluginHostContext = createContext<PluginHostContextValue | null>(null)

/** `tauriApi.platform` からキーバインドのプラットフォームを決める */
export function detectKeyPlatform(platform: unknown): KeyPlatform {
  return typeof platform === 'string' && /mac|darwin/i.test(platform)
    ? 'mac'
    : 'other'
}

type PluginsApi = (typeof App)['plugins']

/** `tauriApi.plugins` を取得する。部分モックなどで存在しなければ null */
function getPluginsApi(): PluginsApi | null {
  const api = (App as { plugins?: PluginsApi } | undefined)?.plugins
  return api && typeof api.getState === 'function' ? api : null
}

interface PendingDelete {
  request: NoteDeleteConfirmation
  resolve(confirmed: boolean): void
}

export interface PluginHostProviderProps {
  windowKind: PluginWindowKind
  children?: ReactNode
}

export function PluginHostProvider({
  windowKind,
  children,
}: PluginHostProviderProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const { settings } = useApp()

  const hostRef = useRef<PluginHost | null>(null)
  const [host, setHost] = useState<PluginHost | null>(null)

  const reportError = useCallback(
    (pluginId: string, source: PluginErrorSource, error: unknown) => {
      const current = hostRef.current
      if (current) {
        current.reportError(pluginId, source, error)
      } else {
        console.error(`[notyra] plugin "${pluginId}" (${source}):`, error)
      }
    },
    []
  )

  // レジストリはウィンドウ（Provider）ごとに1回だけ生成する。
  // リスナーの例外は生成後の PluginHost に ref 経由で報告する
  const [registries] = useState<Registries>(() =>
    createRegistries({
      platform: detectKeyPlatform(App?.platform),
      onActiveNoteListenerError: (pluginId, error) =>
        reportError(pluginId, REGISTRATION_ERROR_SOURCES.activeNote, error),
      onSettingsListenerError: (pluginId, error) =>
        reportError(pluginId, REGISTRATION_ERROR_SOURCES.settings, error),
    })
  )

  // Plugin のカラーテーマの適用と、Theme_Plugin の追加CSSの有効/無効（Requirement 11.2、11.5）
  usePluginThemeSync(registries)

  // Plugin のキーバインド（Requirement 16.4、16.5）
  usePluginKeymaps(registries, reportError)

  // ノートAPIの roots（tauriApi 層と PluginHost の両方が同じ値を参照する）
  const rootFoldersRef = useRef(settings.rootFolders)
  rootFoldersRef.current = settings.rootFolders

  useEffect(() => {
    const api = getPluginsApi()
    if (!api || typeof api.setNotesRootsProvider !== 'function') return
    return api.setNotesRootsProvider(() => rootFoldersRef.current)
  }, [])

  // notes.delete の確認ダイアログ（同時に複数届いた場合は順番に表示する）
  const [pendingDeletes, setPendingDeletes] = useState<PendingDelete[]>([])
  const pendingDeletesRef = useRef<PendingDelete[]>([])

  const updatePendingDeletes = useCallback(
    (update: (queue: PendingDelete[]) => PendingDelete[]) => {
      pendingDeletesRef.current = update(pendingDeletesRef.current)
      setPendingDeletes(pendingDeletesRef.current)
    },
    []
  )

  const confirmDelete = useCallback(
    (request: NoteDeleteConfirmation): Promise<boolean> =>
      new Promise<boolean>(resolve => {
        updatePendingDeletes(queue => [...queue, { request, resolve }])
      }),
    [updatePendingDeletes]
  )

  const settleDelete = useCallback(
    (entry: PendingDelete, confirmed: boolean) => {
      if (!pendingDeletesRef.current.includes(entry)) return
      updatePendingDeletes(queue => queue.filter(item => item !== entry))
      entry.resolve(confirmed)
    },
    [updatePendingDeletes]
  )

  // アンマウント時、未回答の確認はすべて拒否として扱う
  useEffect(
    () => () => {
      const queue = pendingDeletesRef.current
      pendingDeletesRef.current = []
      for (const entry of queue) entry.resolve(false)
    },
    []
  )

  // アプリバージョン（互換判定と Plugin_API_Version に使う）
  const [appVersion, setAppVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!getPluginsApi()) return
    let cancelled = false
    const fetchVersion = async () => {
      try {
        const { getVersion } = await import('@tauri-apps/api/app')
        const version = await getVersion()
        if (!cancelled) setAppVersion(version)
      } catch (error) {
        console.error('[notyra] failed to get the app version:', error)
      }
    }
    void fetchVersion()
    return () => {
      cancelled = true
    }
  }, [])

  // PluginHost の生成・起動・破棄
  useEffect(() => {
    const api = getPluginsApi()
    if (!api || appVersion === null) return

    const created = new PluginHost({
      api,
      windowKind,
      appVersion,
      toast,
      registries,
      getRootFolders: () => rootFoldersRef.current.map(root => root.path),
      confirmDelete,
    })
    hostRef.current = created
    setHost(created)
    created.start().catch((error: unknown) => {
      console.error('[notyra] failed to start the plugin host:', error)
    })

    return () => {
      if (hostRef.current === created) hostRef.current = null
      setHost(current => (current === created ? null : current))
      created.dispose().catch((error: unknown) => {
        console.error('[notyra] failed to dispose the plugin host:', error)
      })
    }
  }, [appVersion, windowKind, toast, registries, confirmDelete])

  const value = useMemo<PluginHostContextValue>(
    () => ({ windowKind, registries, host, reportError }),
    [windowKind, registries, host, reportError]
  )

  const currentDelete = pendingDeletes[0] ?? null
  // 閉じるアニメーション中も直前の内容を表示し続ける
  const lastShownDeleteRef = useRef<NoteDeleteConfirmation | null>(null)
  if (currentDelete) lastShownDeleteRef.current = currentDelete.request
  const shownDelete = currentDelete?.request ?? lastShownDeleteRef.current

  return (
    <PluginHostContext.Provider value={value}>
      {children}
      <ConfirmDialog
        confirmText={t('plugins.notesDelete.confirm')}
        isDanger={true}
        isOpen={currentDelete !== null}
        message={
          shownDelete
            ? t('plugins.notesDelete.message', {
                plugin: shownDelete.pluginName,
                note: shownDelete.noteName,
              })
            : ''
        }
        onCancel={() => {
          if (currentDelete) settleDelete(currentDelete, false)
        }}
        onConfirm={() => {
          if (currentDelete) settleDelete(currentDelete, true)
        }}
        title={t('plugins.notesDelete.title')}
      />
    </PluginHostContext.Provider>
  )
}

/** PluginHostProvider の値。Provider の外（設定画面・テスト）では null */
export function usePluginHost(): PluginHostContextValue | null {
  return useContext(PluginHostContext)
}

/** このウィンドウの拡張レジストリ。Provider の外では null */
export function usePluginRegistries(): Registries | null {
  return useContext(PluginHostContext)?.registries ?? null
}
