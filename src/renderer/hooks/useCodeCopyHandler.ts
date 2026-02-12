import { useEffect } from 'react'

export function useCodeCopyHandler(
  html: string,
  containerRef: React.RefObject<HTMLDivElement | null>
) {
  useEffect(() => {
    const handleClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const button = target.closest('.copy-button') as HTMLButtonElement

      if (!button) return

      const pre = button.closest('pre')
      const code = pre?.querySelector('code')

      if (!code) return

      const textContent = code.textContent || ''

      try {
        await navigator.clipboard.writeText(textContent)
        const checkIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`
        button.innerHTML = checkIcon
        button.classList.add('copied')

        setTimeout(() => {
          const copyIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`
          button.innerHTML = copyIcon
          button.classList.remove('copied')
        }, 2000)
      } catch (err) {
        console.error('Failed to copy code:', err)
        // フォールバック
        try {
          const textarea = document.createElement('textarea')
          textarea.value = textContent
          textarea.style.position = 'fixed'
          textarea.style.opacity = '0'
          document.body.appendChild(textarea)
          textarea.select()
          document.execCommand('copy')
          document.body.removeChild(textarea)

          const checkIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`
          button.innerHTML = checkIcon
          button.classList.add('copied')
          setTimeout(() => {
            const copyIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`
            button.innerHTML = copyIcon
            button.classList.remove('copied')
          }, 2000)
        } catch (fallbackErr) {
          console.error('Fallback copy also failed:', fallbackErr)
        }
      }
    }

    const container = containerRef.current
    if (container) {
      container.addEventListener('click', handleClick)
    }

    return () => {
      if (container) {
        container.removeEventListener('click', handleClick)
      }
    }
  }, [html, containerRef])
}
