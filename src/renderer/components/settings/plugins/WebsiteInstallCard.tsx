import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PluginInstallRequest } from '@/shared/plugin/installLink'
import { Button } from '../../ui/button'

interface Props {
  request: PluginInstallRequest
  disabled: boolean
  installed: boolean
  onInstall(): Promise<void>
  onDismiss(): Promise<void>
}

export function WebsiteInstallCard({
  request,
  disabled,
  installed,
  onInstall,
  onDismiss,
}: Props) {
  const { t } = useTranslation()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (action: () => Promise<void>) => {
    setPending(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(String(e))
    } finally {
      setPending(false)
    }
  }
  return (
    <section
      className="rounded-md border border-border bg-card p-3 space-y-3"
      data-testid="website-install-card"
    >
      <h4 className="text-sm font-medium">
        {t('plugins.websiteInstall.title')}
      </h4>
      <p className="text-xs text-muted-foreground">
        {t('plugins.websiteInstall.description')}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt>{t('plugins.websiteInstall.plugin')}</dt>
        <dd className="break-all font-mono">{request.pluginId}</dd>
        <dt>{t('plugins.consent.source')}</dt>
        <dd className="break-all">GitHub: {request.repo}</dd>
      </dl>
      {installed && (
        <p className="text-xs">{t('plugins.errors.alreadyInstalled')}</p>
      )}
      {error && (
        <p className="text-xs text-destructive break-words" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          disabled={pending}
          onClick={() => void run(onDismiss)}
          size="sm"
          variant="secondary"
        >
          {t('common.cancel')}
        </Button>
        {!installed && (
          <Button
            aria-busy={pending}
            disabled={disabled || pending}
            onClick={() => void run(onInstall)}
            size="sm"
          >
            {pending
              ? t('plugins.repoInstall.installing')
              : t('plugins.websiteInstall.review')}
          </Button>
        )}
      </div>
    </section>
  )
}
