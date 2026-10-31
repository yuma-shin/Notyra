import { useTranslation } from 'react-i18next'
import { LuPencil, LuEye, LuColumns2 } from 'react-icons/lu'
import { SimpleTooltip } from '../ui/tooltip'
import { Button } from '../ui/button'
import { ICON_SIZE } from '@/renderer/lib/iconConstants'
import type { AppSettings } from '@/shared/types'

interface FloatingViewButtonsProps {
  layoutMode: AppSettings['editorLayoutMode']
  onLayoutModeChange: (mode: AppSettings['editorLayoutMode']) => void
}

export function FloatingViewButtons({
  layoutMode,
  onLayoutModeChange,
}: FloatingViewButtonsProps) {
  const { t } = useTranslation()

  const modes: Array<{
    mode: AppSettings['editorLayoutMode']
    label: string
    icon: React.ReactNode
  }> = [
    {
      mode: 'editor',
      label: t('editor.layoutMode.editorOnly'),
      icon: <LuPencil size={ICON_SIZE.TITLEBAR} />,
    },
    {
      mode: 'split',
      label: t('editor.layoutMode.splitView'),
      icon: <LuColumns2 size={ICON_SIZE.TITLEBAR} />,
    },
    {
      mode: 'preview',
      label: t('editor.layoutMode.previewOnly'),
      icon: <LuEye size={ICON_SIZE.TITLEBAR} />,
    },
  ]

  return (
    <fieldset
      aria-label={t('editor.layoutMode.label')}
      className="absolute bottom-6 right-6 z-50 opacity-0 translate-x-4 pointer-events-none transition-all duration-300 group-hover/editor-view:opacity-100 group-hover/editor-view:translate-x-0 group-hover/editor-view:pointer-events-auto group-focus-within/editor-view:opacity-100 group-focus-within/editor-view:translate-x-0 group-focus-within/editor-view:pointer-events-auto"
    >
      <div className="bg-popover/70 backdrop-blur-md rounded-xl border border-border/50 p-1.5 flex flex-col gap-1 shadow-[var(--elevation-lg)]">
        {modes.map(({ mode, label, icon }) => (
          <SimpleTooltip content={label} key={mode} placement="left">
            <Button
              aria-label={label}
              aria-pressed={layoutMode === mode}
              onClick={() => onLayoutModeChange(mode)}
              size="icon"
              style={
                layoutMode === mode
                  ? { background: 'var(--theme-accent)', color: 'white' }
                  : undefined
              }
              variant="ghost"
            >
              {icon}
            </Button>
          </SimpleTooltip>
        ))}
      </div>
    </fieldset>
  )
}
