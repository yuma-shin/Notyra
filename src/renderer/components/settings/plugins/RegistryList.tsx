import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuExternalLink, LuRefreshCw, LuSearch } from 'react-icons/lu'
import { filterRegistry, parseRegistry } from '@/renderer/lib/plugins/registry'
import { parseRepoSpec } from '@/renderer/lib/plugins/repoSpec'
import { tauriApi } from '@/renderer/lib/tauriApi'
import type { RegistryEntry } from '@/shared/plugin/types'
import { Button } from '../../ui/button'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; entries: RegistryEntry[] }
  | { status: 'error'; reason: 'fetch' | 'invalid'; message?: string }

export interface RegistryListProps {
  /**
   * インストール済みの Plugin_ID（Installed_Plugin_State のすべての Plugin。Developer_Plugin を含む）。
   * レジストリの Plugin_ID がこの集合に含まれるエントリをインストール済みとして表示する（Requirement 4.3）
   */
  installedIds: ReadonlySet<string>
  /** インストールボタン押下時の処理。エラーの表示は呼び出し側が行う */
  onInstall: (entry: RegistryEntry) => Promise<void>
  /** Third_Party_Warning 未確認時など、インストール操作を無効化する（Requirement 1.5） */
  disabled?: boolean
  /** Plugin_Registry の JSON 文字列を取得する。既定は `tauriApi.plugins.fetchRegistry` */
  fetchRegistry?: () => Promise<string>
  /** 外部ブラウザで URL を開く。既定は `tauriApi.shell.openExternal` */
  openExternal?: (url: string) => unknown
}

function defaultFetchRegistry(): Promise<string> {
  const plugins = (tauriApi as Partial<typeof tauriApi>).plugins
  if (!plugins) {
    return Promise.reject(new Error('Plugin API is not available'))
  }
  return plugins.fetchRegistry()
}

function defaultOpenExternal(url: string): unknown {
  return tauriApi.shell.openExternal(url)
}

/** レジストリの `repo`（`owner/repo` または GitHub URL）からリポジトリの URL を作る */
export function repositoryUrl(repo: string): string | null {
  const spec = parseRepoSpec(repo)
  if ('error' in spec) return null
  return `https://github.com/${spec.owner}/${spec.repo}`
}

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.message !== '') return error.message
  if (typeof error === 'string' && error !== '') return error
  return undefined
}

/**
 * Plugin_Registry の一覧（Requirement 4）。
 *
 * 表示時に Plugin_Registry を取得・解析し、検索・インストール済み表示・インストールボタンを提供する。
 * 取得・解析に失敗した場合はエラー、再試行ボタン、リポジトリ指定によるインストールの案内を表示する。
 * Plugin 由来の文言（名前・説明・作者）は翻訳せず、テキストノードとして描画する（Requirement 1.10）。
 */
export function RegistryList({
  installedIds,
  onInstall,
  disabled = false,
  fetchRegistry = defaultFetchRegistry,
  openExternal = defaultOpenExternal,
}: RegistryListProps) {
  const { t } = useTranslation()
  const headingId = useId()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [installingId, setInstallingId] = useState<string | null>(null)

  // 最新の取得要求だけを反映する（再試行の連打やアンマウント後の更新を防ぐ）
  const requestSeqRef = useRef(0)
  const fetchRef = useRef(fetchRegistry)
  fetchRef.current = fetchRegistry

  const load = useCallback(async () => {
    const seq = ++requestSeqRef.current
    setState({ status: 'loading' })
    let json: string
    try {
      json = await fetchRef.current()
    } catch (error) {
      if (seq === requestSeqRef.current) {
        setState({
          status: 'error',
          reason: 'fetch',
          message: errorMessage(error),
        })
      }
      return
    }
    if (seq !== requestSeqRef.current) return
    const result = parseRegistry(json)
    setState(
      result.ok
        ? { status: 'ready', entries: result.value }
        : { status: 'error', reason: 'invalid' }
    )
  }, [])

  useEffect(() => {
    void load()
    return () => {
      // アンマウント後に届いた結果を無視する
      requestSeqRef.current++
    }
  }, [load])

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const handleInstall = useCallback(
    async (entry: RegistryEntry) => {
      setInstallingId(entry.id)
      try {
        await onInstall(entry)
      } catch (error) {
        // エラーの表示は onInstall の呼び出し側（PluginsSection）の責務
        console.error(error)
      } finally {
        if (mountedRef.current) setInstallingId(null)
      }
    },
    [onInstall]
  )

  const visible = useMemo(
    () =>
      state.status === 'ready' ? filterRegistry(state.entries, query) : [],
    [state, query]
  )

  return (
    <section aria-labelledby={headingId} data-testid="registry-list">
      <h3 className="mb-3 text-sm font-medium" id={headingId}>
        {t('plugins.registry.title')}
      </h3>

      {state.status === 'loading' && (
        <p
          className="text-sm text-muted-foreground"
          data-testid="registry-loading"
          role="status"
        >
          {t('plugins.registry.loading')}
        </p>
      )}

      {state.status === 'error' && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
          data-testid="registry-error"
          role="alert"
        >
          <p className="font-medium text-destructive">
            {t('plugins.registry.error')}
          </p>
          {state.reason === 'invalid' ? (
            <p className="mt-1 text-caption">
              {t('plugins.errors.registryInvalid')}
            </p>
          ) : state.message !== undefined ? (
            <p className="mt-1 text-caption break-words">{state.message}</p>
          ) : null}
          <p
            className="mt-2 text-caption text-muted-foreground"
            data-testid="registry-unavailable-hint"
          >
            {t('plugins.registry.unavailableHint')}
          </p>
          <Button
            className="mt-2"
            onClick={() => void load()}
            size="sm"
            variant="secondary"
          >
            <LuRefreshCw size={14} />
            {t('plugins.registry.retry')}
          </Button>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          <div className="relative mb-3">
            <LuSearch
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
              size={14}
            />
            <input
              aria-label={t('plugins.registry.searchPlaceholder')}
              className="w-full rounded-lg border border-border bg-background py-1.5 pr-3 pl-9 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2"
              onChange={e => setQuery(e.target.value)}
              placeholder={t('plugins.registry.searchPlaceholder')}
              type="search"
              value={query}
            />
          </div>

          {state.entries.length === 0 ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="registry-empty"
            >
              {t('plugins.registry.empty')}
            </p>
          ) : visible.length === 0 ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="registry-search-empty"
            >
              {t('plugins.registry.searchEmpty')}
            </p>
          ) : (
            <ul className="space-y-2" data-testid="registry-entries">
              {visible.map(entry => (
                <RegistryItem
                  disabled={disabled || installingId !== null}
                  entry={entry}
                  installed={installedIds.has(entry.id)}
                  installing={installingId === entry.id}
                  key={entry.id}
                  onInstall={handleInstall}
                  openExternal={openExternal}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

interface RegistryItemProps {
  entry: RegistryEntry
  installed: boolean
  installing: boolean
  disabled: boolean
  onInstall: (entry: RegistryEntry) => void
  openExternal: (url: string) => unknown
}

function RegistryItem({
  entry,
  installed,
  installing,
  disabled,
  onInstall,
  openExternal,
}: RegistryItemProps) {
  const { t } = useTranslation()
  const url = repositoryUrl(entry.repo)

  return (
    <li
      className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
      data-plugin-id={entry.id}
      data-testid="registry-entry"
    >
      <div className="min-w-0 flex-1">
        <div
          className="text-sm font-medium break-words"
          data-testid="registry-entry-name"
        >
          {entry.name}
        </div>
        <p
          className="mt-0.5 text-caption break-words text-muted-foreground"
          data-testid="registry-entry-description"
        >
          {entry.description}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
          <span className="break-words" data-testid="registry-entry-author">
            {t('plugins.registry.author', { author: entry.author })}
          </span>
          {url !== null && (
            <a
              aria-label={t('plugins.registry.openRepository', {
                repo: entry.repo,
              })}
              className="inline-flex items-center gap-1 text-primary hover:underline"
              href={url}
              onClick={e => {
                e.preventDefault()
                void Promise.resolve(openExternal(url)).catch(error =>
                  console.error(error)
                )
              }}
              rel="noreferrer noopener"
              target="_blank"
            >
              <LuExternalLink aria-hidden="true" size={12} />
              {t('plugins.registry.repository')}
            </a>
          )}
        </div>
      </div>

      <div className="shrink-0">
        {installed ? (
          <span
            className="inline-flex h-7 items-center rounded-md bg-secondary px-2.5 text-xs text-secondary-foreground"
            data-testid="registry-entry-installed"
          >
            {t('plugins.registry.installed')}
          </span>
        ) : (
          <Button
            data-testid="registry-entry-install"
            disabled={disabled}
            onClick={() => onInstall(entry)}
            size="sm"
            variant="primary"
          >
            {installing
              ? t('plugins.registry.installing')
              : t('plugins.registry.install')}
          </Button>
        )}
      </div>
    </li>
  )
}
