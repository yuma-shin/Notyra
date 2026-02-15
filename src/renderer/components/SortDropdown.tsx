import React, { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FiFilter } from 'react-icons/fi'
import {
  useFloating,
  offset,
  flip,
  shift,
  autoUpdate,
  useClick,
  useDismiss,
  useRole,
  useListNavigation,
  useInteractions,
  FloatingPortal,
  FloatingFocusManager,
} from '@floating-ui/react'

export type SortOption = 'title-asc' | 'title-desc' | 'date-asc' | 'date-desc'

interface SortDropdownProps {
  value: SortOption
  onChange: (value: SortOption) => void
}

const getSortOptions = (
  t: any
): Array<{ value: SortOption; label: string }> => [
  { value: 'date-desc', label: t('sortDropdown.dateDesc') },
  { value: 'date-asc', label: t('sortDropdown.dateAsc') },
  { value: 'title-asc', label: t('sortDropdown.titleAsc') },
  { value: 'title-desc', label: t('sortDropdown.titleDesc') },
]

export function SortDropdown({ value, onChange }: SortDropdownProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null)
  const listRef = useRef<Array<HTMLElement | null>>([])
  const sortOptions = getSortOptions(t)

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom-start',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  const click = useClick(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'listbox' })
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    virtual: true,
    loop: true,
  })

  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions(
    [click, dismiss, role, listNav]
  )

  const selectedLabel =
    sortOptions.find(opt => opt.value === value)?.label ||
    t('sortDropdown.sortBy')

  const handleSelect = (selectedValue: SortOption) => {
    onChange(selectedValue)
    setIsOpen(false)
  }

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        {...getReferenceProps()}
        className="p-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors"
        title={selectedLabel}
      >
        <FiFilter
          className={isOpen ? 'text-purple-600 dark:text-purple-400' : ''}
          size={16}
        />
      </button>
      {isOpen && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              {...getFloatingProps()}
              className="z-50 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 outline-none"
            >
              {sortOptions.map((option, index) => (
                <button
                  key={option.value}
                  ref={node => {
                    listRef.current[index] = node
                  }}
                  type="button"
                  {...getItemProps({
                    onClick: () => handleSelect(option.value),
                  })}
                  className={`w-full px-4 py-2.5 text-left text-sm transition-colors ${
                    value === option.value
                      ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 font-medium'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  } ${
                    activeIndex === index ? 'bg-gray-100 dark:bg-gray-700' : ''
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  )
}
