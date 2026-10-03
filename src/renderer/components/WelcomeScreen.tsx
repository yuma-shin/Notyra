import { NotyraLogo } from './NotyraLogo'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuFolder, LuZap, LuFileText, LuHeart } from 'react-icons/lu'
import { tauriApi as App } from '@/renderer/lib/tauriApi'
import { Button } from './ui/button'

interface WelcomeScreenProps {
  onSelect: (path: string) => void
}

export function WelcomeScreen({ onSelect }: WelcomeScreenProps) {
  const { t } = useTranslation()
  const [isSelecting, setIsSelecting] = useState(false)

  const handleSelectFolder = async () => {
    setIsSelecting(true)
    try {
      const path = await App.markdown.selectRootFolder()
      if (path) {
        onSelect(path)
      }
    } catch (error) {
      console.error('Failed to select folder:', error)
    } finally {
      setIsSelecting(false)
    }
  }

  const features = [
    { icon: LuZap, label: t('welcome.features.speed') },
    { icon: LuFileText, label: t('welcome.features.preview') },
    { icon: LuHeart, label: t('welcome.features.ui') },
  ]

  return (
    <div className="flex-1 flex items-center justify-center overflow-auto bg-background">
      <div className="max-w-md w-full mx-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <NotyraLogo size={96} />
          </div>

          <h1 className="text-heading-lg text-foreground mb-2">
            {t('welcome.title')}
          </h1>
          <p className="text-body text-muted-foreground mb-8">
            {t('welcome.subtitle')}
          </p>

          <div className="grid grid-cols-3 gap-3 mb-8">
            {features.map(({ icon: Icon, label }) => (
              <div
                className="rounded-lg border border-border bg-card p-4"
                key={label}
              >
                <Icon
                  className="mx-auto mb-2"
                  size={20}
                  style={{ color: 'var(--theme-accent)' }}
                />
                <p className="text-caption text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-[var(--elevation-md)]">
          <p className="text-sm text-foreground mb-4">
            {t('welcome.selectFolderText')}
          </p>
          <Button
            className="w-full"
            disabled={isSelecting}
            onClick={handleSelectFolder}
          >
            <LuFolder size={18} />
            {isSelecting
              ? t('welcome.selectButtonSelecting')
              : t('welcome.selectButtonText')}
          </Button>
          <p className="text-caption text-muted-foreground mt-3">
            {t('welcome.selectFolderHint')}
          </p>
        </div>
      </div>
    </div>
  )
}
