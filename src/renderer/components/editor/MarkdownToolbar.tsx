import { useState } from 'react'
import { FiDroplet } from 'react-icons/fi'
import {
  GoBold,
  GoItalic,
  GoCodeSquare,
  GoLink,
  GoInfo,
  GoListUnordered,
  GoListOrdered,
  GoStrikethrough,
  GoHeading,
  GoQuote,
  GoTasklist,
  GoTable,
} from 'react-icons/go'
import { ImagePlus, FileDown } from 'lucide-react'

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
}: MarkdownToolbarProps) {
  const btn =
    'p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors'
  const sep = (
    <div className="w-px h-5 bg-gray-200 dark:bg-gray-600 self-center mx-0.5" />
  )

  return (
    <div
      aria-label="Markdown formatting toolbar"
      className="flex items-center gap-0.5 px-2 py-1 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0d1117] flex-shrink-0 flex-wrap"
      role="toolbar"
    >
      {/* Heading */}
      <div className="relative self-center">
        <button
          className={btn}
          onClick={onToggleHeadingPalette}
          title="見出し"
          type="button"
        >
          <GoHeading size={15} />
        </button>
        {showHeadingPalette && (
          <HeadingPalette onApplyHeading={onApplyHeading} />
        )}
      </div>

      {sep}

      {/* Inline formats */}
      <button
        className={btn}
        onClick={() => onApplyFormat('**')}
        title="太字"
        type="button"
      >
        <GoBold size={15} />
      </button>
      <button
        className={btn}
        onClick={() => onApplyFormat('*')}
        title="斜体"
        type="button"
      >
        <GoItalic size={15} />
      </button>
      <button
        className={btn}
        onClick={() => onApplyFormat('`')}
        title="コード"
        type="button"
      >
        <GoCodeSquare size={15} />
      </button>
      <button
        className={btn}
        onClick={() => onApplyFormat('~~')}
        title="取り消し線"
        type="button"
      >
        <GoStrikethrough size={15} />
      </button>
      <button
        className={btn}
        onClick={() => onApplyFormat('[', '](url)')}
        title="リンク"
        type="button"
      >
        <GoLink size={15} />
      </button>

      {sep}

      {/* Block formats */}
      <button className={btn} onClick={onApplyQuote} title="引用" type="button">
        <GoQuote size={15} />
      </button>
      <button
        className={btn}
        onClick={onApplyCheckbox}
        title="チェックボックス"
        type="button"
      >
        <GoTasklist size={15} />
      </button>
      <button
        className={btn}
        onClick={() => onApplyList('bullet')}
        title="箇条書きリスト"
        type="button"
      >
        <GoListUnordered size={15} />
      </button>
      <button
        className={btn}
        onClick={() => onApplyList('ordered')}
        title="番号付きリスト"
        type="button"
      >
        <GoListOrdered size={15} />
      </button>

      {/* Table */}
      <div className="relative self-center">
        <button
          className={btn}
          onClick={onToggleTablePicker}
          title="テーブル"
          type="button"
        >
          <GoTable size={15} />
        </button>
        {showTablePicker && <TablePicker onApplyTable={onApplyTable} />}
      </div>

      {sep}

      {/* Color */}
      <div className="relative self-center">
        <button
          className={btn}
          onClick={onToggleColorPalette}
          title="文字色"
          type="button"
        >
          <FiDroplet size={15} />
        </button>
        {showColorPalette && <ColorPalette onApplyColor={onApplyColor} />}
      </div>

      {/* Alert */}
      <div className="relative self-center">
        <button
          className={btn}
          onClick={onToggleAlertPalette}
          title="アラート"
          type="button"
        >
          <GoInfo size={15} />
        </button>
        {showAlertPalette && <AlertPalette onApplyAlert={onApplyAlert} />}
      </div>

      {(onImageInsert || onPdfExport) && sep}

      {/* 画像挿入 */}
      {onImageInsert && (
        <button
          className={`${btn} disabled:opacity-40 disabled:cursor-not-allowed`}
          disabled={isImageInserting}
          onClick={onImageInsert}
          title="画像を挿入"
          type="button"
        >
          <ImagePlus size={15} />
        </button>
      )}

      {/* PDF エクスポート */}
      {onPdfExport && (
        <button
          className={`${btn} disabled:opacity-40 disabled:cursor-not-allowed`}
          disabled={isPdfExporting}
          onClick={onPdfExport}
          title={isPdfExporting ? 'エクスポート中...' : 'PDFとしてエクスポート'}
          type="button"
        >
          <FileDown size={15} />
        </button>
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
    <div className="absolute left-0 top-full mt-1 bg-white dark:bg-gray-800 shadow-xl rounded-lg border border-gray-200 dark:border-gray-600 p-1 flex flex-col gap-0.5 z-50 min-w-[130px]">
      {headings.map(({ level, label, size }) => (
        <button
          className="px-3 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left flex items-center gap-2 font-bold"
          key={level}
          onClick={() => onApplyHeading(level)}
          title={`見出し${level}`}
          type="button"
        >
          <span className="text-gray-400 dark:text-gray-500 text-[10px] font-normal w-4">
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
      className="absolute left-0 top-full mt-1 bg-white dark:bg-gray-800 shadow-xl rounded-lg border border-gray-200 dark:border-gray-600 p-3 z-50"
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
                    ? 'bg-blue-400 border-blue-500'
                    : 'bg-gray-100 border-gray-300 dark:bg-gray-700 dark:border-gray-500 hover:bg-blue-200 hover:border-blue-400'
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
      <div className="text-center text-xs text-gray-500 dark:text-gray-400 mt-2">
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
    <div className="absolute left-0 top-full mt-1 bg-white dark:bg-gray-800 shadow-xl rounded-lg border border-gray-200 dark:border-gray-600 p-3 grid grid-cols-4 gap-3 z-50">
      {colors.map(({ color, title }) => (
        <button
          className="w-8 h-8 rounded-md hover:scale-110 transition-transform border-2 border-white dark:border-gray-700 shadow-sm"
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
  const alerts = [
    { type: 'NOTE' as const, label: '📘 Note', color: 'bg-blue-500' },
    { type: 'TIP' as const, label: '💡 Tip', color: 'bg-green-500' },
    {
      type: 'IMPORTANT' as const,
      label: '⚠️ Important',
      color: 'bg-purple-500',
    },
    { type: 'WARNING' as const, label: '⚡ Warning', color: 'bg-yellow-500' },
    { type: 'CAUTION' as const, label: '🚨 Caution', color: 'bg-red-500' },
  ]

  return (
    <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 shadow-xl rounded-lg border border-gray-200 dark:border-gray-600 p-2 flex flex-col gap-2 z-50 min-w-[140px]">
      {alerts.map(({ type, label, color }) => (
        <button
          className={`px-3 py-2 text-sm font-medium rounded-md hover:scale-105 transition-transform ${color} text-white`}
          key={type}
          onClick={() => onApplyAlert(type)}
          title={label}
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  )
}
