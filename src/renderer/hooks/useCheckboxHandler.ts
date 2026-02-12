import { useEffect } from 'react'

export function useCheckboxHandler(
  content: string,
  containerRef: React.RefObject<HTMLDivElement | null>,
  onChange?: (content: string) => void
) {
  useEffect(() => {
    const handleCheckboxClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (
        target.tagName !== 'INPUT' ||
        target.getAttribute('type') !== 'checkbox'
      ) {
        return
      }

      const checkbox = target as HTMLInputElement
      const isChecked = checkbox.checked

      let checkboxIndex = 0
      const allCheckboxes = containerRef.current?.querySelectorAll(
        'input[type="checkbox"]'
      )
      if (allCheckboxes) {
        checkboxIndex = Array.from(allCheckboxes).indexOf(checkbox)
      }

      const lines = content.split('\n')
      let currentCheckboxIndex = 0

      const newLines = lines.map(line => {
        const checkboxMatch = line.match(/^(\s*[-*+]\s+)\[[ xX]\]/)
        if (checkboxMatch) {
          if (currentCheckboxIndex === checkboxIndex) {
            const prefix = checkboxMatch[1]
            const newState = isChecked ? 'x' : ' '
            currentCheckboxIndex++
            return line.replace(
              /^(\s*[-*+]\s+)\[[ xX]\]/,
              `${prefix}[${newState}]`
            )
          }
          currentCheckboxIndex++
        }
        return line
      })

      if (onChange) {
        onChange(newLines.join('\n'))
      }
    }

    const container = containerRef.current
    if (container) {
      container.addEventListener('click', handleCheckboxClick)
    }

    return () => {
      if (container) {
        container.removeEventListener('click', handleCheckboxClick)
      }
    }
  }, [content, onChange, containerRef])
}
