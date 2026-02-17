import { useState, useEffect, useCallback } from 'react'

export function useImageLightbox(
  html: string,
  contentRef: React.RefObject<HTMLDivElement | null>
) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  useEffect(() => {
    const container = contentRef.current
    if (!container) return

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'IMG') {
        const src = (target as HTMLImageElement).src
        if (src) {
          setLightboxSrc(src)
        }
      }
    }

    container.addEventListener('click', handleClick)
    return () => container.removeEventListener('click', handleClick)
  }, [html, contentRef])

  useEffect(() => {
    if (!lightboxSrc) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxSrc(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [lightboxSrc])

  const closeLightbox = useCallback(() => {
    setLightboxSrc(null)
  }, [])

  return { lightboxSrc, closeLightbox }
}
