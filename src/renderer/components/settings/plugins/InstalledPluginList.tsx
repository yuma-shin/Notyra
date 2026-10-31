import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { parseManifest } from '@/shared/plugin/manifest'
import type {
  InstalledPluginView,
  KeybindingConflict,
  PluginErrorEntry,
  PluginManifest,
  SettingValue,
} from '@/shared/plugin/types'
import type {
  PluginManagerError,
  UpdateCheckResult,
} from '../../../lib/plugins/manager/pluginManager'
import {
  InstalledPluginItem,
  type PluginBusyAction,
} from './InstalledPluginItem'

export interface InstalledPluginListProps {
  /** Installed_Plugin_State（Load_Order 順） */
  plugins: readonly InstalledPluginView[]
  developerMode: boolean
  appVersion: string
  /** 更新確認の結果（Plugin_ID ごと） */
  updateChecks?: ReadonlyMap<string, UpdateCheckResult>
  /** セッション内エラー（全 Plugin 分） */
  errors?: readonly PluginErrorEntry[]
  /** キーバインド重複（全 Plugin 分） */
  keybindingConflicts?: readonly KeybindingConflict[]
  /** 実行中の操作（Plugin_ID ごと） */
  busy?: ReadonlyMap<string, PluginBusyAction>
  /** 直近の操作の失敗（Plugin_ID ごと） */
  operationErrors?: ReadonlyMap<string, PluginManagerError>
  onToggleEnabled: (id: string, enabled: boolean) => void
  /** アンインストールの確認ダイアログで確定したときだけ呼ばれる（Requirement 9.6） */
  onUninstall: (id: string) => void
  onUpdate: (id: string) => void
  onReloadDev: (id: string) => void
  formatError?: (error: PluginManagerError) => string
  loadSettings?: (id: string) => Promise<Record<string, unknown>>
  saveSetting?: (id: string, key: string, value: SettingValue) => Promise<void>
}

const EMPTY_ERRORS: readonly PluginErrorEntry[] = []
const EMPTY_CONFLICTS: readonly KeybindingConflict[] = []

function toManifest(packageJson: string | null): PluginManifest | null {
  if (packageJson === null) return null
  const parsed = parseManifest(packageJson)
  return parsed.ok ? parsed.value : null
}

/**
 * インストール済み Plugin の一覧（Requirement 9.1）。
 *
 * Developer_Plugin は Developer_Mode が有効なときだけ表示する（設計判断 #6）。
 */
export function InstalledPluginList({
  plugins,
  developerMode,
  appVersion,
  updateChecks,
  errors = EMPTY_ERRORS,
  keybindingConflicts = EMPTY_CONFLICTS,
  busy,
  operationErrors,
  onToggleEnabled,
  onUninstall,
  onUpdate,
  onReloadDev,
  formatError,
  loadSettings,
  saveSetting,
}: InstalledPluginListProps) {
  const { t } = useTranslation()

  // package.json が変わらない限り同じマニフェストを使う
  const manifests = useMemo(() => {
    const map = new Map<string, PluginManifest | null>()
    for (const p of plugins) map.set(p.id, toManifest(p.packageJson))
    return map
  }, [plugins])

  const visible = plugins.filter(
    p => developerMode || p.source.type !== 'local'
  )

  const resolveDisplayName = (id: string): string =>
    manifests.get(id)?.displayName ?? id

  return (
    <section aria-labelledby="plugins-installed-heading">
      <h4 className="mb-2 text-sm font-medium" id="plugins-installed-heading">
        {t('plugins.installed.title')}
      </h4>
      {visible.length === 0 ? (
        <p
          className="text-caption text-muted-foreground"
          data-testid="installed-plugins-empty"
        >
          {t('plugins.installed.empty')}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="installed-plugin-list">
          {visible.map(p => (
            <InstalledPluginItem
              appVersion={appVersion}
              busy={busy?.get(p.id)}
              errors={errors.filter(e => e.pluginId === p.id)}
              formatError={formatError}
              key={p.id}
              keybindingConflicts={keybindingConflicts.filter(
                c => c.pluginId === p.id
              )}
              loadSettings={loadSettings}
              manifest={manifests.get(p.id) ?? null}
              onReloadDev={onReloadDev}
              onToggleEnabled={onToggleEnabled}
              onUninstall={onUninstall}
              onUpdate={onUpdate}
              operationError={operationErrors?.get(p.id)}
              plugin={p}
              resolveDisplayName={resolveDisplayName}
              saveSetting={saveSetting}
              updateCheck={updateChecks?.get(p.id)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
