import {
  FiBold,
  FiItalic,
  FiCode,
  FiLink,
  FiDroplet,
  FiAlertCircle,
  FiList,
} from 'react-icons/fi'

type ListType = 'bullet' | 'ordered'

interface MarkdownToolbarProps {
  position: { top: number; left: number }
  onApplyFormat: (prefix: string, suffix?: string) => void
  onApplyList: (type: ListType) => void
  showColorPalette: boolean
  showAlertPalette: boolean
  paletteOpenUpward: boolean
  onToggleColorPalette: () => void
  onToggleAlertPalette: () => void
  onApplyColor: (color: string) => void
  onApplyAlert: (
    type: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION'
  ) => void
}

export function MarkdownToolbar({
  position,
  onApplyFormat,
  onApplyList,
  showColorPalette,
  showAlertPalette,
  paletteOpenUpward,
  onToggleColorPalette,
  onToggleAlertPalette,
  onApplyColor,
  onApplyAlert,
}: MarkdownToolbarProps) {
  return (
    <div
      aria-label="Markdown formatting toolbar"
      className="fixed z-50 bg-white dark:bg-gray-800 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700 p-1 flex gap-1"
      onMouseDown={e => e.preventDefault()}
      role="toolbar"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      <button
        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
        onClick={() => onApplyFormat('**')}
        title="Bold"
        type="button"
      >
        <FiBold size={16} />
      </button>
      <button
        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
        onClick={() => onApplyFormat('*')}
        title="Italic"
        type="button"
      >
        <FiItalic size={16} />
      </button>
      <button
        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
        onClick={() => onApplyFormat('`')}
        title="Code"
        type="button"
      >
        <FiCode size={16} />
      </button>
      <button
        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
        onClick={() => onApplyFormat('~~')}
        title="Strikethrough"
        type="button"
      >
        <span
          className="text-sm font-bold"
          style={{ textDecoration: 'line-through' }}
        >
          S
        </span>
      </button>
      <button
        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
        onClick={() => onApplyFormat('[', '](url)')}
        title="Link"
        type="button"
      >
        <FiLink size={16} />
      </button>
      <button
        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
        onClick={() => onApplyList('bullet')}
        title="Bullet List"
        type="button"
      >
        <FiList size={16} />
      </button>
      <button
        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
        onClick={() => onApplyList('ordered')}
        title="Numbered List"
        type="button"
      >
        <span className="text-sm font-bold leading-none">1.</span>
      </button>
      <div className="w-px h-6 bg-gray-200 dark:bg-gray-600 self-center" />
      <div className="relative self-center">
        <button
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          onClick={onToggleColorPalette}
          title="Text Color"
          type="button"
        >
          <FiDroplet size={16} />
        </button>
        {showColorPalette && (
          <ColorPalette
            onApplyColor={onApplyColor}
            openUpward={paletteOpenUpward}
          />
        )}
      </div>
      <div className="relative self-center">
        <button
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          onClick={onToggleAlertPalette}
          title="Alert"
          type="button"
        >
          <FiAlertCircle size={16} />
        </button>
        {showAlertPalette && (
          <AlertPalette
            onApplyAlert={onApplyAlert}
            openUpward={paletteOpenUpward}
          />
        )}
      </div>
    </div>
  )
}

interface ColorPaletteProps {
  openUpward: boolean
  onApplyColor: (color: string) => void
}

function ColorPalette({ openUpward, onApplyColor }: ColorPaletteProps) {
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
    <div
      className={`absolute left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 shadow-xl rounded-lg border-2 border-gray-300 dark:border-gray-600 p-3 grid grid-cols-4 gap-3 z-50 ${
        openUpward ? 'bottom-full mb-2' : 'top-full mt-2'
      }`}
    >
      {colors.map(({ color, title }) => (
        <button
          className="w-10 h-10 rounded-md hover:scale-110 transition-transform border-2 border-white dark:border-gray-700 shadow-sm"
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

interface AlertPaletteProps {
  openUpward: boolean
  onApplyAlert: (
    type: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION'
  ) => void
}

function AlertPalette({ openUpward, onApplyAlert }: AlertPaletteProps) {
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
    <div
      className={`absolute left-1/2 -translate-x-1/2 bg-white dark:bg-gray-800 shadow-xl rounded-lg border-2 border-gray-300 dark:border-gray-600 p-2 flex flex-col gap-2 z-50 min-w-[140px] ${
        openUpward ? 'bottom-full mb-2' : 'top-full mt-2'
      }`}
    >
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
