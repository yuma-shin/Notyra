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

  const setMergedReference = (node: HTMLElement | null) => {
    refs.setReference(node)

    const childRef = (children.props as any).ref
    if (typeof childRef === 'function') {
      childRef(node)
    } else if (childRef && typeof childRef === 'object') {
      childRef.current = node
    }
  }

  // 子要素の既存 props/ref を保持したまま tooltip の参照を付与する
  const clonedChild = React.cloneElement(children, {
    ...getReferenceProps(children.props as React.HTMLProps<Element>),
    ref: setMergedReference,
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
