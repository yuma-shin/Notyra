import { useEffect } from 'react'

export function useLinkHandler(
  html: string,
  containerRef: React.RefObject<HTMLDivElement | null>
) {
  const { App } = window
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement

      const link = target.closest('a')
      if (link) {
        const href = link.getAttribute('href')

        if (
          href &&
          (href.startsWith('http://') || href.startsWith('https://'))
        ) {
          e.preventDefault()
          if (window.App?.shell) {
            App.shell.openExternal(href)
          } else {
            window.open(href, '_blank')
          }
        }
      }
    }

    const contentElement = containerRef.current
    if (contentElement) {
      contentElement.addEventListener('click', handleClick)
    }

    return () => {
      if (contentElement) {
        contentElement.removeEventListener('click', handleClick)
      }
    }
  }, [html, containerRef])
}
