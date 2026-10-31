import { useId, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import type { InstallOutcome } from '@/renderer/lib/plugins/manager/pluginManager'
import { toPluginApiError } from '@/renderer/lib/plugins/pluginError'
import { parseRepoSpec } from '@/renderer/lib/plugins/repoSpec'
import { parseManifest } from '@/shared/plugin/manifest'
import type { PluginStateView } from '@/shared/plugin/types'
import { Button } from '../../ui/button'
import {
  describePluginManagerError,
  formatPluginApiError,
} from './pluginErrorMessage'

export interface RepoInstallFormProps {
  /** リポジトリ指定でインストールする（`manager.installFromRepo(spec)`） */
  onInstall: (spec: string) => Promise<InstallOutcome>
  /** Third_Party_Warning が未確認の間は true（Requirement 1.5） */
  disabled?: boolean
}

type Result =
  | { type: 'error'; summary: string; details: string[] }
  | { type: 'success'; name: string }

/** インストールした Plugin の表示名（読めなければ Plugin_ID） */
function installedName(state: PluginStateView, id: string): string {
  const plugin = state.plugins.find(p => p.id === id)
  if (plugin?.packageJson == null) return id
  const parsed = parseManifest(plugin.packageJson)
  return parsed.ok ? parsed.value.displayName : id
}

/**
 * リポジトリ指定によるインストールのフォーム（Requirement 3.1、3.2）。
 *
 * 送信前に `parseRepoSpec` で入力形式を検証し、不正なら通信せずに入力欄へエラーを表示する。
 * GitHub・マニフェスト（全件）・重複・互換のエラーはフォームの下に表示する。
 * Plugin 由来の文言はテキストノードとして描画する。
 */
export function RepoInstallForm({
  onInstall,
  disabled = false,
}: RepoInstallFormProps) {
  const { t } = useTranslation()
  const inputId = useId()
  const formatErrorId = useId()
  const [value, setValue] = useState('')
  const [pending, setPending] = useState(false)
  const [formatError, setFormatError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  const inactive = disabled || pending

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (inactive) return
    setResult(null)

    const spec = parseRepoSpec(value)
    if ('error' in spec) {
      setFormatError(
        t(
          spec.error === 'empty'
            ? 'plugins.errors.repoSpecEmpty'
            : 'plugins.errors.repoSpecFormat'
        )
      )
      return
    }
    setFormatError(null)

    setPending(true)
    try {
      const outcome = await onInstall(value)
      switch (outcome.status) {
        case 'installed':
          setValue('')
          setResult({
            type: 'success',
            name: installedName(outcome.state, outcome.id),
          })
          break
        case 'cancelled':
          break
        case 'failed': {
          const { summary, details } = describePluginManagerError(
            t,
            outcome.error
          )
          if (outcome.error.kind === 'repoSpec') {
            setFormatError(summary)
          } else {
            setResult({ type: 'error', summary, details })
          }
          break
        }
      }
    } catch (err) {
      setResult({
        type: 'error',
        summary: formatPluginApiError(t, toPluginApiError(err)),
        details: [],
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="flex flex-col gap-2" data-testid="repo-install-form">
      <h4 className="text-sm font-medium text-foreground">
        {t('plugins.repoInstall.title')}
      </h4>
      <form
        className="flex flex-col gap-1"
        noValidate
        onSubmit={e => void handleSubmit(e)}
      >
        <label className="text-xs text-muted-foreground" htmlFor={inputId}>
          {t('plugins.repoInstall.label')}
        </label>
        <div className="flex gap-2">
          <input
            aria-describedby={formatError !== null ? formatErrorId : undefined}
            aria-invalid={formatError !== null}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 disabled:opacity-50 aria-[invalid=true]:border-destructive"
            disabled={inactive}
            id={inputId}
            onChange={e => {
              setValue(e.target.value)
              setFormatError(null)
            }}
            placeholder={t('plugins.repoInstall.placeholder')}
            spellCheck={false}
            type="text"
            value={value}
          />
          <Button disabled={inactive} size="md" type="submit" variant="primary">
            {pending
              ? t('plugins.repoInstall.installing')
              : t('plugins.repoInstall.install')}
          </Button>
        </div>
        {formatError !== null && (
          <p
            className="text-xs text-destructive"
            data-testid="repo-install-format-error"
            id={formatErrorId}
          >
            {formatError}
          </p>
        )}
      </form>

      {result?.type === 'error' && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive"
          data-testid="repo-install-error"
          role="alert"
        >
          <p className="break-words">{result.summary}</p>
          {result.details.length > 0 && (
            <ul
              className="mt-1 list-disc space-y-0.5 pl-5 break-words"
              data-testid="repo-install-error-details"
            >
              {result.details.map((line, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 同じ文言のエラーが複数ありうる
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {result?.type === 'success' && (
        <p
          className="text-xs text-foreground"
          data-testid="repo-install-success"
          role="status"
        >
          {t('plugins.repoInstall.installed', { name: result.name })}
        </p>
      )}
    </section>
  )
}
