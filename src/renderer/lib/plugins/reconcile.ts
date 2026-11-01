import { parseManifest } from '@/shared/plugin/manifest'
import type {
  InstalledPluginView,
  Permission,
  PluginManifest,
  PluginSource,
  PluginStateView,
} from '@/shared/plugin/types'
import { isCompatible } from './compat'

/** Plugin_Host_Window の種類 */
export type PluginWindowKind = 'main' | 'note'

/** Plugin_Host_Window が「読み込まれているべき」Plugin */
export interface DesiredPlugin {
  id: string
  /**
   * 読み込み単位を区別するキー（`id@version#generation`）。
   * 更新・開発者モードの再読み込みで変わる。
   */
  loadKey: string
  version: string
  generation: number
  source: PluginSource
  /** package.json を解析したマニフェスト */
  manifest: PluginManifest
  /** Installed_Plugin_State の配列上の位置（= Load_Order） */
  loadOrderIndex: number
  consentedPermissions: Permission[]
  consentedDestinations: string[]
}

/** Plugin_Host_Window で現在読み込まれている Plugin */
export interface LoadedPluginInfo {
  id: string
  loadKey: string
}

export interface LoadDiff {
  /** 停止すべき読み込み済み Plugin の Plugin_ID（読み込み済みの順、重複なし） */
  toStop: string[]
  /** 新たに読み込むべき Plugin（Load_Order 順） */
  toLoad: DesiredPlugin[]
}

export function makeLoadKey(
  id: string,
  version: string,
  generation: number
): string {
  return `${id}@${version}#${generation}`
}

function isLoadable(
  plugin: InstalledPluginView,
  manifest: PluginManifest,
  appVersion: string,
  developerMode: boolean
): boolean {
  if (!plugin.enabled) return false
  if (plugin.pendingConsent !== undefined) return false
  if (plugin.source.type === 'local' && !developerMode) return false
  return isCompatible(manifest.notyraVersion, appVersion)
}

/**
 * 現在の状態から、Plugin_Host_Window に読み込むべき Plugin を Load_Order 順に返す。
 *
 * 対象は「有効」かつ「互換」かつ「同意待ちでない」かつ
 * 「Developer_Plugin なら Developer_Mode が有効」な Plugin。
 * package.json が読めない、または解析に失敗した Plugin は対象外とする。
 * 入力の state は変更しない。
 *
 * `windowKind` は現時点では読み込み対象の決定に影響しない
 * （Theme_Plugin・Feature_Plugin とも全 Plugin_Host_Window で読み込む）。
 */
export function computeDesiredPlugins(
  state: PluginStateView,
  appVersion: string,
  _windowKind: PluginWindowKind
): DesiredPlugin[] {
  const desired: DesiredPlugin[] = []

  state.plugins.forEach((plugin, index) => {
    if (plugin.packageJson === null) return
    const parsed = parseManifest(plugin.packageJson)
    if (!parsed.ok) return
    const manifest = parsed.value
    if (!isLoadable(plugin, manifest, appVersion, state.developerMode)) return

    desired.push({
      id: plugin.id,
      loadKey: makeLoadKey(plugin.id, plugin.version, plugin.generation),
      version: plugin.version,
      generation: plugin.generation,
      source: cloneSource(plugin.source),
      manifest,
      loadOrderIndex: index,
      consentedPermissions: [...plugin.consentedPermissions],
      consentedDestinations: [...plugin.consentedDestinations],
    })
  })

  return desired
}

function cloneSource(source: PluginSource): PluginSource {
  return source.type === 'github'
    ? { type: 'github', owner: source.owner, repo: source.repo }
    : { type: 'local', path: source.path }
}

/**
 * あるべき読み込み状態と現在の読み込み状態の差分を取る。
 *
 * - toStop: 読み込み済みのうち、desired に同じ loadKey がないものの Plugin_ID
 * - toLoad: desired のうち、同じ loadKey が読み込まれていないもの（Load_Order 順）
 *
 * 同じ Plugin_ID で loadKey が異なる場合（更新・再読み込み）は、
 * toStop と toLoad の両方に現れる。
 */
export function diffLoaded(
  desired: readonly DesiredPlugin[],
  loaded: readonly LoadedPluginInfo[]
): LoadDiff {
  const desiredKeys = new Set(desired.map(d => d.loadKey))
  const loadedKeys = new Set(loaded.map(l => l.loadKey))

  const toStop: string[] = []
  const stopped = new Set<string>()
  for (const l of loaded) {
    if (desiredKeys.has(l.loadKey) || stopped.has(l.id)) continue
    stopped.add(l.id)
    toStop.push(l.id)
  }

  const toLoad = desired.filter(d => !loadedKeys.has(d.loadKey))

  return { toStop, toLoad }
}
