import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { Popover } from './popover'
import { cn } from 'renderer/lib/utils'

export interface DropdownMenuItem<T> {
  value: T
  label: string
  disabled?: boolean
}

export interface DropdownMenuProps<T> {
  items: Array<DropdownMenuItem<T>>
  value: T
  onChange: (value: T) => void
  trigger: React.ReactElement
  className?: string
}

export function DropdownMenu<T>({
  items,
  value,
  onChange,
  trigger,
  className,
}: DropdownMenuProps<T>) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      const selectedIndex = items.findIndex(item => item.value === value)
      setActiveIndex(Math.max(selectedIndex, 0))
    } else {
      setActiveIndex(null)
    }
  }

  useEffect(() => {
    if (open && activeIndex !== null) {
      itemRefs.current[activeIndex]?.focus()
    }
  }, [open, activeIndex])

  const moveActive = (delta: number) => {
    const count = items.length
    if (count === 0) return
    setActiveIndex(prev => {
      let next = ((prev ?? 0) + delta + count) % count
      let guard = 0
      while (items[next]?.disabled && guard < count) {
        next = (next + delta + count) % count
        guard += 1
      }
      return next
    })
  }

  const selectItem = (index: number) => {
    const item = items[index]
    if (!item || item.disabled) return
    onChange(item.value)
    handleOpenChange(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveActive(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        moveActive(-1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (activeIndex !== null) selectItem(activeIndex)
        break
      case 'Escape':
        handleOpenChange(false)
        break
      default:
        break
    }
  }

  return (
    <Popover
      className={className}
      onOpenChange={handleOpenChange}
      open={open}
      trigger={trigger}
    >
      <div
        className="w-48 py-1 outline-none"
        onKeyDown={handleKeyDown}
        role="listbox"
      >
        {items.map((item, index) => (
          <button
            aria-disabled={item.disabled}
            aria-selected={item.value === value}
            className={cn(
              'w-full px-4 py-2 text-left text-sm transition-colors',
              item.disabled && 'cursor-not-allowed opacity-50',
              activeIndex === index && 'bg-accent',
              item.value === value && 'font-medium'
            )}
            disabled={item.disabled}
            key={String(item.value)}
            onClick={() => selectItem(index)}
            onMouseEnter={() => setActiveIndex(index)}
            ref={node => {
              itemRefs.current[index] = node
            }}
            role="option"
            style={
              item.value === value
                ? { color: 'var(--theme-accent)' }
                : undefined
            }
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
    </Popover>
  )
}
