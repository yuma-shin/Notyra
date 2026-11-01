import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTriangleAlert } from 'react-icons/lu'
import { toPluginApiError } from '@/renderer/lib/plugins/pluginError'
import { Button } from '../../ui/button'
import { formatPluginApiError } from './pluginErrorMessage'

export interface ThirdPartyWarningBannerProps {
  /** 確認済み状態を永続化する（`tauriApi.plugins.ackThirdPartyWarning`） */
  onAcknowledge: () => Promise<void>
}

/**
 * Third_Party_Warning のバナー（Requirement 1.4、1.6）。
 *
 * 表示・非表示は呼び出し側が確認済み状態で切り替える（Requirement 1.7）。
 * 永続化に失敗した場合はバナー内にエラーを表示し、再度「了解」を押せるようにする。
 */
export function ThirdPartyWarningBanner({
  onAcknowledge,
}: ThirdPartyWarningBannerProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAcknowledge = async () => {
    setPending(true)
    setError(null)
    try {
      await onAcknowledge()
    } catch (e) {
      setError(formatPluginApiError(t, toPluginApiError(e)))
    } finally {
      setPending(false)
    }
  }

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
      data-testid="third-party-warning"
    >
      <h4
        className="flex items-center gap-2 font-medium text-destructive"
        id={titleId}
      >
        <LuTriangleAlert size={16} />
        {t('plugins.thirdPartyWarning.title')}
      </h4>
      <p className="text-xs text-foreground">
        {t('plugins.thirdPartyWarning.message')}
      </p>
      {error !== null && (
        <p
          className="text-xs text-destructive break-words"
          data-testid="third-party-warning-error"
          role="alert"
        >
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          disabled={pending}
          onClick={() => void handleAcknowledge()}
          size="sm"
          variant="primary"
        >
          {t('plugins.thirdPartyWarning.acknowledge')}
        </Button>
      </div>
    </section>
  )
}
