import type { TFunction } from 'i18next'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuFolderOpen } from 'react-icons/lu'
import type {
  InstallOutcome,
  OperationOutcome,
  PluginManagerError,
} from '../../../lib/plugins/manager/pluginManager'
import { cn } from '../../../lib/utils'
import { Button } from '../../ui/button'

export interface DeveloperModePanelProps {
  /** 永続化された Developer_Mode の有効/無効（Requirement 19.1） */
  developerMode: boolean
  /**
   * 切り替えとフォルダ選択を無効化する。
   * Third_Party_Warning が未確認の間は true を渡す（Requirement 1.5）
   */
  disabled?: boolean
  /** 呼び出し側で別の操作を実行中のとき true。操作を無効化する */
  busy?: boolean
  /** Developer_Mode を切り替える（PluginManager.setDeveloperMode。Requirement 19.2） */
  onToggle: (enabled: boolean) => Promise<OperationOutcome>
  /** ローカルフォルダを選択して読み込む（PluginManager.loadDevFolder。Requirement 19.4） */
  onLoadFolder: () => Promise<InstallOutcome>
  /** PluginManagerError を表示用の文言に変換する。省略時は最小限の変換を使う */
  formatError?: (error: PluginManagerError) => string
}

type Pending = 'toggle' | 'load' | null

/**
 * Developer_Mode の切り替えと、有効時のローカルフォルダ読み込み操作。
 *
 * 状態（`developerMode`）は props で受け取り、操作の結果は呼び出し側が
 * `plugins:state-changed` 経由で反映する。本コンポーネントは実行中の表示と
 * 失敗時のエラー表示だけを持つ。
 */
export function DeveloperModePanel({
  developerMode,
  disabled = false,
  busy = false,
  onToggle,
  onLoadFolder,
  formatError,
}: DeveloperModePanelProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const descriptionId = useId()
  const errorId = useId()
  const [pending, setPending] = useState<Pending>(null)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const format = (e: PluginManagerError): string =>
    formatError ? formatError(e) : formatDeveloperModeError(t, e)

  const run = async (
    kind: Exclude<Pending, null>,
    action: () => Promise<OperationOutcome | InstallOutcome>
  ) => {
    setPending(kind)
    setError(null)
    let message: string | null = null
    try {
      const outcome = await action()
      if (outcome.status === 'failed') message = format(outcome.error)
    } catch (e) {
      // PluginManager は例外を送出しない想定だが、念のため表示する
      message = t('plugins.errors.unknown', {
        message: e instanceof Error ? e.message : String(e),
      })
    }
    if (!mountedRef.current) return
    setPending(null)
    setError(message)
  }

  const inactive = disabled || busy || pending !== null

  const handleToggle = () => {
    if (inactive) return
    void run('toggle', () => onToggle(!developerMode))
  }

  const handleLoadFolder = () => {
    if (inactive) return
    void run('load', onLoadFolder)
  }

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3"
      data-testid="developer-mode-panel"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-foreground" id={titleId}>
            {t('plugins.developerMode.title')}
          </h3>
          <p className="text-xs text-muted-foreground" id={descriptionId}>
            {t('plugins.developerMode.description')}
          </p>
        </div>
        <button
          aria-checked={developerMode}
          aria-describedby={
            error ? `${descriptionId} ${errorId}` : descriptionId
          }
          aria-label={t('plugins.developerMode.toggle')}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
            'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            developerMode ? 'bg-primary' : 'bg-muted-foreground/30'
          )}
          disabled={inactive}
          onClick={handleToggle}
          role="switch"
          type="button"
        >
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none block size-4 rounded-full bg-background shadow transition-transform',
              developerMode ? 'translate-x-4.5' : 'translate-x-0.5'
            )}
          />
        </button>
      </div>

      {/* ローカルフォルダの選択は Developer_Mode が有効なときだけ表示する（Requirement 19.3） */}
      {developerMode && (
        <div>
          <Button
            aria-busy={pending === 'load'}
            disabled={inactive}
            onClick={handleLoadFolder}
            size="sm"
            variant="secondary"
          >
            <LuFolderOpen size={14} />
            {pending === 'load'
              ? t('plugins.developerMode.loading')
              : t('plugins.developerMode.loadFolder')}
          </Button>
        </div>
      )}

      {error && (
        <p
          className="text-xs text-destructive whitespace-pre-line"
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      )}
    </section>
  )
}

/**
 * PluginManagerError の最小限の文言変換（`formatError` を渡さない場合に使う）。
 * Plugins_Tab 全体で共通のヘルパーがある場合は `formatError` でそちらを渡す。
 */
export function formatDeveloperModeError(
  t: TFunction,
  error: PluginManagerError
): string {
  switch (error.kind) {
    case 'repoSpec':
      return t(
        error.reason === 'empty'
          ? 'plugins.errors.repoSpecEmpty'
          : 'plugins.errors.repoSpecFormat'
      )
    case 'manifestInvalid':
      return t('plugins.errors.manifestInvalid', {
        count: error.errors.length,
      })
    case 'idMismatch':
      return t('plugins.errors.idMismatch', {
        expected: error.expected,
        actual: error.actual,
      })
    case 'alreadyInstalled':
      return t('plugins.errors.alreadyInstalledWithId', { id: error.id })
    case 'incompatible':
      return t('plugins.errors.incompatible', {
        range: error.range,
        current: error.current,
      })
    case 'themeInvalid':
      return t('plugins.errors.themeInvalid', { message: error.message })
    case 'notInstalled':
      return t('plugins.errors.notInstalled')
    case 'developerModeDisabled':
      return t('plugins.errors.developerModeDisabled', {
        defaultValue: 'Developer mode is turned off',
      })
    case 'backend': {
      const { kind, message, details } = error.error
      const fields =
        typeof details === 'object' && details !== null
          ? (details as Record<string, unknown>)
          : {}
      return t(`plugins.errors.${kind}`, {
        ...fields,
        message,
        defaultValue: t('plugins.errors.unknown', { message }),
      })
    }
  }
}
