import { useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuChevronDown,
  LuChevronRight,
  LuRefreshCw,
  LuTrash2,
  LuTriangleAlert,
} from 'react-icons/lu'
import type {
  InstalledPluginView,
  KeybindingConflict,
  PluginAuthor,
  PluginErrorEntry,
  PluginManifest,
  SettingValue,
} from '@/shared/plugin/types'
import { isCompatible } from '../../../lib/plugins/compat'
import type {
  PluginManagerError,
  UpdateCheckResult,
} from '../../../lib/plugins/manager/pluginManager'
import { ConfirmDialog } from '../../ConfirmDialog'
import { Button } from '../../ui/button'
import { PluginSettingsForm, ToggleSwitch } from './PluginSettingsForm'

/** 項目ごとに実行中の操作 */
export type PluginBusyAction = 'toggle' | 'uninstall' | 'update' | 'reload'

/** `formatError` 未指定時の最小限の表示 */
export function defaultFormatError(error: PluginManagerError): string {
  return error.kind === 'backend' ? error.error.kind : error.kind
}

export function authorName(author: PluginAuthor | undefined): string | null {
  if (author === undefined) return null
  const name = typeof author === 'string' ? author : author.name
  return name === '' ? null : name
}

export interface InstalledPluginItemProps {
  plugin: InstalledPluginView
  /** package.json を解析したマニフェスト。読めない・解析に失敗した場合は null */
  manifest: PluginManifest | null
  appVersion: string
  updateCheck?: UpdateCheckResult
  /** この Plugin のセッション内エラー */
  errors?: readonly PluginErrorEntry[]
  /** この Plugin のキーバインド重複 */
  keybindingConflicts?: readonly KeybindingConflict[]
  /** Plugin_ID から表示名を引く（キーバインド重複の相手の表示に使う） */
  resolveDisplayName?: (id: string) => string
  busy?: PluginBusyAction
  /** 直近の操作（有効切替・更新・再読み込み・アンインストール）の失敗 */
  operationError?: PluginManagerError
  onToggleEnabled: (id: string, enabled: boolean) => void
  /** 確認ダイアログで確定したときだけ呼ばれる */
  onUninstall: (id: string) => void
  onUpdate: (id: string) => void
  onReloadDev: (id: string) => void
  formatError?: (error: PluginManagerError) => string
  loadSettings?: (id: string) => Promise<Record<string, unknown>>
  saveSetting?: (id: string, key: string, value: SettingValue) => Promise<void>
}

/**
 * インストール済み Plugin の1項目（Requirement 9.1、5.5、5.7、10.4、10.5、16.8、16.9、19.8、19.9）。
 * 状態と操作は props で受け取る表示コンポーネント。
 * Plugin 由来の文言は翻訳せず、テキストとして描画する（Requirement 1.10）。
 */
export function InstalledPluginItem({
  plugin,
  manifest,
  appVersion,
  updateCheck,
  errors = [],
  keybindingConflicts = [],
  resolveDisplayName = id => id,
  busy,
  operationError,
  onToggleEnabled,
  onUninstall,
  onUpdate,
  onReloadDev,
  formatError = defaultFormatError,
  loadSettings,
  saveSetting,
}: InstalledPluginItemProps) {
  const { t } = useTranslation()
  const [confirmingUninstall, setConfirmingUninstall] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const displayName = manifest?.displayName ?? plugin.id
  const author = authorName(manifest?.author)
  const isDev = plugin.source.type === 'local'
  const incompatible =
    manifest !== null && !isCompatible(manifest.notyraVersion, appVersion)
  const isBusy = busy !== undefined
  const settingsDecls =
    manifest?.type === 'feature' ? (manifest.settings ?? []) : null
  const settingsRegionId = `plugin-settings-${plugin.id}`

  const hasUpdate =
    !isDev &&
    updateCheck?.status === 'checked' &&
    updateCheck.hasUpdate === true
  const updateError =
    !isDev && updateCheck?.status === 'failed' ? updateCheck.error : null

  return (
    <li
      aria-label={displayName}
      className="rounded-md border border-border p-3"
      data-plugin-id={plugin.id}
      data-testid="installed-plugin-item"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="truncate text-sm font-medium"
              data-testid="installed-plugin-name"
            >
              {displayName}
            </span>
            {manifest && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {manifest.type === 'theme'
                  ? t('plugins.installed.typeTheme')
                  : t('plugins.installed.typeFeature')}
              </span>
            )}
            {isDev && (
              <span
                className="rounded bg-accent px-1.5 py-0.5 text-xs text-accent-foreground"
                data-testid="installed-plugin-dev-badge"
              >
                {t('plugins.installed.development')}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-caption text-muted-foreground">
            <span>
              {t('plugins.installed.version', { version: plugin.version })}
            </span>
            {author !== null && (
              <span data-testid="installed-plugin-author">
                {t('plugins.installed.author', { author })}
              </span>
            )}
          </div>
          <div
            className="mt-0.5 break-all text-caption text-muted-foreground"
            data-testid="installed-plugin-source"
          >
            {t('plugins.installed.source')}:{' '}
            {plugin.source.type === 'github'
              ? t('plugins.installed.sourceGithub', {
                  owner: plugin.source.owner,
                  repo: plugin.source.repo,
                })
              : t('plugins.installed.sourceLocal', {
                  path: plugin.source.path,
                })}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="text-caption text-muted-foreground">
            {plugin.enabled
              ? t('plugins.installed.enabled')
              : t('plugins.installed.disabled')}
          </span>
          <ToggleSwitch
            aria-label={t('plugins.installed.toggleEnabled', {
              name: displayName,
            })}
            checked={plugin.enabled}
            disabled={incompatible || isBusy}
            onCheckedChange={enabled => onToggleEnabled(plugin.id, enabled)}
          />
        </div>
      </div>

      {/* 状態の表示 */}
      <div className="mt-2 space-y-1">
        {manifest === null && (
          <StatusLine testId="installed-plugin-manifest-unreadable">
            {t('plugins.installed.manifestUnreadable')}
          </StatusLine>
        )}
        {incompatible && manifest && (
          <StatusLine testId="installed-plugin-incompatible">
            {t('plugins.installed.incompatible', {
              range: manifest.notyraVersion,
              current: appVersion,
            })}
          </StatusLine>
        )}
        {plugin.pendingConsent !== undefined && (
          <StatusLine testId="installed-plugin-pending-consent">
            {t('plugins.installed.pendingConsent')}
          </StatusLine>
        )}
        {!plugin.enabled && plugin.disabledReason === 'activateFailed' && (
          <StatusLine testId="installed-plugin-activate-failed">
            {t('plugins.installed.activateFailed')}
          </StatusLine>
        )}
        {hasUpdate && updateCheck?.status === 'checked' && (
          <p
            className="text-caption text-primary"
            data-testid="installed-plugin-update-available"
          >
            {t('plugins.installed.updateAvailable', {
              version: updateCheck.latestVersion,
            })}
          </p>
        )}
        {updateError && (
          <p
            className="text-caption text-destructive"
            data-testid="installed-plugin-update-error"
            role="alert"
          >
            {formatError(updateError)}
          </p>
        )}
        {operationError && (
          <p
            className="text-caption text-destructive"
            data-testid="installed-plugin-operation-error"
            role="alert"
          >
            {formatError(operationError)}
          </p>
        )}
      </div>

      {keybindingConflicts.length > 0 && (
        <div
          className="mt-2"
          data-testid="installed-plugin-keybinding-conflicts"
        >
          <p className="text-caption font-medium">
            {t('plugins.installed.keybindingConflicts')}
          </p>
          <ul className="list-disc pl-5 text-caption text-muted-foreground">
            {keybindingConflicts.map(c => (
              <li key={`${c.key}\u0000${c.command}`}>
                {c.with === 'builtin'
                  ? t('plugins.installed.keybindingConflictBuiltin', {
                      key: c.key,
                      command: c.command,
                    })
                  : t('plugins.installed.keybindingConflictPlugin', {
                      key: c.key,
                      command: c.command,
                      plugin: resolveDisplayName(c.with.pluginId),
                    })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {errors.length > 0 && (
        <div className="mt-2" data-testid="installed-plugin-errors">
          <p className="text-caption font-medium">
            {t('plugins.installed.sessionErrors')}
          </p>
          <ul className="list-disc pl-5 text-caption text-destructive">
            {errors.map((e, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: PluginErrorEntry に一意な ID がなく、同時刻・同ウィンドウのエラーを区別するために添字を併用する（状態を持たない表示専用の行）
              <li key={`${e.at}\u0000${e.windowLabel}\u0000${i}`}>
                {t(`plugins.errorSource.${e.source}`)}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 操作 */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {settingsDecls !== null && (
          <Button
            aria-controls={settingsOpen ? settingsRegionId : undefined}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(open => !open)}
            size="sm"
            variant="secondary"
          >
            {settingsOpen ? (
              <LuChevronDown size={14} />
            ) : (
              <LuChevronRight size={14} />
            )}
            {t('plugins.installed.settings')}
          </Button>
        )}
        {hasUpdate && (
          <Button
            disabled={isBusy}
            onClick={() => onUpdate(plugin.id)}
            size="sm"
            variant="primary"
          >
            {busy === 'update'
              ? t('plugins.installed.updating')
              : t('plugins.installed.update')}
          </Button>
        )}
        {isDev && (
          <Button
            disabled={isBusy}
            onClick={() => onReloadDev(plugin.id)}
            size="sm"
            variant="secondary"
          >
            <LuRefreshCw size={14} />
            {busy === 'reload'
              ? t('plugins.installed.reloading')
              : t('plugins.installed.reload')}
          </Button>
        )}
        <Button
          disabled={isBusy}
          onClick={() => setConfirmingUninstall(true)}
          size="sm"
          variant="ghost"
        >
          <LuTrash2 size={14} />
          {t('plugins.installed.uninstall')}
        </Button>
      </div>

      {settingsOpen && settingsDecls !== null && (
        <div className="mt-3 border-t border-border pt-3" id={settingsRegionId}>
          <PluginSettingsForm
            displayName={displayName}
            loadSettings={loadSettings}
            pluginId={plugin.id}
            saveSetting={saveSetting}
            settings={settingsDecls}
          />
        </div>
      )}

      <ConfirmDialog
        confirmText={t('plugins.uninstallDialog.confirm')}
        isDanger
        isOpen={confirmingUninstall}
        message={t(
          isDev
            ? 'plugins.uninstallDialog.messageDev'
            : 'plugins.uninstallDialog.message',
          { name: displayName }
        )}
        onCancel={() => setConfirmingUninstall(false)}
        onConfirm={() => {
          setConfirmingUninstall(false)
          onUninstall(plugin.id)
        }}
        title={t('plugins.uninstallDialog.title')}
      />
    </li>
  )
}

function StatusLine({
  testId,
  children,
}: {
  testId: string
  children: React.ReactNode
}) {
  return (
    <p
      className="flex items-start gap-1.5 text-caption text-destructive"
      data-testid={testId}
    >
      <LuTriangleAlert className="mt-0.5 shrink-0" size={12} />
      <span>{children}</span>
    </p>
  )
}
