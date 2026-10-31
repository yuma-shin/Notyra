import { useEffect, useRef, useState } from 'react'
import { LuMinus, LuX } from 'react-icons/lu'
import { useTranslation } from 'react-i18next'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { usePluginThemeSync } from '../hooks/usePluginThemeSync'
import {
  SettingsSidebar,
  type SettingsSection,
} from '../components/settings/SettingsSidebar'
import { AppearanceSection } from '../components/settings/AppearanceSection'
import { FontSection } from '../components/settings/FontSection'
import { LanguageSection } from '../components/settings/LanguageSection'
import { PluginsSection } from '../components/settings/PluginsSection'
import { Button } from '../components/ui/button'
import { ICON_SIZE } from '@/renderer/lib/iconConstants'
import { tauriApi as App } from '@/renderer/lib/tauriApi'

// ---------------------------------------------------------------------------
// SettingsTitlebar
// ---------------------------------------------------------------------------

function SettingsTitlebar() {
  const { t } = useTranslation()
  const isMac =
    App.platform === 'darwin' ||
    App.platform === 'macOS' ||
    App.platform.startsWith('Mac')

  const handleMinimize = async () => {
    await App.window.minimize()
  }

  const handleClose = async () => {
    await App.window.close()
  }

  return (
    <div
      className="h-11 flex items-center justify-between border-b border-border select-none"
      data-tauri-drag-region
    >
      <div
        className={`flex items-center h-full ${isMac ? 'pl-[80px]' : 'pl-4'}`}
        data-tauri-drag-region
      >
        <h1 className="text-sm font-medium" data-tauri-drag-region>
          {t('settings.title', 'Settings')}
        </h1>
      </div>

      {!isMac && (
        <div className="flex items-center gap-0.5 mr-1.5 flex-shrink-0">
          <Button
            aria-label={t('titleBar.minimize')}
            onClick={handleMinimize}
            size="icon"
            variant="ghost"
          >
            <LuMinus
              className="text-muted-foreground"
              size={ICON_SIZE.TITLEBAR}
            />
          </Button>
          <Button
            aria-label={t('titleBar.close')}
            className="hover:bg-red-500 group"
            onClick={handleClose}
            size="icon"
            variant="ghost"
          >
            <LuX
              className="text-muted-foreground group-hover:text-white"
              size={ICON_SIZE.TITLEBAR}
            />
          </Button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SettingsScreen
// ---------------------------------------------------------------------------

export function SettingsScreen() {
  // Plugin のカラーテーマをデータとして読み込み、このウィンドウにも適用する（コードは実行しない）
  usePluginThemeSync(null)
  const isDesktop = useMediaQuery('(min-width: 640px)')
  const [activeSection, setActiveSection] =
    useState<SettingsSection>('appearance')
  const containerRef = useRef<HTMLDivElement>(null)

  // Req 8.4: 初回マウント時に最初のフォーカス可能な要素にフォーカスを設定
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const focusable = container.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    focusable?.focus()
  }, [])

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'appearance':
        return <AppearanceSection />
      case 'font':
        return <FontSection />
      case 'language':
        return <LanguageSection />
      case 'plugins':
        return <PluginsSection />
    }
  }

  const renderAllSections = () => (
    <>
      <AppearanceSection />
      <div className="border-t border-border my-4" />
      <FontSection />
      <div className="border-t border-border my-4" />
      <LanguageSection />
      <div className="border-t border-border my-4" />
      <PluginsSection />
    </>
  )

  return (
    <div
      className="h-screen flex flex-col overflow-hidden bg-background"
      ref={containerRef}
    >
      <SettingsTitlebar />
      {isDesktop ? (
        <div className="flex flex-1 min-h-0">
          <div className="w-48 shrink-0 border-r border-border p-3 overflow-y-auto">
            <SettingsSidebar
              activeSection={activeSection}
              onSectionChange={setActiveSection}
            />
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {renderActiveSection()}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6">{renderAllSections()}</div>
      )}
    </div>
  )
}
