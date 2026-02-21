import { useState } from 'react'
import React from 'react'
import {
  useFloating,
  useInteractions,
  useHover,
  shift,
  FloatingPortal,
} from '@floating-ui/react'

interface TooltipProps {
  content: string
  children: React.ReactElement
  delay?: number
  placement?: 'top' | 'bottom' | 'left' | 'right'
}

/**
 * SimpleTooltip component using Floating UI
 * Displays a tooltip on hover for accessibility
 */
export function SimpleTooltip({
  content,
  children,
  delay = 200,
  placement = 'bottom',
}: TooltipProps) {
  const [isOpen, setIsOpen] = useState(false)
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement,
    middleware: [shift({ padding: 8 })],
  })

  const hover = useHover(context, { delay: { open: delay, close: 0 } })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover])

  // 子要素に直接refを附着させる
  const clonedChild = React.cloneElement(children, {
    ...getReferenceProps(),
    ref: refs.setReference,
  } as any)

  return (
    <>
      {clonedChild}
      <FloatingPortal>
        {isOpen && (
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 px-2 py-1 text-sm text-white bg-gray-900 dark:bg-gray-800 rounded pointer-events-none whitespace-nowrap"
          >
            {content}
          </div>
        )}
      </FloatingPortal>
    </>
  )
}
