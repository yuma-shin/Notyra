import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import { LuGlobe, LuTriangleAlert, LuX } from 'react-icons/lu'
import type {
  ConsentRequest,
  Permission,
  PluginSource,
} from '@/shared/plugin/types'
import { Button } from '../../ui/button'
import { Dialog } from '../../ui/dialog'

type ConsentMode = ConsentRequest['mode']

const TITLE_KEYS: Record<ConsentMode, string> = {
  install: 'plugins.consent.titleInstall',
  update: 'plugins.consent.titleUpdate',
  devLoad: 'plugins.consent.titleDevLoad',
  devReload: 'plugins.consent.titleDevReload',
}

const ACCEPT_KEYS: Record<ConsentMode, string> = {
  install: 'plugins.consent.accept',
  update: 'plugins.consent.acceptUpdate',
  devLoad: 'plugins.consent.acceptLoad',
  devReload: 'plugins.consent.acceptLoad',
}

/** update / devReload では permissions と destinations は追加分のみ */
function isDiffMode(mode: ConsentMode): boolean {
  return mode === 'update' || mode === 'devReload'
}

/** i18next は `:` を名前空間区切りに使うため `.` に置き換える */
export function permissionKey(permission: Permission): string {
  return `plugins.permissions.${permission.replace(/:/g, '.')}`
}

export interface ConsentDialogProps {
  /** null のときは閉じる（閉じるアニメーション中は直前の内容を描画する） */
  request: ConsentRequest | null
  open: boolean
  /** 同意で true、キャンセル・×・Esc・オーバーレイのクリックで false */
  onResult: (accepted: boolean) => void
}

/**
 * Consent_Dialog。Plugin が要求する Permission と Declared_Destination を表示し、
 * 一括同意とキャンセルの2つの操作だけを提供する。
 *
 * Plugin が提供する文言（表示名・作者・Permission_Purpose・宛先）は翻訳せず、
 * React のテキストノードとして描画する（HTML として挿入しない）。
 */
export function ConsentDialog({ request, open, onResult }: ConsentDialogProps) {
  const { t } = useTranslation()
  const lastRequestRef = useRef<ConsentRequest | null>(request)
  if (request) lastRequestRef.current = request
  const shown = request ?? lastRequestRef.current

  if (!shown) return null

  const diff = isDiffMode(shown.mode)
  const hasNetwork = shown.permissions.some(p => p.name === 'network')
  const publicDests = shown.destinations.filter(d => d.class === 'public')
  const privateDests = shown.destinations.filter(d => d.class === 'private')
  const showDestinations = hasNetwork || shown.destinations.length > 0
  // update / devReload で追加 Permission がなく追加宛先だけがある場合、
  // 「権限を要求しない」は誤解を招くため表示しない
  const showNoPermissions =
    shown.permissions.length === 0 && (!diff || shown.destinations.length === 0)

  return (
    <Dialog
      className="relative max-h-[85vh] max-w-lg overflow-y-auto"
      onOpenChange={next => {
        if (!next) onResult(false)
      }}
      open={open && request !== null}
      title={t(TITLE_KEYS[shown.mode], { name: shown.displayName })}
    >
      <Button
        aria-label={t('titleBar.close')}
        className="absolute top-3 right-3"
        data-testid="consent-dialog-close"
        onClick={() => onResult(false)}
        size="iconSm"
        variant="ghost"
      >
        <LuX size={16} />
      </Button>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t('plugins.consent.author')}</dt>
        <dd className="break-words" data-testid="consent-author">
          {shown.author ?? t('plugins.consent.authorUnknown')}
        </dd>
        <dt className="text-muted-foreground">{t('plugins.consent.source')}</dt>
        <dd className="break-all" data-testid="consent-source">
          <SourceText source={shown.source} />
        </dd>
      </dl>

      <section className="mt-4">
        {showNoPermissions ? (
          <p className="text-sm" data-testid="consent-no-permissions">
            {t('plugins.consent.noPermissions')}
          </p>
        ) : shown.permissions.length > 0 ? (
          <>
            <h3 className="mb-2 text-sm font-medium">
              {diff
                ? t('plugins.consent.addedPermissions')
                : t('plugins.consent.permissions')}
            </h3>
            <ul className="space-y-2" data-testid="consent-permissions">
              {shown.permissions.map(p => (
                <li
                  className="rounded-md border border-border p-2 text-sm"
                  data-permission={p.name}
                  key={p.name}
                >
                  <div className="font-medium">
                    {t(`${permissionKey(p.name)}.label`)}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {p.name}
                    </span>
                  </div>
                  <p className="text-caption text-muted-foreground">
                    {t(`${permissionKey(p.name)}.description`)}
                  </p>
                  {p.purpose !== undefined && p.purpose !== '' && (
                    <p
                      className="mt-1 text-caption break-words"
                      data-testid="consent-purpose"
                    >
                      {t('plugins.consent.purpose', { purpose: p.purpose })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      {showDestinations && (
        <section className="mt-4 space-y-3">
          {publicDests.length > 0 && (
            <div
              className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
              data-testid="consent-public-warning"
            >
              <div className="mb-1 flex items-center gap-2 font-medium text-destructive">
                <LuTriangleAlert size={16} />
                {t('plugins.consent.publicWarningTitle')}
              </div>
              <p className="mb-2 text-caption">
                {t('plugins.consent.publicWarning')}
              </p>
              <DestinationList
                dests={publicDests.map(d => d.dest)}
                testId="consent-public-destinations"
              />
            </div>
          )}
          {privateDests.length > 0 && (
            <div className="text-sm">
              <h3 className="mb-1 flex items-center gap-2 font-medium">
                <LuGlobe size={14} />
                {diff
                  ? t('plugins.consent.addedDestinations')
                  : t('plugins.consent.destinations')}
                <span className="text-caption font-normal text-muted-foreground">
                  ({t('plugins.destinationClass.private')})
                </span>
              </h3>
              {publicDests.length === 0 && (
                <p
                  className="mb-1 text-caption text-muted-foreground"
                  data-testid="consent-private-network"
                >
                  {t('plugins.consent.privateNetwork')}
                </p>
              )}
              <DestinationList
                dests={privateDests.map(d => d.dest)}
                testId="consent-private-destinations"
              />
            </div>
          )}
        </section>
      )}

      <p className="mt-4 text-caption text-muted-foreground">
        {t('plugins.consent.consentNote')}
      </p>

      <div className="mt-4 flex justify-end gap-3">
        <Button onClick={() => onResult(false)} variant="secondary">
          {t('plugins.consent.cancel')}
        </Button>
        <Button onClick={() => onResult(true)} variant="primary">
          {t(ACCEPT_KEYS[shown.mode])}
        </Button>
      </div>
    </Dialog>
  )
}

function SourceText({ source }: { source: PluginSource }) {
  const { t } = useTranslation()
  return (
    <>
      {source.type === 'github'
        ? t('plugins.installed.sourceGithub', {
            owner: source.owner,
            repo: source.repo,
          })
        : t('plugins.installed.sourceLocal', { path: source.path })}
    </>
  )
}

function DestinationList({
  dests,
  testId,
}: {
  dests: string[]
  testId: string
}) {
  return (
    <ul className="space-y-0.5 font-mono text-xs" data-testid={testId}>
      {dests.map(d => (
        <li className="break-all" key={d}>
          {d}
        </li>
      ))}
    </ul>
  )
}

/**
 * Consent_Dialog を Promise ベースで使うためのフック。
 *
 * `requestConsent` は PluginManager の `requestConsent` にそのまま渡せる。
 * 表示中に新しい要求が来た場合、先の要求は false で解決する。
 * アンマウント時に未解決の要求があれば false で解決する。
 */
export function useConsentDialog(): {
  requestConsent: (request: ConsentRequest) => Promise<boolean>
  dialog: React.ReactElement
} {
  const [request, setRequest] = useState<ConsentRequest | null>(null)
  const resolverRef = useRef<((accepted: boolean) => void) | null>(null)

  const settle = useCallback((accepted: boolean) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setRequest(null)
    resolve?.(accepted)
  }, [])

  const requestConsent = useCallback((next: ConsentRequest) => {
    const previous = resolverRef.current
    resolverRef.current = null
    previous?.(false)
    return new Promise<boolean>(resolve => {
      resolverRef.current = resolve
      setRequest(next)
    })
  }, [])

  useEffect(
    () => () => {
      const resolve = resolverRef.current
      resolverRef.current = null
      resolve?.(false)
    },
    []
  )

  const dialog = (
    <ConsentDialog
      onResult={settle}
      open={request !== null}
      request={request}
    />
  )

  return { requestConsent, dialog }
}
