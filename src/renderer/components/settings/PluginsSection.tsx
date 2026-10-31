import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuRefreshCw } from 'react-icons/lu'
import { useApp } from '../../contexts/AppContext'
import { isNewerVersion } from '../../lib/plugins/compat'
import {
  createPluginManager,
  type DevReloadOutcome,
  type InstallOutcome,
  type OperationOutcome,
  type PluginManager,
  type PluginManagerError,
  type UpdateCheckResult,
  type UpdateOutcome,
} from '../../lib/plugins/manager/pluginManager'
import { toPluginApiError } from '../../lib/plugins/pluginError'
import { tauriApi } from '../../lib/tauriApi'
import { parseManifest } from '@/shared/plugin/manifest'
import type {
  KeybindingConflict,
  PluginErrorEntry,
  PluginStateView,
  RegistryEntry,
  SettingValue,
} from '@/shared/plugin/types'
import { Button } from '../ui/button'
import { useConsentDialog } from './plugins/ConsentDialog'
import { DeveloperModePanel } from './plugins/DeveloperModePanel'
import type { PluginBusyAction } from './plugins/InstalledPluginItem'
import { InstalledPluginList } from './plugins/InstalledPluginList'
import {
  describePluginManagerError,
  formatPluginApiError,
  formatPluginManagerError,
} from './plugins/pluginErrorMessage'
import { RegistryList } from './plugins/RegistryList'
import { RepoInstallForm } from './plugins/RepoInstallForm'
import { ThirdPartyWarningBanner } from './plugins/ThirdPartyWarningBanner'

type PluginsBackend = typeof tauriApi.plugins

/** Plugins_Tab が使う `tauriApi.plugins` の関数 */
const REQUIRED_FUNCTIONS = [
  'getState',
  'onStateChanged',
  'onError',
  'getErrors',
  'getKeybindingConflicts',
  'ackThirdPartyWarning',
] as const satisfies readonly (keyof PluginsBackend)[]

/** `tauriApi.plugins` を取得する。部分モックなどで必要な関数が無ければ null */
function getPluginsApi(): PluginsBackend | null {
  const api = (tauriApi as { plugins?: Partial<PluginsBackend> } | undefined)
    ?.plugins
  if (!api) return null
  for (const name of REQUIRED_FUNCTIONS) {
    if (typeof api[name] !== 'function') return null
  }
  return api as PluginsBackend
}

async function loadAppVersion(): Promise<string> {
  const { getVersion } = await import('@tauri-apps/api/app')
  const version: unknown = await getVersion()
  if (typeof version !== 'string' || version === '') {
    throw new Error('The app version is not available')
  }
  return version
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Map を1件だけ変更した新しい Map を返す（`value` が undefined なら削除） */
function withEntry<K, V>(
  map: ReadonlyMap<K, V>,
  key: K,
  value: V | undefined
): Map<K, V> {
  const next = new Map(map)
  if (value === undefined) next.delete(key)
  else next.set(key, value)
  return next
}

function displayNameOf(state: PluginStateView | null, id: string): string {
  const json = state?.plugins.find(p => p.id === id)?.packageJson
  if (json == null) return id
  const parsed = parseManifest(json)
  return parsed.ok ? parsed.value.displayName : id
}

type LoadStatus =
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready' }

type ItemOutcome = OperationOutcome | UpdateOutcome | DevReloadOutcome

type Notice =
  | { type: 'success'; message: string }
  | { type: 'error'; summary: string; details: string[] }

/**
 * Plugins_Tab（設定画面の「プラグイン」セクション。Requirement 1.3〜1.8）。
 *
 * 状態は Rust の Installed_Plugin_State を正とし、`plugins:state-changed` で更新する。
 * 各操作は PluginManager に委譲し、Consent_Dialog は `useConsentDialog` で表示する。
 * Third_Party_Warning が未確認の間は、インストール系の操作を無効化する（Requirement 1.5）。
 */
export function PluginsSection() {
  const { t } = useTranslation()
  const { settings, updateSettings } = useApp()
  const { requestConsent, dialog } = useConsentDialog()

  const api = useMemo(getPluginsApi, [])
  const [load, setLoad] = useState<LoadStatus>(() =>
    api ? { status: 'loading' } : { status: 'unavailable' }
  )
  const [state, setState] = useState<PluginStateView | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [errors, setErrors] = useState<readonly PluginErrorEntry[]>([])
  const [conflicts, setConflicts] = useState<readonly KeybindingConflict[]>([])
  const [updateChecks, setUpdateChecks] = useState<
    ReadonlyMap<string, UpdateCheckResult>
  >(() => new Map())
  const [checking, setChecking] = useState(false)
  const [updateNotice, setUpdateNotice] = useState<string | null>(null)
  const [registryNotice, setRegistryNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState<ReadonlyMap<string, PluginBusyAction>>(
    () => new Map()
  )
  const [operationErrors, setOperationErrors] = useState<
    ReadonlyMap<string, PluginManagerError>
  >(() => new Map())

  // PluginManager から参照する最新の設定（Requirement 11.7 の Gray への切り替え）
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const updateSettingsRef = useRef(updateSettings)
  updateSettingsRef.current = updateSettings

  // --- 取得・イベント購読 ---------------------------------------------------

  const errorsSeqRef = useRef(0)
  const refreshErrors = useCallback(
    async (received?: PluginErrorEntry) => {
      if (!api) return
      const seq = ++errorsSeqRef.current
      try {
        const next = await api.getErrors()
        if (seq === errorsSeqRef.current) setErrors(next)
      } catch (e) {
        console.error('[plugins] failed to get plugin errors:', e)
        // 取得できない場合は受信した項目だけでも表示する
        if (received) setErrors(prev => [...prev, received])
      }
    },
    [api]
  )

  const conflictsSeqRef = useRef(0)
  const refreshConflicts = useCallback(async () => {
    if (!api) return
    const seq = ++conflictsSeqRef.current
    try {
      const next = await api.getKeybindingConflicts()
      if (seq === conflictsSeqRef.current) setConflicts(next)
    } catch (e) {
      console.error('[plugins] failed to get keybinding conflicts:', e)
    }
  }, [api])

  useEffect(() => {
    if (!api) return
    let disposed = false
    // 初回取得より先にイベントが届いた場合は、イベントの状態を優先する
    let receivedEvent = false

    const unsubscribeState = api.onStateChanged(next => {
      if (disposed) return
      receivedEvent = true
      setState(next)
      void refreshConflicts()
    })
    const unsubscribeError = api.onError(entry => {
      if (disposed) return
      void refreshErrors(entry)
    })

    void (async () => {
      try {
        const [initial, version] = await Promise.all([
          api.getState(),
          loadAppVersion(),
        ])
        if (disposed) return
        if (!receivedEvent) setState(initial)
        setAppVersion(version)
        setLoad({ status: 'ready' })
      } catch (e) {
        if (disposed) return
        console.error('[plugins] failed to load plugin state:', e)
        setLoad({ status: 'failed', message: errorText(e) })
      }
    })()
    void refreshErrors()
    void refreshConflicts()

    return () => {
      disposed = true
      unsubscribeState()
      unsubscribeError()
    }
  }, [api, refreshErrors, refreshConflicts])

  // --- PluginManager ------------------------------------------------------

  const manager: PluginManager | null = useMemo(
    () =>
      api && appVersion
        ? createPluginManager({
            api,
            appVersion,
            requestConsent,
            getSelectedThemeId: () => settingsRef.current.colorTheme,
            updateSettings: partial => updateSettingsRef.current(partial),
          })
        : null,
    [api, appVersion, requestConsent]
  )

  /** 操作の戻り値の状態を反映する（`plugins:state-changed` でも更新される） */
  const applyState = useCallback((next: PluginStateView) => {
    setState(next)
  }, [])

  /** インストール済み Plugin の1項目に対する操作（実行中表示と失敗の記録） */
  const runItemAction = useCallback(
    async (
      id: string,
      action: PluginBusyAction,
      run: () => Promise<ItemOutcome>
    ): Promise<void> => {
      setBusy(prev => withEntry(prev, id, action))
      setOperationErrors(prev => withEntry(prev, id, undefined))
      try {
        const outcome = await run()
        if (outcome.status === 'failed') {
          setOperationErrors(prev => withEntry(prev, id, outcome.error))
        } else if ('state' in outcome) {
          applyState(outcome.state)
        }
      } catch (e) {
        // PluginManager は例外を送出しない想定だが、念のため表示する
        const error: PluginManagerError = {
          kind: 'backend',
          error: toPluginApiError(e),
        }
        setOperationErrors(prev => withEntry(prev, id, error))
      } finally {
        setBusy(prev => withEntry(prev, id, undefined))
      }
    },
    [applyState]
  )

  const handleToggleEnabled = useCallback(
    (id: string, enabled: boolean) => {
      if (!manager) return
      void runItemAction(id, 'toggle', () => manager.setEnabled(id, enabled))
    },
    [manager, runItemAction]
  )

  const handleUninstall = useCallback(
    (id: string) => {
      if (!manager) return
      void runItemAction(id, 'uninstall', async () => {
        const outcome = await manager.uninstall(id)
        if (outcome.status === 'done') {
          setUpdateChecks(prev => withEntry(prev, id, undefined))
        }
        return outcome
      })
    },
    [manager, runItemAction]
  )

  const handleUpdate = useCallback(
    (id: string) => {
      if (!manager) return
      setUpdateNotice(null)
      void runItemAction(id, 'update', async () => {
        const outcome = await manager.applyUpdate(id)
        if (outcome.status === 'updated') {
          setUpdateChecks(prev => withEntry(prev, id, undefined))
          setUpdateNotice(
            t('plugins.updates.updated', {
              name: displayNameOf(outcome.state, id),
              version: outcome.version,
            })
          )
        }
        return outcome
      })
    },
    [manager, runItemAction, t]
  )

  const handleReloadDev = useCallback(
    (id: string) => {
      if (!manager || !api) return
      void runItemAction(id, 'reload', async () => {
        const outcome = await manager.reloadDev(id)
        if (outcome.status === 'pendingConsent') {
          // 同意待ちの表示を反映する（state-changed が届かない場合に備える）
          try {
            applyState(await api.getState())
          } catch (e) {
            console.error('[plugins] failed to get plugin state:', e)
          }
        }
        return outcome
      })
    },
    [api, manager, runItemAction, applyState]
  )

  const handleCheckUpdates = useCallback(async () => {
    if (!manager || checking) return
    setChecking(true)
    setUpdateNotice(null)
    try {
      const results = await manager.checkUpdates()
      setUpdateChecks(new Map(results.map(r => [r.id, r])))
      const count = results.filter(
        r => r.status === 'checked' && r.hasUpdate
      ).length
      setUpdateNotice(
        count > 0
          ? t('plugins.updates.available', { count })
          : results.every(r => r.status === 'checked')
            ? t('plugins.updates.upToDate')
            : null
      )
    } finally {
      setChecking(false)
    }
  }, [manager, checking, t])

  const handleRepoInstall = useCallback(
    async (spec: string): Promise<InstallOutcome> => {
      if (!manager) {
        return {
          status: 'failed',
          error: {
            kind: 'backend',
            error: toPluginApiError(new Error('Plugin API is not available')),
          },
        }
      }
      const outcome = await manager.installFromRepo(spec)
      if (outcome.status === 'installed') applyState(outcome.state)
      return outcome
    },
    [manager, applyState]
  )

  const handleRegistryInstall = useCallback(
    async (entry: RegistryEntry): Promise<void> => {
      if (!manager) return
      setRegistryNotice(null)
      const outcome = await manager.installFromRepo(entry.repo, entry.id)
      switch (outcome.status) {
        case 'installed':
          applyState(outcome.state)
          setRegistryNotice({
            type: 'success',
            message: t('plugins.repoInstall.installed', {
              name: displayNameOf(outcome.state, outcome.id),
            }),
          })
          break
        case 'cancelled':
          break
        case 'failed': {
          const { summary, details } = describePluginManagerError(
            t,
            outcome.error
          )
          setRegistryNotice({ type: 'error', summary, details })
          break
        }
      }
    },
    [manager, applyState, t]
  )

  const handleToggleDeveloperMode = useCallback(
    async (enabled: boolean): Promise<OperationOutcome> => {
      if (!manager)
        return { status: 'failed', error: { kind: 'developerModeDisabled' } }
      const outcome = await manager.setDeveloperMode(enabled)
      if (outcome.status === 'done') applyState(outcome.state)
      return outcome
    },
    [manager, applyState]
  )

  const handleLoadDevFolder = useCallback(async (): Promise<InstallOutcome> => {
    if (!manager)
      return { status: 'failed', error: { kind: 'developerModeDisabled' } }
    const outcome = await manager.loadDevFolder()
    if (outcome.status === 'installed') applyState(outcome.state)
    return outcome
  }, [manager, applyState])

  const handleAcknowledge = useCallback(async () => {
    if (!api) return
    // 失敗はバナーが表示する
    applyState(await api.ackThirdPartyWarning())
  }, [api, applyState])

  const loadSettings = useCallback(
    (id: string) =>
      api ? api.getSettings(id) : Promise.resolve<Record<string, unknown>>({}),
    [api]
  )
  const saveSetting = useCallback(
    (id: string, key: string, value: SettingValue) =>
      api ? api.setSetting(id, key, value) : Promise.resolve(),
    [api]
  )

  const formatError = useCallback(
    (error: PluginManagerError) => formatPluginManagerError(t, error),
    [t]
  )

  // --- 表示用の値 -----------------------------------------------------------

  const plugins = state?.plugins
  const installedIds = useMemo(
    () => new Set((plugins ?? []).map(p => p.id)),
    [plugins]
  )

  // 更新後（他のウィンドウでの更新を含む）に古い確認結果で更新ボタンを出さない
  const effectiveUpdateChecks = useMemo(() => {
    const map = new Map<string, UpdateCheckResult>()
    for (const [id, check] of updateChecks) {
      const plugin = plugins?.find(p => p.id === id)
      if (!plugin) continue
      if (
        check.status === 'checked' &&
        check.installedVersion !== plugin.version
      ) {
        map.set(id, {
          ...check,
          installedVersion: plugin.version,
          hasUpdate: isNewerVersion(check.latestVersion, plugin.version),
        })
      } else {
        map.set(id, check)
      }
    }
    return map
  }, [updateChecks, plugins])

  const ready = load.status === 'ready' && state !== null && appVersion !== null
  const acknowledged = state?.thirdPartyWarningAcknowledged === true
  const installDisabled = !acknowledged || manager === null

  return (
    <section
      aria-labelledby="settings-plugins-heading"
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-1">
        <h3
          className="text-sm font-medium text-foreground"
          id="settings-plugins-heading"
        >
          {t('plugins.title')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t('plugins.description')}
        </p>
      </div>
      <div className="flex flex-col gap-6" data-testid="plugins-section-body">
        {load.status === 'unavailable' && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="plugins-unavailable"
          >
            {t('plugins.status.unavailable')}
          </p>
        )}
        {(load.status === 'loading' || (load.status === 'ready' && !ready)) && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="plugins-loading"
            role="status"
          >
            {t('plugins.status.loading')}
          </p>
        )}
        {load.status === 'failed' && (
          <p
            className="text-sm text-destructive break-words"
            data-testid="plugins-load-error"
            role="alert"
          >
            {t('plugins.status.loadFailed', { message: load.message })}
          </p>
        )}

        {ready && state && appVersion && (
          <>
            {state.startupError && (
              <p
                className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive break-words"
                data-testid="plugins-startup-error"
                role="alert"
              >
                {formatPluginApiError(t, toPluginApiError(state.startupError))}
              </p>
            )}

            {!acknowledged && (
              <ThirdPartyWarningBanner onAcknowledge={handleAcknowledge} />
            )}

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  aria-busy={checking}
                  data-testid="plugins-check-updates"
                  disabled={checking || manager === null}
                  onClick={() => void handleCheckUpdates()}
                  size="sm"
                  variant="secondary"
                >
                  <LuRefreshCw size={14} />
                  {checking
                    ? t('plugins.updates.checking')
                    : t('plugins.updates.check')}
                </Button>
                {updateNotice !== null && (
                  <p
                    className="text-xs text-foreground"
                    data-testid="plugins-update-notice"
                    role="status"
                  >
                    {updateNotice}
                  </p>
                )}
              </div>
              <InstalledPluginList
                appVersion={appVersion}
                busy={busy}
                developerMode={state.developerMode}
                errors={errors}
                formatError={formatError}
                keybindingConflicts={conflicts}
                loadSettings={loadSettings}
                onReloadDev={handleReloadDev}
                onToggleEnabled={handleToggleEnabled}
                onUninstall={handleUninstall}
                onUpdate={handleUpdate}
                operationErrors={operationErrors}
                plugins={state.plugins}
                saveSetting={saveSetting}
                updateChecks={effectiveUpdateChecks}
              />
            </div>

            <RepoInstallForm
              disabled={installDisabled}
              onInstall={handleRepoInstall}
            />

            <div className="flex flex-col gap-2">
              <RegistryList
                disabled={installDisabled}
                installedIds={installedIds}
                onInstall={handleRegistryInstall}
              />
              {registryNotice?.type === 'error' && (
                <div
                  className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive"
                  data-testid="registry-install-error"
                  role="alert"
                >
                  <p className="break-words">{registryNotice.summary}</p>
                  {registryNotice.details.length > 0 && (
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 break-words">
                      {registryNotice.details.map((line, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: 同じ文言のエラーが複数ありうる
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {registryNotice?.type === 'success' && (
                <p
                  className="text-xs text-foreground"
                  data-testid="registry-install-success"
                  role="status"
                >
                  {registryNotice.message}
                </p>
              )}
            </div>

            <DeveloperModePanel
              developerMode={state.developerMode}
              disabled={installDisabled}
              formatError={formatError}
              onLoadFolder={handleLoadDevFolder}
              onToggle={handleToggleDeveloperMode}
            />
          </>
        )}
      </div>
      {dialog}
    </section>
  )
}
