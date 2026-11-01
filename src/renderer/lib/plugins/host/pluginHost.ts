/**
 * PluginHost（design.md「11. PluginHost」）。
 *
 * Plugin_Host_Window（メインウィンドウとノートウィンドウ）ごとに1つ生成し、
 * Rust 側の状態（`PluginStateView`）と現在の読み込み状態の差分を取って Plugin を
 * 読み込み・停止する（差分調停）。設定ウィンドウでは生成しない（Requirement 8.2）。
 *
 * - 調停・停止要求・破棄は直列化キューで1つずつ実行する（並行調停を防ぐ）
 * - Theme_Plugin はテーマ JSON（と追加CSS）を読み込んでレジストリに登録する
 * - Feature_Plugin のエントリモジュール読み込みと `activate()` はそれぞれ10秒まで待つ。
 *   失敗時は登録をすべて解除し、activate() の失敗は無効化を永続化する
 * - Plugin_Stop は `activate()` が完了した Plugin に限り `deactivate()` を呼び、失敗しても
 *   登録の解除を続行する
 * - エラーは Toast と Plugins_Tab（`plugin_report_error`）に互いに独立して報告する
 *
 * 仮想モジュール `@notyra/plugin-api`（`/<id>/@notyra/api.js`）はウィンドウ内で Plugin ごとに
 * 1回だけ評価されキャッシュされるため、Plugin_API オブジェクトはウィンドウ（グローバル
 * オブジェクト）単位で Plugin ごとに1つ作り、処理は「現在の PluginHost」に委譲する。
 * これにより、同じウィンドウで PluginHost を作り直しても（React の StrictMode など）
 * 再読み込みした Plugin が新しい PluginHost を使える。
 */
import i18next from 'i18next'
import type { NotyraPluginApi, PluginModule } from '@/shared/plugin/api'
import { PluginApiError } from '@/shared/plugin/api'
import type {
  FeatureManifest,
  KeybindingConflict,
  Permission,
  PluginErrorPayload,
  PluginErrorSource,
  PluginStateView,
  SettingDeclaration,
  SettingsChangedPayload,
  StopRequestPayload,
  ThemeManifest,
} from '@/shared/plugin/types'
import type { ToastApi } from '@/renderer/components/ui/toast'
import { formatPluginErrorPayload } from '../pluginError'
import {
  computeDesiredPlugins,
  type DesiredPlugin,
  diffLoaded,
  type PluginWindowKind,
} from '../reconcile'
import { runWithTimeout } from '../withTimeout'
import {
  createPluginApi,
  type NoteDeleteConfirmation,
  type PluginApiBackend,
  type RegistrationTarget,
} from './pluginApi'
import type { Registries } from './registries'
import { PluginSession } from './session'
import { buildSharedModuleExports, SHARED_MODULES } from './sharedModules'

// ---------------------------------------------------------------------------
// 定数とユーティリティ
// ---------------------------------------------------------------------------

/** 仮想モジュール `@notyra/plugin-api` が参照するグローバル名 */
export const PLUGIN_HOST_GLOBAL = '__NOTYRA_PLUGIN_HOST__'

/** 共有モジュールの仮想モジュールが参照するグローバル名 */
export const SHARED_MODULES_GLOBAL = '__NOTYRA_SHARED__'

/** モジュール読み込み / `activate()` / `deactivate()` の待機上限 */
export const PLUGIN_LIFECYCLE_TIMEOUT_MS = 10_000

/** 独自 URI スキームのベース URL（Windows / WebView2） */
export const PLUGIN_PROTOCOL_BASE_WINDOWS = 'http://notyra-plugin.localhost'

/** 独自 URI スキームのベース URL（macOS / Linux） */
export const PLUGIN_PROTOCOL_BASE_OTHER = 'notyra-plugin://localhost'

export function pluginProtocolBase(isWindows: boolean): string {
  return isWindows ? PLUGIN_PROTOCOL_BASE_WINDOWS : PLUGIN_PROTOCOL_BASE_OTHER
}

/** 実行中の OS が Windows か（独自スキームの URL 形式の判定に使う） */
export function detectIsWindows(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent ?? ''
  return /Windows/i.test(ua)
}

/**
 * Plugin のファイルの URL（`<base>/<id>/<nonce>/<path>`）を作る。
 * `<nonce>` を読み込みごとに変えることで、エントリと相対 import された子モジュールの
 * キャッシュを読み込み単位で分離する。
 */
export function buildPluginFileUrl(
  base: string,
  pluginId: string,
  nonce: string,
  path: string
): string {
  const encodedPath = path
    .split('/')
    .filter(segment => segment !== '')
    .map(encodeURIComponent)
    .join('/')
  return `${base}/${encodeURIComponent(pluginId)}/${encodeURIComponent(nonce)}/${encodedPath}`
}

/** 登録に失敗した拡張ポイントを、報告に使う PluginErrorSource に対応付ける */
export const REGISTRATION_ERROR_SOURCES: Readonly<
  Record<RegistrationTarget, PluginErrorSource>
> = Object.freeze({
  style: 'activate',
  sidePanel: 'sidePanel',
  markdown: 'markdown',
  editorExtension: 'editorExtension',
  command: 'command',
  toolbar: 'command',
  keymap: 'command',
  activeNote: 'activate',
  settings: 'activate',
})

/** 報告用のエラーメッセージ */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

let nonceCounter = 0

function defaultCreateNonce(): string {
  nonceCounter += 1
  return `${Date.now().toString(36)}${nonceCounter.toString(36)}`
}

function defaultImportModule(url: string): Promise<unknown> {
  return import(/* @vite-ignore */ url)
}

export interface PluginErrorToastInfo {
  pluginId: string
  /** Plugin の表示名（翻訳しない。不明なら Plugin_ID） */
  displayName: string
  source: PluginErrorSource
  message: string
}

function defaultFormatErrorToast(info: PluginErrorToastInfo): string {
  const source = i18next.t(`plugins.errorSource.${info.source}`, {
    defaultValue: info.source,
  })
  return i18next.t('plugins.toast.pluginErrorWithSource', {
    name: info.displayName,
    source,
    message: info.message,
    defaultValue: `${info.displayName} (${source}): ${info.message}`,
  })
}

function defaultFormatStartupError(error: PluginErrorPayload): string {
  return i18next.t(`plugins.errors.${error.kind}`, {
    ...error,
    defaultValue: formatPluginErrorPayload(error),
  })
}

/** モジュール名前空間を PluginModule として検証する */
function toPluginModule(namespace: unknown): PluginModule {
  if (
    (typeof namespace !== 'object' && typeof namespace !== 'function') ||
    namespace === null
  ) {
    throw new Error('The entry module did not evaluate to a module namespace')
  }
  const mod = namespace as Record<string, unknown>
  for (const name of ['activate', 'deactivate'] as const) {
    if (mod[name] !== undefined && typeof mod[name] !== 'function') {
      throw new Error(`The exported "${name}" is not a function`)
    }
  }
  return mod as PluginModule
}

// ---------------------------------------------------------------------------
// ウィンドウ（グローバルオブジェクト）単位の状態
// ---------------------------------------------------------------------------

type TauriPluginsApi =
  typeof import('@/renderer/lib/tauriApi')['tauriApi']['plugins']

/** PluginHost が使う tauriApi.plugins の部分集合（テストで差し替え可能） */
export type PluginHostBackend = PluginApiBackend &
  Pick<
    TauriPluginsApi,
    | 'getState'
    | 'setEnabled'
    | 'readText'
    | 'getSettings'
    | 'reportError'
    | 'reportKeybindingConflicts'
    | 'ackStop'
    | 'registerSharedModules'
    | 'onStateChanged'
    | 'onSettingsChanged'
    | 'onStopRequest'
  >

/** Plugin_API オブジェクトが「現在の PluginHost」に委譲する処理 */
interface HostBinding {
  readonly backend: PluginApiBackend
  readonly registries: Registries
  sessionOf(pluginId: string): PluginSession | null
  consentedPermissionsOf(pluginId: string): readonly Permission[]
  displayNameOf(pluginId: string): string
  settingDeclarationsOf(pluginId: string): readonly SettingDeclaration[]
  rootFolders(): readonly string[]
  confirmDelete(request: NoteDeleteConfirmation): Promise<boolean>
  reportError(pluginId: string, source: PluginErrorSource, error: unknown): void
}

interface HostSlot {
  current: HostBinding | null
  /** Plugin_API_Version。最初に生成された PluginHost のアプリバージョン */
  appVersion: string
  /** Plugin_ID → Plugin_API（ウィンドウ内で Plugin ごとに1つ） */
  readonly apis: Map<string, NotyraPluginApi>
  /** `__NOTYRA_PLUGIN_HOST__` に設定するオブジェクト */
  readonly facade: { getPluginApi(pluginId: string): NotyraPluginApi }
}

/** モジュールの再評価（HMR）でも同じ状態を使うため、グローバルの Symbol で保持する */
const SLOT_KEY = Symbol.for('notyra.pluginHost.slot')

function defineConstant(target: object, key: PropertyKey, value: unknown) {
  const existing = Object.getOwnPropertyDescriptor(target, key)
  if (existing) {
    if (existing.value === value) return
    if (!existing.configurable) {
      console.error(
        `[notyra] cannot redefine ${String(key)}; keeping the existing value`
      )
      return
    }
  }
  Object.defineProperty(target, key, {
    value,
    writable: false,
    configurable: false,
    enumerable: false,
  })
}

/** 現在の PluginHost に委譲するオブジェクト（getter・メソッドをその都度取り出す） */
function delegate<T extends object>(get: () => T): T {
  return new Proxy({} as T, {
    get: (_target, prop) => Reflect.get(get(), prop),
  })
}

function getSlot(target: object): HostSlot {
  const existing = (target as Record<symbol, unknown>)[SLOT_KEY]
  if (existing) return existing as HostSlot

  const apis = new Map<string, NotyraPluginApi>()
  const slot: HostSlot = {
    current: null,
    appVersion: '',
    apis,
    facade: Object.freeze({
      getPluginApi: (pluginId: string): NotyraPluginApi => {
        if (typeof pluginId !== 'string' || pluginId === '') {
          throw new PluginApiError('invalidArgument', 'Invalid plugin ID')
        }
        let api = apis.get(pluginId)
        if (!api) {
          api = createSlotApi(slot, pluginId)
          apis.set(pluginId, api)
        }
        return api
      },
    }),
  }
  defineConstant(target, SLOT_KEY, slot)
  return slot
}

function createSlotApi(slot: HostSlot, pluginId: string): NotyraPluginApi {
  const host = (): HostBinding => {
    if (!slot.current) {
      throw new PluginApiError(
        'pluginNotActive',
        `Plugin "${pluginId}" is not active`
      )
    }
    return slot.current
  }
  return createPluginApi(pluginId, {
    backend: delegate(() => host().backend),
    registries: delegate(() => host().registries),
    appVersion: slot.appVersion,
    getSession: () => slot.current?.sessionOf(pluginId) ?? null,
    getConsentedPermissions: () =>
      slot.current?.consentedPermissionsOf(pluginId) ?? [],
    getDisplayName: () => slot.current?.displayNameOf(pluginId) ?? pluginId,
    getSettingDeclarations: () =>
      slot.current?.settingDeclarationsOf(pluginId) ?? [],
    getRootFolders: () => slot.current?.rootFolders() ?? [],
    confirmDelete: request =>
      slot.current
        ? slot.current.confirmDelete(request)
        : Promise.resolve(false),
    onRegistrationError: (target, error) =>
      slot.current?.reportError(
        pluginId,
        REGISTRATION_ERROR_SOURCES[target],
        error
      ),
  })
}

// ---------------------------------------------------------------------------
// PluginHost
// ---------------------------------------------------------------------------

export interface PluginHostDeps {
  api: PluginHostBackend
  windowKind: PluginWindowKind
  /** Notyra のアプリバージョン（互換判定と Plugin_API_Version） */
  appVersion: string
  toast: Pick<ToastApi, 'error'>
  registries: Registries
  /** 独自スキームのベース URL。省略時は `isWindows` から決める */
  protocolBase?: string
  /** 省略時は `detectIsWindows()` */
  isWindows?: boolean
  /** エントリモジュールの読み込み。既定は `import()` */
  importModule?(url: string): Promise<unknown>
  /** 読み込みごとの `<nonce>`。既定は時刻とカウンタ */
  createNonce?(): string
  /** 登録済みルートのホスト構成。既定は空。操作時のルート解決はバックエンドで行う */
  getRootFolders?(): readonly string[]
  /** `notes.delete` の確認ダイアログ。既定は常に拒否 */
  confirmDelete?(request: NoteDeleteConfirmation): Promise<boolean>
  /** Toast に表示するエラー文言。既定は i18n の `plugins.toast.pluginErrorWithSource` */
  formatErrorToast?(info: PluginErrorToastInfo): string
  /** 起動時の問題（state.json の破損など）の Toast 文言 */
  formatStartupError?(error: PluginErrorPayload): string
  /** モジュール読み込み / `activate()` / `deactivate()` の待機上限。既定は10秒 */
  lifecycleTimeoutMs?: number
  /** グローバルを定義する対象。既定は `globalThis` */
  globalObject?: object
  /** `__NOTYRA_SHARED__` に設定するモジュール。既定は SHARED_MODULES */
  sharedModules?: Readonly<Record<string, object>>
}

interface LoadedPlugin {
  readonly id: string
  readonly loadKey: string
  readonly desired: DesiredPlugin
  readonly session: PluginSession
  module: PluginModule | null
  /** 読み込み・起動に失敗した（キー変更またはテーマ競合解消時に再試行） */
  failed: boolean
  /** 競合が解消した場合だけ再試行するテーマ ID */
  conflictingThemeId?: string
  /** 読み込み中に `plugins:settings-changed` を受信した */
  settingsFromEvent: boolean
}

export interface LoadedPluginStatus {
  id: string
  loadKey: string
  activated: boolean
  failed: boolean
}

export class PluginHost {
  readonly windowKind: PluginWindowKind
  readonly registries: Registries

  private readonly deps: PluginHostDeps
  private readonly backend: PluginHostBackend
  private readonly base: string
  private readonly timeoutMs: number
  private readonly globalObject: object
  private readonly sharedModules: Readonly<Record<string, object>>
  private readonly slot: HostSlot
  private readonly binding: HostBinding

  private readonly loaded = new Map<string, LoadedPlugin>()
  private readonly stopRequests = new Map<string, string>()
  private latestState: PluginStateView | null = null
  private queue: Promise<void> = Promise.resolve()
  private readonly unsubscribers: Array<() => void> = []
  private startPromise: Promise<void> | null = null
  private ready = false
  private disposed = false
  private conflictReportScheduled = false
  private lastReportedConflicts: string | null = null

  constructor(deps: PluginHostDeps) {
    this.deps = deps
    this.backend = deps.api
    this.windowKind = deps.windowKind
    this.registries = deps.registries
    this.base =
      deps.protocolBase ??
      pluginProtocolBase(deps.isWindows ?? detectIsWindows())
    this.timeoutMs = deps.lifecycleTimeoutMs ?? PLUGIN_LIFECYCLE_TIMEOUT_MS
    this.globalObject = deps.globalObject ?? globalThis
    this.sharedModules = deps.sharedModules ?? SHARED_MODULES
    this.slot = getSlot(this.globalObject)
    if (this.slot.appVersion === '') this.slot.appVersion = deps.appVersion

    this.binding = {
      backend: this.backend,
      registries: this.registries,
      sessionOf: id => {
        const entry = this.loaded.get(id)
        return entry && !entry.session.disposed ? entry.session : null
      },
      consentedPermissionsOf: id =>
        this.latestState?.plugins.find(p => p.id === id)
          ?.consentedPermissions ?? [],
      displayNameOf: id => this.displayNameOf(id),
      settingDeclarationsOf: id => {
        const manifest = this.loaded.get(id)?.desired.manifest
        return manifest?.type === 'feature' ? (manifest.settings ?? []) : []
      },
      rootFolders: () => this.deps.getRootFolders?.() ?? [],
      confirmDelete: request =>
        this.deps.confirmDelete
          ? this.deps.confirmDelete(request)
          : Promise.resolve(false),
      reportError: (id, source, error) => this.reportError(id, source, error),
    }
  }

  /**
   * グローバルの設定 → イベント購読 → 共有モジュールの登録 → 状態の取得 → 差分調停。
   * 状態の取得より先にイベントを購読し、その間の変更を取りこぼさない。
   * 2回目以降の呼び出しは最初の呼び出しと同じ Promise を返す。
   */
  start(): Promise<void> {
    if (!this.startPromise) this.startPromise = this.doStart()
    return this.startPromise
  }

  /**
   * 指定した状態で差分調停を行う（直列化キューで実行）。
   * 実行時点で受け取っている最新の状態を使う。
   */
  reconcile(state: PluginStateView): Promise<void> {
    this.acceptState(state)
    return this.enqueue(() => this.doReconcile())
  }

  private acceptState(state: PluginStateView): void {
    const completed = state.completedStopRequest
    if (
      completed &&
      this.stopRequests.get(completed.id) === completed.requestId
    )
      this.stopRequests.delete(completed.id)
    this.latestState = state
  }

  /** 仮想モジュール `@notyra/plugin-api` から呼ばれる */
  getPluginApi(pluginId: string): NotyraPluginApi {
    return this.slot.facade.getPluginApi(pluginId)
  }

  /**
   * Plugin のエラーを Toast と Plugins_Tab（`plugin_report_error`）に報告する。
   * 2つの報告は互いに独立して行い、一方の失敗はもう一方に影響しない（Requirement 8.16、8.17）。
   */
  reportError(
    pluginId: string,
    source: PluginErrorSource,
    error: unknown
  ): void {
    const message = describeError(error)
    try {
      const format = this.deps.formatErrorToast ?? defaultFormatErrorToast
      this.deps.toast.error(
        format({
          pluginId,
          displayName: this.displayNameOf(pluginId),
          source,
          message,
        })
      )
    } catch (toastError) {
      console.error(toastError)
    }
    try {
      this.backend
        .reportError(pluginId, source, message)
        .catch((reportError: unknown) => console.error(reportError))
    } catch (reportError) {
      console.error(reportError)
    }
  }

  /** 読み込み済みの Plugin（読み込み順） */
  getLoadedPlugins(): LoadedPluginStatus[] {
    return [...this.loaded.values()].map(entry => ({
      id: entry.id,
      loadKey: entry.loadKey,
      activated: entry.session.activated,
      failed: entry.failed,
    }))
  }

  /** キューに積まれた処理がすべて完了するまで待つ */
  whenIdle(): Promise<void> {
    return this.queue
  }

  /** イベントの購読を解除し、読み込み済みのすべての Plugin を停止する（冪等） */
  async dispose(): Promise<void> {
    if (this.disposed) {
      await this.queue
      return
    }
    this.disposed = true
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      try {
        unsubscribe()
      } catch (error) {
        console.error(error)
      }
    }
    await this.enqueue(async () => {
      for (const id of [...this.loaded.keys()].reverse()) {
        await this.stopPluginSafely(id)
      }
    })
    if (this.slot.current === this.binding) this.slot.current = null
  }

  // -------------------------------------------------------------------------
  // 起動とイベント
  // -------------------------------------------------------------------------

  private async doStart(): Promise<void> {
    if (this.disposed) return
    this.installGlobals()
    this.subscribeEvents()

    try {
      await this.backend.registerSharedModules(
        buildSharedModuleExports(this.sharedModules)
      )
    } catch (error) {
      // 共有モジュールを import する Plugin は読み込みに失敗し、その時点で報告される
      console.error('[notyra] failed to register shared modules:', error)
    }
    if (this.disposed) return

    let state: PluginStateView
    try {
      state = await this.backend.getState()
    } catch (error) {
      console.error('[notyra] failed to get the plugin state:', error)
      this.ready = true
      if (this.latestState) await this.enqueue(() => this.doReconcile())
      return
    }
    if (this.disposed) return

    this.showStartupError(state)
    // 取得中にイベントで新しい状態を受け取っていれば、そちらを使う
    if (!this.latestState) this.latestState = state
    this.ready = true
    await this.enqueue(() => this.doReconcile())
  }

  private installGlobals(): void {
    defineConstant(this.globalObject, SHARED_MODULES_GLOBAL, this.sharedModules)
    defineConstant(this.globalObject, PLUGIN_HOST_GLOBAL, this.slot.facade)
    if (!this.disposed) this.slot.current = this.binding
  }

  private subscribeEvents(): void {
    this.unsubscribers.push(
      this.backend.onStateChanged(state => {
        if (this.disposed) return
        this.acceptState(state)
        if (this.ready) void this.enqueue(() => this.doReconcile())
      }),
      this.backend.onSettingsChanged(e => this.handleSettingsChanged(e)),
      this.backend.onStopRequest(e => this.handleStopRequest(e)),
      this.registries.keymaps.store.subscribe(() =>
        this.scheduleConflictReport()
      )
    )
  }

  private handleSettingsChanged(e: SettingsChangedPayload): void {
    if (this.disposed) return
    if (!e || typeof e.values !== 'object' || e.values === null) return
    const entry = this.loaded.get(e.id)
    if (entry?.desired.manifest.type !== 'feature') return
    entry.settingsFromEvent = true
    this.registries.settings.setValues(e.id, e.values)
  }

  /** 停止してから（読み込んでいなくても）必ず ack を返す */
  private handleStopRequest(e: StopRequestPayload): void {
    // Suppress queued reconciles immediately, until this operation publishes
    // its final state (including rollback to the same generation on failure).
    this.stopRequests.set(e.id, e.requestId)
    void this.enqueue(async () => {
      try {
        await this.stopPluginSafely(e.id)
      } finally {
        try {
          await this.backend.ackStop(e.requestId)
        } catch (error) {
          console.error('[notyra] failed to acknowledge plugin stop:', error)
        }
      }
    })
  }

  private showStartupError(state: PluginStateView): void {
    if (this.windowKind !== 'main' || !state.startupError) return
    try {
      const format = this.deps.formatStartupError ?? defaultFormatStartupError
      this.deps.toast.error(format(state.startupError))
    } catch (error) {
      console.error(error)
    }
  }

  // -------------------------------------------------------------------------
  // 差分調停
  // -------------------------------------------------------------------------

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task).catch((error: unknown) => {
      console.error('[notyra] plugin host task failed:', error)
    })
    this.queue = run
    return run
  }

  private async doReconcile(): Promise<void> {
    if (this.disposed) return
    const state = this.latestState
    if (!state) return
    this.installGlobals()

    this.registries.setLoadOrder(state.plugins.map(p => p.id))
    const desired = computeDesiredPlugins(
      state,
      this.deps.appVersion,
      this.windowKind
    ).filter(plugin => !this.stopRequests.has(plugin.id))
    const { toStop, toLoad } = diffLoaded(
      desired,
      [...this.loaded.values()].map(e => ({ id: e.id, loadKey: e.loadKey }))
    )

    for (const id of toStop) {
      await this.stopPluginSafely(id)
    }
    const toLoadIds = new Set(toLoad.map(plugin => plugin.id))
    // Retry conflicts after stops have released their registrations, checking
    // each candidate in load order so only the first available theme wins.
    for (const plugin of desired) {
      if (this.disposed) break
      if (this.stopRequests.has(plugin.id)) continue
      const previous = this.loaded.get(plugin.id)
      const retryTheme =
        previous?.conflictingThemeId !== undefined &&
        !this.registries.themes.has(previous.conflictingThemeId)
      if (!toLoadIds.has(plugin.id) && !retryTheme) continue
      if (retryTheme) await this.stopPluginSafely(plugin.id)
      try {
        await this.loadPlugin(plugin)
      } catch (error) {
        // loadPlugin は失敗を自身で報告する。ここに来るのは想定外の例外のみ
        console.error(error)
      }
    }
    this.scheduleConflictReport()
  }

  private async loadPlugin(desired: DesiredPlugin): Promise<void> {
    const entry: LoadedPlugin = {
      id: desired.id,
      loadKey: desired.loadKey,
      desired,
      session: new PluginSession(desired.id),
      module: null,
      failed: false,
      settingsFromEvent: false,
    }
    this.loaded.set(desired.id, entry)

    if (desired.manifest.type === 'theme') {
      await this.loadTheme(entry, desired.manifest)
    } else {
      await this.loadFeature(entry, desired.manifest)
    }
  }

  private async loadTheme(
    entry: LoadedPlugin,
    manifest: ThemeManifest
  ): Promise<void> {
    const { id } = entry
    let theme: unknown
    try {
      theme = JSON.parse(await this.backend.readText(id, manifest.theme))
    } catch (error) {
      this.failLoad(entry, 'theme', error)
      return
    }

    const result = this.registries.themes.register(id, theme)
    if (!result.ok) {
      if (result.reason === 'duplicateId')
        entry.conflictingThemeId = result.themeId
      this.failLoad(
        entry,
        'theme',
        new Error(
          result.reason === 'duplicateId'
            ? `Theme ID "${result.themeId}" is already used by another theme`
            : 'The color theme definition is invalid'
        )
      )
      return
    }
    entry.session.track(result.disposable)

    if (manifest.themeCss !== undefined) {
      try {
        const css = await this.backend.readText(id, manifest.themeCss)
        entry.session.track(
          this.registries.styles.add(id, css, {
            whenThemeId: (theme as { id: string }).id,
          })
        )
      } catch (error) {
        // テーマ自体は使えるため、追加CSSの失敗だけを報告する
        this.reportError(id, 'theme', error)
      }
    }
    entry.session.activated = true
  }

  private async loadFeature(
    entry: LoadedPlugin,
    manifest: FeatureManifest
  ): Promise<void> {
    const { id } = entry

    let values: Record<string, unknown>
    try {
      values = await this.backend.getSettings(id)
    } catch (error) {
      this.failLoad(entry, 'load', error)
      return
    }
    if (!entry.settingsFromEvent) {
      this.registries.settings.setValues(id, values ?? {})
    }

    let mod: PluginModule
    try {
      const createNonce = this.deps.createNonce ?? defaultCreateNonce
      const importModule = this.deps.importModule ?? defaultImportModule
      const url = buildPluginFileUrl(
        this.base,
        id,
        createNonce(),
        manifest.main
      )
      const result = await runWithTimeout(
        () => importModule(url),
        this.timeoutMs
      )
      if (!result.ok) throw result.error
      mod = toPluginModule(result.value)
    } catch (error) {
      // activate() は呼ばない（Requirement 8.14）。評価中の登録は巻き戻す
      this.failLoad(entry, 'load', error)
      return
    }
    entry.module = mod

    const result = await runWithTimeout(() => mod.activate?.(), this.timeoutMs)
    if (result.ok) {
      entry.session.activated = true
      return
    }

    // activate() の開始以降の登録をすべて解除し、無効化を永続化する（Requirement 8.5）
    entry.failed = true
    this.disposeSession(entry, 'activate')
    try {
      await this.backend.setEnabled(id, false, 'activateFailed')
    } catch (error) {
      console.error('[notyra] failed to disable the plugin:', error)
    }
    this.reportError(id, 'activate', result.error)
  }

  private failLoad(
    entry: LoadedPlugin,
    source: PluginErrorSource,
    error: unknown
  ): void {
    entry.failed = true
    this.disposeSession(entry, source)
    this.reportError(entry.id, source, error)
  }

  /** Plugin_Stop。失敗しても例外を送出しない */
  private async stopPluginSafely(id: string): Promise<void> {
    try {
      await this.stopPlugin(id)
    } catch (error) {
      console.error(error)
      this.loaded.delete(id)
    }
  }

  private async stopPlugin(id: string): Promise<void> {
    const entry = this.loaded.get(id)
    if (!entry) return

    const mod = entry.module
    if (entry.session.activated && !entry.session.disposed && mod?.deactivate) {
      const result = await runWithTimeout(
        () => mod.deactivate?.(),
        this.timeoutMs
      )
      // 失敗しても拡張の解除を続行する（Requirement 8.9）
      if (!result.ok) this.reportError(id, 'deactivate', result.error)
    }
    this.disposeSession(entry, 'deactivate')
    this.loaded.delete(id)
    this.registries.settings.clear(id)
  }

  private disposeSession(entry: LoadedPlugin, source: PluginErrorSource) {
    for (const error of entry.session.disposeAll()) {
      this.reportError(entry.id, source, error)
    }
  }

  // -------------------------------------------------------------------------
  // キーバインドの重複
  // -------------------------------------------------------------------------

  /**
   * メインウィンドウのキーバインド重複を Rust に送る（Plugins_Tab が表示する）。
   * 同じ tick 内の変更はまとめ、内容が変わったときだけ送る。
   */
  private scheduleConflictReport(): void {
    if (this.windowKind !== 'main' || this.disposed) return
    if (this.conflictReportScheduled) return
    this.conflictReportScheduled = true
    queueMicrotask(() => {
      this.conflictReportScheduled = false
      if (this.disposed) return
      const conflicts: KeybindingConflict[] = [
        ...this.registries.keymaps.getResolution().conflicts,
      ]
      const serialized = JSON.stringify(conflicts)
      if (serialized === this.lastReportedConflicts) return
      this.lastReportedConflicts = serialized
      try {
        this.backend
          .reportKeybindingConflicts(conflicts)
          .catch((error: unknown) => console.error(error))
      } catch (error) {
        console.error(error)
      }
    })
  }

  // -------------------------------------------------------------------------
  // 補助
  // -------------------------------------------------------------------------

  private displayNameOf(id: string): string {
    const loaded = this.loaded.get(id)
    if (loaded) return loaded.desired.manifest.displayName
    return id
  }
}
