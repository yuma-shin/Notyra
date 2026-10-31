import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuBold,
  LuItalic,
  LuSquareCode,
  LuLink,
  LuList,
  LuListOrdered,
  LuStrikethrough,
  LuHeading,
  LuQuote,
  LuListChecks,
  LuTable,
  LuInfo,
  LuDroplet,
  LuImage,
  LuDownload,
  LuCode,
  LuChevronDown,
  LuLoaderCircle,
} from 'react-icons/lu'
import { SimpleTooltip } from '../ui/tooltip'
import { Button } from '../ui/button'
import { ALERT_OPTIONS } from '@/renderer/lib/alertOptions'
import { ICON_SIZE } from '@/renderer/lib/iconConstants'
import { PluginToolbarButtons } from './PluginToolbarButtons'

type ListType = 'bullet' | 'ordered'

interface MarkdownToolbarProps {
  onApplyFormat: (prefix: string, suffix?: string) => void
  onApplyList: (type: ListType) => void
  onApplyHeading: (level: 1 | 2 | 3 | 4 | 5 | 6) => void
  onApplyQuote: () => void
  onApplyCheckbox: () => void
  onApplyTable: (dataRows: number, cols: number) => void
  showColorPalette: boolean
  showAlertPalette: boolean
  showHeadingPalette: boolean
  showTablePicker: boolean
  onToggleColorPalette: () => void
  onToggleAlertPalette: () => void
  onToggleHeadingPalette: () => void
  onToggleTablePicker: () => void
  onApplyColor: (color: string) => void
  onApplyAlert: (
    type: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION'
  ) => void
  onImageInsert?: () => void
  isImageInserting?: boolean
  onPdfExport?: () => void
  isPdfExporting?: boolean
  onHtmlExport?: () => void
  isHtmlExporting?: boolean
}

export function MarkdownToolbar({
  onApplyFormat,
  onApplyList,
  onApplyHeading,
  onApplyQuote,
  onApplyCheckbox,
  onApplyTable,
  showColorPalette,
  showAlertPalette,
  showHeadingPalette,
  showTablePicker,
  onToggleColorPalette,
  onToggleAlertPalette,
  onToggleHeadingPalette,
  onToggleTablePicker,
  onApplyColor,
  onApplyAlert,
  onImageInsert,
  isImageInserting = false,
  onPdfExport,
  isPdfExporting = false,
  onHtmlExport,
  isHtmlExporting = false,
}: MarkdownToolbarProps) {
  const { t } = useTranslation()
  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportButtonRef = useRef<HTMLDivElement>(null)
  const hasExport = !!(onPdfExport || onHtmlExport)
  const isExporting = isPdfExporting || isHtmlExporting

  useEffect(() => {
    if (!showExportMenu) return
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        exportButtonRef.current &&
        !exportButtonRef.current.contains(e.target as Node)
      ) {
        setShowExportMenu(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [showExportMenu])
  const sep = <div className="w-px h-5 bg-border self-center mx-0.5" />

  return (
    <div
      aria-label="Markdown formatting toolbar"
      className="flex items-center gap-0.5 px-2 py-1 border-b border-border bg-background flex-shrink-0 flex-wrap"
      role="toolbar"
    >
      {/* Heading */}
      <div className="relative self-center">
        <SimpleTooltip content={t('editor.toolbar.heading')}>
          <Button
            aria-label={t('editor.toolbar.heading')}
            onClick={onToggleHeadingPalette}
            size="icon"
            variant="ghost"
          >
            <LuHeading size={ICON_SIZE.TOOLBAR} />
          </Button>
        </SimpleTooltip>
        {showHeadingPalette && (
          <HeadingPalette onApplyHeading={onApplyHeading} />
        )}
      </div>

      {sep}

      {/* Inline formats */}
      <SimpleTooltip content={t('editor.toolbar.bold')}>
        <Button
          aria-label={t('editor.toolbar.bold')}
          onClick={() => onApplyFormat('**')}
          size="icon"
          variant="ghost"
        >
          <LuBold size={ICON_SIZE.TOOLBAR} />
        </Button>
      </SimpleTooltip>
      <SimpleTooltip content={t('editor.toolbar.italic')}>
        <Button
          aria-label={t('editor.toolbar.italic')}
          onClick={() => onApplyFormat('*')}
          size="icon"
          variant="ghost"
        >
          <LuItalic size={ICON_SIZE.TOOLBAR} />
        </Button>
      </SimpleTooltip>
      <SimpleTooltip content={t('editor.toolbar.code')}>
        <Button
          aria-label={t('editor.toolbar.code')}
          onClick={() => onApplyFormat('`')}
          size="icon"
          variant="ghost"
        >
          <LuSquareCode size={ICON_SIZE.TOOLBAR} />
        </Button>
      </SimpleTooltip>
      <SimpleTooltip content={t('editor.toolbar.strikethrough')}>
        <Button
          aria-label={t('editor.toolbar.strikethrough')}
          onClick={() => onApplyFormat('~~')}
          size="icon"
          variant="ghost"
        >
          <LuStrikethrough size={ICON_SIZE.TOOLBAR} />
        </Button>
      </SimpleTooltip>
      <SimpleTooltip content={t('editor.toolbar.link')}>
        <Button
          aria-label={t('editor.toolbar.link')}
          onClick={() => onApplyFormat('[', '](url)')}
          size="icon"
          variant="ghost"
        >
          <LuLink size={ICON_SIZE.TOOLBAR} />
        </Button>
      </SimpleTooltip>

      {sep}

      {/* Block formats */}
      <SimpleTooltip content={t('editor.toolbar.quote')}>
        <Button
          aria-label={t('editor.toolbar.quote')}
          onClick={onApplyQuote}
          size="icon"
          variant="ghost"
        >
          <LuQuote size={ICON_SIZE.TOOLBAR} />
        </Button>
      </SimpleTooltip>
      <SimpleTooltip content={t('editor.toolbar.checkbox')}>
        <Button
          aria-label={t('editor.toolbar.checkbox')}
          onClick={onApplyCheckbox}
          size="icon"
          variant="ghost"
        >
          <LuListChecks size={ICON_SIZE.TOOLBAR} />
        </Button>
      </SimpleTooltip>
      <SimpleTooltip content={t('editor.toolbar.bulletList')}>
        <Button
          aria-label={t('editor.toolbar.bulletList')}
          onClick={() => onApplyList('bullet')}
          size="icon"
          variant="ghost"
        >
          <LuList size={ICON_SIZE.TOOLBAR} />
        </Button>
      </SimpleTooltip>
      <SimpleTooltip content={t('editor.toolbar.orderedList')}>
        <Button
          aria-label={t('editor.toolbar.orderedList')}
          onClick={() => onApplyList('ordered')}
          size="icon"
          variant="ghost"
        >
          <LuListOrdered size={ICON_SIZE.TOOLBAR} />
        </Button>
      </SimpleTooltip>

      {/* Table */}
      <div className="relative self-center">
        <SimpleTooltip content={t('editor.toolbar.table')}>
          <Button
            aria-label={t('editor.toolbar.table')}
            onClick={onToggleTablePicker}
            size="icon"
            variant="ghost"
          >
            <LuTable size={ICON_SIZE.TOOLBAR} />
          </Button>
        </SimpleTooltip>
        {showTablePicker && <TablePicker onApplyTable={onApplyTable} />}
      </div>

      {sep}

      {/* Color */}
      <div className="relative self-center">
        <SimpleTooltip content={t('editor.toolbar.color')}>
          <Button
            aria-label={t('editor.toolbar.color')}
            onClick={onToggleColorPalette}
            size="icon"
            variant="ghost"
          >
            <LuDroplet size={ICON_SIZE.TOOLBAR} />
          </Button>
        </SimpleTooltip>
        {showColorPalette && <ColorPalette onApplyColor={onApplyColor} />}
      </div>

      {/* Alert */}
      <div className="relative self-center">
        <SimpleTooltip content={t('editor.toolbar.alert')}>
          <Button
            aria-label={t('editor.toolbar.alert')}
            onClick={onToggleAlertPalette}
            size="icon"
            variant="ghost"
          >
            <LuInfo size={ICON_SIZE.TOOLBAR} />
          </Button>
        </SimpleTooltip>
        {showAlertPalette && <AlertPalette onApplyAlert={onApplyAlert} />}
      </div>

      {onImageInsert && sep}

      {/* 画像挿入 */}
      {onImageInsert && (
        <SimpleTooltip content={t('editor.toolbar.imageInsert')}>
          <Button
            aria-label={t('editor.toolbar.imageInsert')}
            disabled={isImageInserting}
            onClick={onImageInsert}
            size="icon"
            variant="ghost"
          >
            <LuImage size={ICON_SIZE.TOOLBAR} />
          </Button>
        </SimpleTooltip>
      )}

      {/* Plugin のボタン（右寄せのエクスポートより前の末尾） */}
      <PluginToolbarButtons separator={sep} />

      {/* エクスポート */}
      {hasExport && (
        <div className="ml-auto flex items-center gap-0.5">
          {sep}
          <div
            className="relative self-center flex items-center"
            ref={exportButtonRef}
          >
            <SimpleTooltip content={t('editor.toolbar.export')}>
              <Button
                aria-label={t('editor.toolbar.export')}
                className="gap-0.5 px-1.5"
                disabled={isExporting}
                onClick={() => setShowExportMenu(prev => !prev)}
                size="sm"
                variant="ghost"
              >
                {isExporting ? (
                  <LuLoaderCircle
                    className="animate-spin"
                    size={ICON_SIZE.TOOLBAR}
                  />
                ) : (
                  <LuDownload size={ICON_SIZE.TOOLBAR} />
                )}
                <LuChevronDown
                  className="text-muted-foreground"
                  size={ICON_SIZE.INDICATOR}
                />
              </Button>
            </SimpleTooltip>
            {showExportMenu && (
              <ExportMenu
                onClose={() => setShowExportMenu(false)}
                onHtmlExport={onHtmlExport}
                onPdfExport={onPdfExport}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Heading Palette ──────────────────────────────────────────────────────────

interface HeadingPaletteProps {
  onApplyHeading: (level: 1 | 2 | 3 | 4 | 5 | 6) => void
}

function HeadingPalette({ onApplyHeading }: HeadingPaletteProps) {
  const headings = [
    { level: 1 as const, label: 'H1', size: '1.1em' },
    { level: 2 as const, label: 'H2', size: '1em' },
    { level: 3 as const, label: 'H3', size: '0.95em' },
    { level: 4 as const, label: 'H4', size: '0.9em' },
    { level: 5 as const, label: 'H5', size: '0.85em' },
    { level: 6 as const, label: 'H6', size: '0.8em' },
  ]

  return (
    <div className="absolute left-0 top-full mt-1 bg-popover shadow-xl rounded-lg border border-border p-1 flex flex-col gap-0.5 z-50 min-w-[130px]">
      {headings.map(({ level, label, size }) => (
        <button
          className="px-3 py-1.5 rounded hover:bg-accent transition-colors text-left flex items-center gap-2 font-bold"
          key={level}
          onClick={() => onApplyHeading(level)}
          title={`見出し${level}`}
          type="button"
        >
          <span className="text-muted-foreground text-[10px] font-normal w-4">
            {label}
          </span>
          <span style={{ fontSize: size }}>{`見出し${level}`}</span>
        </button>
      ))}
    </div>
  )
}

// ─── Table Picker ─────────────────────────────────────────────────────────────

interface TablePickerProps {
  onApplyTable: (dataRows: number, cols: number) => void
}

const TABLE_ROW_KEYS = [0, 1, 2, 3, 4, 5]
const TABLE_COL_KEYS = [0, 1, 2, 3, 4, 5, 6, 7]

function TablePicker({ onApplyTable }: TablePickerProps) {
  const [hovered, setHovered] = useState({ rows: 0, cols: 0 })

  return (
    <fieldset
      className="absolute left-0 top-full mt-1 bg-popover shadow-xl rounded-lg border border-border p-3 z-50"
      onMouseLeave={() => setHovered({ rows: 0, cols: 0 })}
    >
      <legend className="sr-only">テーブルサイズを選択</legend>
      <div className="flex flex-col gap-1">
        {TABLE_ROW_KEYS.map(rowIdx => (
          <div className="flex gap-1" key={rowIdx}>
            {TABLE_COL_KEYS.map(colIdx => (
              <button
                className={`w-5 h-5 border rounded-sm transition-colors ${
                  rowIdx < hovered.rows && colIdx < hovered.cols
                    ? 'bg-[var(--theme-accent)] border-[var(--theme-accent)]'
                    : 'bg-muted border-border hover:bg-[var(--theme-accent-subtle-hover)] hover:border-[var(--theme-accent)]'
                }`}
                key={`${rowIdx}-${colIdx}`}
                onClick={() => {
                  if (hovered.rows > 0 && hovered.cols > 0) {
                    onApplyTable(hovered.rows, hovered.cols)
                  }
                }}
                onMouseEnter={() =>
                  setHovered({ rows: rowIdx + 1, cols: colIdx + 1 })
                }
                type="button"
              />
            ))}
          </div>
        ))}
      </div>
      <div className="text-center text-xs text-muted-foreground mt-2">
        {hovered.rows > 0 && hovered.cols > 0
          ? `${hovered.rows}行 × ${hovered.cols}列`
          : 'サイズを選択'}
      </div>
    </fieldset>
  )
}

// ─── Color Palette ────────────────────────────────────────────────────────────

interface ColorPaletteProps {
  onApplyColor: (color: string) => void
}

function ColorPalette({ onApplyColor }: ColorPaletteProps) {
  const colors = [
    { color: '#EF4444', title: 'Red' },
    { color: '#F97316', title: 'Orange' },
    { color: '#F59E0B', title: 'Amber' },
    { color: '#EAB308', title: 'Yellow' },
    { color: '#84CC16', title: 'Lime' },
    { color: '#22C55E', title: 'Green' },
    { color: '#10B981', title: 'Emerald' },
    { color: '#14B8A6', title: 'Teal' },
    { color: '#06B6D4', title: 'Cyan' },
    { color: '#0EA5E9', title: 'Sky' },
    { color: '#3B82F6', title: 'Blue' },
    { color: '#6366F1', title: 'Indigo' },
    { color: '#8B5CF6', title: 'Violet' },
    { color: '#A855F7', title: 'Purple' },
    { color: '#D946EF', title: 'Fuchsia' },
    { color: '#EC4899', title: 'Pink' },
  ]

  return (
    <div className="absolute left-0 top-full mt-1 bg-popover shadow-xl rounded-lg border border-border p-3 grid grid-cols-4 gap-3 z-50">
      {colors.map(({ color, title }) => (
        <button
          className="w-8 h-8 rounded-md hover:scale-110 transition-transform border-2 border-background shadow-sm"
          key={color}
          onClick={() => onApplyColor(color)}
          style={{ backgroundColor: color }}
          title={title}
          type="button"
        />
      ))}
    </div>
  )
}

// ─── Alert Palette ────────────────────────────────────────────────────────────

interface AlertPaletteProps {
  onApplyAlert: (
    type: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION'
  ) => void
}

function AlertPalette({ onApplyAlert }: AlertPaletteProps) {
  return (
    <div className="absolute right-0 top-full mt-1 bg-popover shadow-xl rounded-lg border border-border py-1 z-50 w-max">
      {ALERT_OPTIONS.map(({ type, label, color, previewText }) => (
        <button
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-accent transition-colors text-left"
          key={type}
          onClick={() => onApplyAlert(type)}
          type="button"
        >
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${color}`} />
          <span className="font-mono text-xs text-muted-foreground shrink-0">
            {previewText}
          </span>
          <span className="text-xs whitespace-nowrap">{label}</span>
        </button>
      ))}
    </div>
  )
}

// ─── Export Menu ──────────────────────────────────────────────────────────────

interface ExportMenuProps {
  onPdfExport?: () => void
  onHtmlExport?: () => void
  onClose: () => void
}

function ExportMenu({ onPdfExport, onHtmlExport, onClose }: ExportMenuProps) {
  const { t } = useTranslation()

  const handlePdf = () => {
    onClose()
    onPdfExport?.()
  }

  const handleHtml = () => {
    onClose()
    onHtmlExport?.()
  }

  return (
    <div className="absolute right-0 top-full mt-1 bg-popover shadow-xl rounded-lg border border-border p-1 flex flex-col gap-0.5 z-50 min-w-[250px]">
      {onPdfExport && (
        <button
          className="flex items-center gap-2 px-3 py-2 text-sm rounded hover:bg-accent transition-colors text-left"
          onClick={handlePdf}
          type="button"
        >
          <LuDownload
            className="shrink-0 text-muted-foreground"
            size={ICON_SIZE.MENU}
          />
          <span>{t('editor.toolbar.exportPdf')}</span>
        </button>
      )}
      {onHtmlExport && (
        <button
          className="flex items-center gap-2 px-3 py-2 text-sm rounded hover:bg-accent transition-colors text-left"
          onClick={handleHtml}
          type="button"
        >
          <LuCode
            className="shrink-0 text-muted-foreground"
            size={ICON_SIZE.MENU}
          />
          <span>{t('editor.toolbar.exportHtml')}</span>
        </button>
      )}
    </div>
  )
}
