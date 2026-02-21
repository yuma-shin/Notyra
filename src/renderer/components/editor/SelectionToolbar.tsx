import { useState } from 'react'
import { FiDroplet } from 'react-icons/fi'
import {
  GoBold,
  GoItalic,
  GoCodeSquare,
  GoLink,
  GoListUnordered,
  GoListOrdered,
  GoStrikethrough,
  GoQuote,
  GoTasklist,
  GoInfo,
} from 'react-icons/go'

interface SelectionToolbarProps {
  position: { top: number; left: number }
  onApplyFormat: (prefix: string, suffix?: string) => void
  onApplyList: (type: 'bullet' | 'ordered') => void
  onApplyQuote: () => void
  onApplyCheckbox: () => void
  onApplyColor: (color: string) => void
  onApplyAlert: (
    type: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION'
  ) => void
}

/**
 * テキスト選択時に表示されるフローティングツールバー。
 * パレットの表示状態はコンポーネント内部で管理する。
 */
export function SelectionToolbar({
  position,
  onApplyFormat,
  onApplyList,
  onApplyQuote,
  onApplyCheckbox,
  onApplyColor,
  onApplyAlert,
}: SelectionToolbarProps) {
  const [showColorPalette, setShowColorPalette] = useState(false)
  const [showAlertPalette, setShowAlertPalette] = useState(false)

  const btn =
    'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors'
  const sep = (
    <div className="w-px h-6 bg-gray-200 dark:bg-gray-600 self-center" />
  )

  const handleColorApply = (color: string) => {
    setShowColorPalette(false)
    onApplyColor(color)
  }

  const handleAlertApply = (
    type: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION'
  ) => {
    setShowAlertPalette(false)
    onApplyAlert(type)
  }

  const toggleColor = () => {
    setShowAlertPalette(false)
    setShowColorPalette(v => !v)
  }

  const toggleAlert = () => {
    setShowColorPalette(false)
    setShowAlertPalette(v => !v)
  }

  return (
    <div
      aria-label="Selection formatting toolbar"
      className="fixed z-50 bg-white dark:bg-gray-800 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700 p-1 flex gap-1 items-center"
      onMouseDown={e => e.preventDefault()}
      role="toolbar"
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
    >
      <button
        className={btn}
        onClick={() => onApplyFormat('**')}
        title="太字"
        type="button"
      >
        <GoBold size={16} />
      </button>
      <button
        className={btn}
        onClick={() => onApplyFormat('*')}
        title="斜体"
        type="button"
      >
        <GoItalic size={16} />
      </button>
      <button
        className={btn}
        onClick={() => onApplyFormat('`')}
        title="コード"
        type="button"
      >
        <GoCodeSquare size={16} />
      </button>
      <button
        className={btn}
        onClick={() => onApplyFormat('~~')}
        title="取り消し線"
        type="button"
      >
        <GoStrikethrough size={16} />
      </button>
      <button
        className={btn}
        onClick={() => onApplyFormat('[', '](url)')}
        title="リンク"
        type="button"
      >
        <GoLink size={16} />
      </button>
      {sep}
      <button className={btn} onClick={onApplyQuote} title="引用" type="button">
        <GoQuote size={16} />
      </button>
      <button
        className={btn}
        onClick={onApplyCheckbox}
        title="チェックボックス"
        type="button"
      >
        <GoTasklist size={16} />
      </button>
      <button
        className={btn}
        onClick={() => onApplyList('bullet')}
        title="箇条書きリスト"
        type="button"
      >
        <GoListUnordered size={16} />
      </button>
      <button
        className={btn}
        onClick={() => onApplyList('ordered')}
        title="番号付きリスト"
        type="button"
      >
        <GoListOrdered size={16} />
      </button>
      {sep}
      <div className="relative self-center">
        <button
          className={btn}
          onClick={toggleColor}
          title="文字色"
          type="button"
        >
          <FiDroplet size={15} />
        </button>
        {showColorPalette && <ColorPalette onApplyColor={handleColorApply} />}
      </div>
      <div className="relative self-center">
        <button
          className={btn}
          onClick={toggleAlert}
          title="アラート"
          type="button"
        >
          <GoInfo size={15} />
        </button>
        {showAlertPalette && <AlertPalette onApplyAlert={handleAlertApply} />}
      </div>
    </div>
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
