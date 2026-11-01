/**
 * PluginManager（設定ウィンドウのフロー制御）
 *
 * インストール・更新・有効化・無効化・アンインストール・開発者モードの手順を、UI から独立した
 * 関数として提供する。依存（tauriApi.plugins、Consent_Dialog、アプリバージョン、アプリ設定）は
 * 注入し、React には依存しない。
 *
 * 各操作は例外を送出せず、UI が表示できる構造化された結果を返す。
 */
import type { PluginApiError } from '@/shared/plugin/api'
import { parseManifest } from '@/shared/plugin/manifest'
import type {
  ClassifiedDestination,
  ConsentRequest,
  InstalledPluginView,
  InstallRecord,
  ManifestError,
  Permission,
  PermissionDeclaration,
  PluginAuthor,
  PluginManifest,
  PluginSource,
  PluginStateView,
  ThemeManifest,
} from '@/shared/plugin/types'
import type { AppSettings } from '@/shared/types'
import type { tauriApi } from '../../tauriApi'
import {
  builtinThemes,
  loadCustomThemes,
  validateTheme,
} from '../../themeManager'
import { isCompatible, isNewerVersion } from '../compat'
import { diffConsent } from '../permissionDiff'
import { parseRepoSpec } from '../repoSpec'
import { toPluginApiError } from '../pluginError'

// ---------------------------------------------------------------------------
// 依存
// ---------------------------------------------------------------------------

type PluginsBackend = typeof tauriApi.plugins

export type PluginManagerApi = Pick<
  PluginsBackend,
  | 'getState'
  | 'fetchRelease'
  | 'discardStaging'
  | 'commitInstall'
  | 'checkUpdate'
  | 'applyUpdate'
  | 'setEnabled'
  | 'uninstall'
  | 'setDeveloperMode'
  | 'selectDevFolder'
  | 'registerDev'
  | 'reloadDev'
  | 'setDevConsent'
  | 'classifyDestinations'
  | 'readText'
  | 'readStagingText'
>

export interface PluginManagerDeps {
  api: PluginManagerApi
  /** Notyra のアプリバージョン（= Plugin_API_Version） */
  appVersion: string
  /** Consent_Dialog を表示する。キャンセル・×・Esc は false */
  requestConsent(request: ConsentRequest): Promise<boolean>
  /** 選択中のカラーテーマ ID（`AppSettings.colorTheme`） */
  getSelectedThemeId(): string | undefined
  updateSettings(partial: Partial<AppSettings>): void
  /**
   * Plugin 以外のテーマ ID（組み込み・カスタム）。
   * これらと同じ ID の Plugin テーマは選択肢に追加されないため、Gray への切り替え対象にしない。
   */
  getReservedThemeIds?(): Iterable<string>
}

// ---------------------------------------------------------------------------
// 結果
// ---------------------------------------------------------------------------

export type PluginManagerError =
  /** リポジトリ指定が空、または形式が不正（通信しない。Requirement 3.2） */
  | { kind: 'repoSpec'; reason: 'empty' | 'format' }
  /** Manifest_Parser のエラー（全件。Requirement 3.10） */
  | { kind: 'manifestInvalid'; errors: ManifestError[] }
  /** レジストリの Plugin_ID と取得した Plugin_ID の不一致（Requirement 4.8） */
  | { kind: 'idMismatch'; expected: string; actual: string }
  /** インストール済み・Developer_Plugin との ID 重複（Requirement 3.11、19.5） */
  | { kind: 'alreadyInstalled'; id: string }
  /** 非互換（Requirement 5.2、10.7） */
  | { kind: 'incompatible'; range: string; current: string }
  /** Theme_Plugin のテーマ定義が不正（Requirement 11.3） */
  | { kind: 'themeInvalid'; message: string }
  /** 対象の Plugin がない、または操作の対象外（開発フォルダの更新など） */
  | { kind: 'notInstalled'; id: string }
  | { kind: 'developerModeDisabled' }
  /** Rust コマンドのエラー（GitHub・I/O など。`error.kind` で種別を判定する） */
  | { kind: 'backend'; error: PluginApiError }

export type InstallOutcome =
  | { status: 'installed'; id: string; state: PluginStateView }
  | { status: 'cancelled' }
  | { status: 'failed'; error: PluginManagerError }

export type UpdateCheckResult =
  | {
      id: string
      status: 'checked'
      installedVersion: string
      latestVersion: string
      hasUpdate: boolean
    }
  | { id: string; status: 'failed'; error: PluginManagerError }

export type UpdateOutcome =
  | { status: 'updated'; id: string; version: string; state: PluginStateView }
  | { status: 'cancelled' }
  | { status: 'failed'; error: PluginManagerError }

export type DevReloadOutcome =
  | { status: 'reloaded'; id: string; state: PluginStateView }
  /** 再同意がキャンセルされた。Plugin は停止したまま同意待ち（Requirement 19.14） */
  | { status: 'pendingConsent'; id: string }
  | { status: 'failed'; error: PluginManagerError }

export type OperationOutcome =
  | { status: 'done'; state: PluginStateView }
  | { status: 'failed'; error: PluginManagerError }

export interface PluginManager {
  /** `expectedId` はレジストリ経由のインストールで、レジストリに記載された Plugin_ID */
  installFromRepo(spec: string, expectedId?: string): Promise<InstallOutcome>
  /** 更新確認ボタンが押されたときにのみ呼ぶ（Requirement 10.2）。Developer_Plugin は対象外 */
  checkUpdates(): Promise<UpdateCheckResult[]>
  applyUpdate(id: string): Promise<UpdateOutcome>
  setEnabled(id: string, enabled: boolean): Promise<OperationOutcome>
  /** 確認ダイアログは呼び出し側（Plugins_Tab）で表示し、確定後に呼ぶ */
  uninstall(id: string): Promise<OperationOutcome>
  loadDevFolder(): Promise<InstallOutcome>
  reloadDev(id: string): Promise<DevReloadOutcome>
  setDeveloperMode(enabled: boolean): Promise<OperationOutcome>
}

/** Gray_Theme のテーマ ID（Requirement 11.7） */
export const GRAY_THEME_ID = 'gray'

// ---------------------------------------------------------------------------
// 補助
// ---------------------------------------------------------------------------

/** フロー内の中止を表す内部例外 */
class Abort extends Error {
  constructor(readonly error: PluginManagerError) {
    super(error.kind)
  }
}

const fail = (error: PluginManagerError): never => {
  throw new Abort(error)
}

function toManagerError(e: unknown): PluginManagerError {
  if (e instanceof Abort) return e.error
  return { kind: 'backend', error: toPluginApiError(e) }
}

/** バックエンド呼び出しの失敗を `backend` エラーとして中止する */
async function call<T>(p: Promise<T>): Promise<T> {
  try {
    return await p
  } catch (e) {
    throw new Abort({ kind: 'backend', error: toPluginApiError(e) })
  }
}

function authorName(author: PluginAuthor | undefined): string | undefined {
  if (author === undefined) return undefined
  return typeof author === 'string' ? author : author.name
}

function declaredPermissions(
  manifest: PluginManifest
): PermissionDeclaration[] {
  if (manifest.type !== 'feature') return []
  const seen = new Set<Permission>()
  return manifest.permissions.filter(p => {
    if (seen.has(p.name)) return false
    seen.add(p.name)
    return true
  })
}

function declaredDestinations(manifest: PluginManifest): string[] {
  if (manifest.type !== 'feature') return []
  return Array.from(new Set(manifest.networkDestinations ?? []))
}

function parseOrFail(packageJson: string): PluginManifest {
  const parsed = parseManifest(packageJson)
  if (!parsed.ok)
    return fail({ kind: 'manifestInvalid', errors: parsed.errors })
  return parsed.value
}

/** テーマ JSON を解析・検証し、テーマ ID を返す */
function parseTheme(text: string): string {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    return fail({
      kind: 'themeInvalid',
      message: e instanceof Error ? e.message : String(e),
    })
  }
  if (!validateTheme(data)) {
    return fail({
      kind: 'themeInvalid',
      message: 'The color theme definition is invalid',
    })
  }
  return (data as { id: string }).id
}

function defaultReservedThemeIds(): string[] {
  return [...builtinThemes, ...loadCustomThemes()].map(t => t.id)
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

export function createPluginManager(deps: PluginManagerDeps): PluginManager {
  const { api, appVersion } = deps
  const reservedThemeIds = deps.getReservedThemeIds ?? defaultReservedThemeIds

  const ensureCompatible = (manifest: PluginManifest): void => {
    if (!isCompatible(manifest.notyraVersion, appVersion)) {
      fail({
        kind: 'incompatible',
        range: manifest.notyraVersion,
        current: appVersion,
      })
    }
  }

  const ensureNotInstalled = (state: PluginStateView, id: string): void => {
    // Developer_Plugin も state.plugins に含まれる（Requirement 3.11、19.5）
    if (state.plugins.some(p => p.id === id)) {
      fail({ kind: 'alreadyInstalled', id })
    }
  }

  const classify = async (
    destinations: string[]
  ): Promise<ClassifiedDestination[]> =>
    destinations.length === 0
      ? []
      : await call(api.classifyDestinations(destinations))

  /** 同意前の staging でテーマ定義を検証する */
  const validateStagingTheme = async (
    stagingId: string,
    manifest: PluginManifest
  ): Promise<void> => {
    if (manifest.type !== 'theme') return
    parseTheme(await call(api.readStagingText(stagingId, manifest.theme)))
  }

  const consent = (request: ConsentRequest): Promise<boolean> =>
    call(deps.requestConsent(request))

  const findPlugin = async (
    id: string
  ): Promise<{ state: PluginStateView; plugin: InstalledPluginView }> => {
    const state = await call(api.getState())
    const plugin = state.plugins.find(p => p.id === id)
    if (!plugin) return fail({ kind: 'notInstalled', id })
    return { state, plugin }
  }

  /**
   * 選択中のカラーテーマを提供する Theme_Plugin かを判定する（Requirement 11.7）。
   * テーマ JSON はファイル削除前に読む必要があるため、操作の前に呼ぶ。
   * 判定できない場合（package.json やテーマ JSON が読めない）は false。
   */
  const providesSelectedTheme = async (
    plugin: InstalledPluginView
  ): Promise<boolean> => {
    const selected = deps.getSelectedThemeId()
    if (!selected || selected === GRAY_THEME_ID) return false
    for (const id of reservedThemeIds()) {
      if (id === selected) return false
    }
    if (plugin.packageJson === null) return false
    const parsed = parseManifest(plugin.packageJson)
    if (!parsed.ok || parsed.value.type !== 'theme') return false
    const manifest: ThemeManifest = parsed.value
    try {
      const text = await api.readText(plugin.id, manifest.theme)
      return parseTheme(text) === selected
    } catch {
      return false
    }
  }

  const switchToGray = (): void => {
    deps.updateSettings({ colorTheme: GRAY_THEME_ID })
  }

  /** 中止したフローの staging を削除する（失敗しても次回起動時に Rust が片付ける） */
  const discard = async (stagingId: string): Promise<void> => {
    try {
      await api.discardStaging(stagingId)
    } catch (e) {
      console.error('[plugins] failed to discard staging:', e)
    }
  }

  // --- インストール（Requirement 3、4、5.2、6） -----------------------------

  const installFromRepo = async (
    spec: string,
    expectedId?: string
  ): Promise<InstallOutcome> => {
    const repoSpec = parseRepoSpec(spec)
    if ('error' in repoSpec) {
      return {
        status: 'failed',
        error: { kind: 'repoSpec', reason: repoSpec.error },
      }
    }
    const source: PluginSource = {
      type: 'github',
      owner: repoSpec.owner,
      repo: repoSpec.repo,
    }

    let stagingId: string
    let packageJson: string
    try {
      ;({ stagingId, packageJson } = await api.fetchRelease(
        repoSpec.owner,
        repoSpec.repo,
        expectedId
      ))
    } catch (e) {
      // staging は作成されていない（Rust 側で失敗時に削除済み）
      return { status: 'failed', error: toManagerError(e) }
    }

    let committed = false
    try {
      const manifest = parseOrFail(packageJson)
      if (expectedId !== undefined && manifest.id !== expectedId) {
        fail({ kind: 'idMismatch', expected: expectedId, actual: manifest.id })
      }
      ensureNotInstalled(await call(api.getState()), manifest.id)
      ensureCompatible(manifest)
      await validateStagingTheme(stagingId, manifest)

      const permissions = declaredPermissions(manifest)
      const destinations = declaredDestinations(manifest)
      // Permission が0件でも同意を求める（Requirement 6.1）
      const accepted = await consent({
        mode: 'install',
        displayName: manifest.displayName,
        author: authorName(manifest.author),
        source,
        permissions,
        destinations: await classify(destinations),
      })
      if (!accepted) return { status: 'cancelled' }

      const record: InstallRecord = {
        id: manifest.id,
        version: manifest.version,
        source,
        consentedPermissions: permissions.map(p => p.name),
        consentedDestinations: destinations,
      }
      committed = true
      const state = await call(api.commitInstall(stagingId, record))
      return { status: 'installed', id: manifest.id, state }
    } catch (e) {
      return { status: 'failed', error: toManagerError(e) }
    } finally {
      // 中止時は staging を削除する（Requirement 3.16、6.7）。
      // commitInstall は成功時に staging を移動し、失敗時は Rust 側で削除する
      if (!committed) await discard(stagingId)
    }
  }

  // --- 更新（Requirement 10） ----------------------------------------------

  const checkUpdates = async (): Promise<UpdateCheckResult[]> => {
    let state: PluginStateView
    try {
      state = await api.getState()
    } catch (e) {
      console.error('[plugins] failed to get state:', e)
      return []
    }
    const targets = state.plugins.filter(p => p.source.type === 'github')
    return Promise.all(
      targets.map(async (p): Promise<UpdateCheckResult> => {
        try {
          const { version } = await api.checkUpdate(p.id)
          return {
            id: p.id,
            status: 'checked',
            installedVersion: p.version,
            latestVersion: version,
            hasUpdate: isNewerVersion(version, p.version),
          }
        } catch (e) {
          return { id: p.id, status: 'failed', error: toManagerError(e) }
        }
      })
    )
  }

  const applyUpdate = async (id: string): Promise<UpdateOutcome> => {
    let plugin: InstalledPluginView
    try {
      ;({ plugin } = await findPlugin(id))
    } catch (e) {
      return { status: 'failed', error: toManagerError(e) }
    }
    const source = plugin.source
    if (source.type !== 'github') {
      return { status: 'failed', error: { kind: 'notInstalled', id } }
    }

    let stagingId: string
    let packageJson: string
    try {
      ;({ stagingId, packageJson } = await api.fetchRelease(
        source.owner,
        source.repo,
        id
      ))
    } catch (e) {
      return { status: 'failed', error: toManagerError(e) }
    }

    let committed = false
    try {
      const manifest = parseOrFail(packageJson)
      if (manifest.id !== id) {
        fail({ kind: 'idMismatch', expected: id, actual: manifest.id })
      }
      ensureCompatible(manifest)
      await validateStagingTheme(stagingId, manifest)

      const diff = diffConsent(
        {
          permissions: plugin.consentedPermissions,
          destinations: plugin.consentedDestinations,
        },
        manifest
      )
      // 追加がある場合のみ、追加分について再同意を求める（Requirement 10.8、10.9）
      if (
        diff.addedPermissions.length > 0 ||
        diff.addedDestinations.length > 0
      ) {
        const added = new Set(diff.addedPermissions)
        const accepted = await consent({
          mode: 'update',
          displayName: manifest.displayName,
          author: authorName(manifest.author),
          source,
          permissions: declaredPermissions(manifest).filter(p =>
            added.has(p.name)
          ),
          destinations: await classify(diff.addedDestinations),
        })
        if (!accepted) return { status: 'cancelled' }
      }

      // 宣言から外れたものは同意済みから削除する（Requirement 10.12）。
      // 有効/無効は Rust 側で維持される（Requirement 10.13、10.15）
      const record: InstallRecord = {
        id,
        version: manifest.version,
        consentedPermissions: diff.nextConsent.permissions,
        consentedDestinations: diff.nextConsent.destinations,
      }
      committed = true
      const state = await call(api.applyUpdate(id, stagingId, record))
      return { status: 'updated', id, version: manifest.version, state }
    } catch (e) {
      return { status: 'failed', error: toManagerError(e) }
    } finally {
      if (!committed) await discard(stagingId)
    }
  }

  // --- 有効化・無効化・アンインストール（Requirement 9、11.7） --------------

  const setEnabled = async (
    id: string,
    enabled: boolean
  ): Promise<OperationOutcome> => {
    try {
      const { plugin } = await findPlugin(id)
      const switchTheme = !enabled && (await providesSelectedTheme(plugin))
      const state = await call(
        api.setEnabled(id, enabled, enabled ? undefined : 'user')
      )
      if (switchTheme) switchToGray()
      return { status: 'done', state }
    } catch (e) {
      return { status: 'failed', error: toManagerError(e) }
    }
  }

  const uninstall = async (id: string): Promise<OperationOutcome> => {
    try {
      const { plugin } = await findPlugin(id)
      const switchTheme = await providesSelectedTheme(plugin)
      const state = await call(api.uninstall(id))
      if (switchTheme) switchToGray()
      return { status: 'done', state }
    } catch (e) {
      return { status: 'failed', error: toManagerError(e) }
    }
  }

  // --- 開発者モード（Requirement 19） --------------------------------------

  const setDeveloperMode = async (
    enabled: boolean
  ): Promise<OperationOutcome> => {
    try {
      return { status: 'done', state: await api.setDeveloperMode(enabled) }
    } catch (e) {
      return { status: 'failed', error: toManagerError(e) }
    }
  }

  const loadDevFolder = async (): Promise<InstallOutcome> => {
    try {
      const state = await call(api.getState())
      if (!state.developerMode) fail({ kind: 'developerModeDisabled' })

      const folder = await call(api.selectDevFolder())
      if (folder === null) return { status: 'cancelled' }

      const manifest = parseOrFail(folder.packageJson)
      ensureNotInstalled(await call(api.getState()), manifest.id)
      ensureCompatible(manifest)

      const source: PluginSource = { type: 'local', path: folder.path }
      const permissions = declaredPermissions(manifest)
      const destinations = declaredDestinations(manifest)
      const accepted = await consent({
        mode: 'devLoad',
        displayName: manifest.displayName,
        author: authorName(manifest.author),
        source,
        permissions,
        destinations: await classify(destinations),
      })
      if (!accepted) return { status: 'cancelled' }

      const next = await call(
        api.registerDev(folder.path, {
          id: manifest.id,
          version: manifest.version,
          source,
          consentedPermissions: permissions.map(p => p.name),
          consentedDestinations: destinations,
        })
      )
      return { status: 'installed', id: manifest.id, state: next }
    } catch (e) {
      return { status: 'failed', error: toManagerError(e) }
    }
  }

  const reloadDev = async (id: string): Promise<DevReloadOutcome> => {
    try {
      // Rust 側で全ウィンドウの Plugin_Stop を待ってから package.json を読み直し、
      // 追加の Permission / 宛先があれば pendingConsent を記録して停止したままにする
      const { packageJson } = await call(api.reloadDev(id))
      const { state, plugin } = await findPlugin(id)
      const manifest = parseOrFail(packageJson)
      ensureCompatible(manifest)

      const pending = plugin.pendingConsent
      if (!pending) return { status: 'reloaded', id, state }

      const source = plugin.source
      const added = new Set(pending.addedPermissions)
      const accepted = await consent({
        mode: 'devReload',
        displayName: manifest.displayName,
        author: authorName(manifest.author),
        source,
        permissions: declaredPermissions(manifest).filter(p =>
          added.has(p.name)
        ),
        destinations: await classify(pending.addedDestinations),
      })
      // キャンセル時は停止したまま同意待ち。再読み込みボタンで再度同意を求める
      if (!accepted) return { status: 'pendingConsent', id }

      const next = await call(
        api.setDevConsent(id, {
          id,
          version: manifest.version,
          consentedPermissions: declaredPermissions(manifest).map(p => p.name),
          consentedDestinations: declaredDestinations(manifest),
        })
      )
      return { status: 'reloaded', id, state: next }
    } catch (e) {
      return { status: 'failed', error: toManagerError(e) }
    }
  }

  return {
    installFromRepo,
    checkUpdates,
    applyUpdate,
    setEnabled,
    uninstall,
    loadDevFolder,
    reloadDev,
    setDeveloperMode,
  }
}
