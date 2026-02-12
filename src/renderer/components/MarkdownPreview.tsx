import type React from 'react'
import { useEffect, useRef } from 'react'
import { useMarkdownProcessing } from '@/renderer/hooks/useMarkdownProcessing'
import { useCodeCopyHandler } from '@/renderer/hooks/useCodeCopyHandler'
import { useCheckboxHandler } from '@/renderer/hooks/useCheckboxHandler'
import { useLinkHandler } from '@/renderer/hooks/useLinkHandler'
import 'github-markdown-css/github-markdown-light.css'
import 'github-markdown-css/github-markdown-dark.css'

interface MarkdownPreviewProps {
  content: string
  scrollRef?: React.RefObject<HTMLDivElement | null>
  onScroll?: (
    scrollTop: number,
    scrollHeight: number,
    clientHeight: number
  ) => void
  onChange?: (content: string) => void
}

export function MarkdownPreview({
  content,
  scrollRef,
  onScroll,
  onChange,
}: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Custom hooks
  const html = useMarkdownProcessing(content)
  useCodeCopyHandler(html, contentRef)
  useCheckboxHandler(content, contentRef, onChange)
  useLinkHandler(html, contentRef)

  // highlight.jsのテーマを動的に読み込む
  useEffect(() => {
    const updateTheme = () => {
      const isDark = document.documentElement.classList.contains('dark')
      const themeId = 'hljs-theme'

      const existingLink = document.getElementById(themeId)
      if (existingLink) {
        existingLink.remove()
      }

      const link = document.createElement('link')
      link.id = themeId
      link.rel = 'stylesheet'
      link.href = isDark
        ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github-dark.min.css'
        : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles/github.min.css'

      document.head.appendChild(link)

      const markdownBody = document.querySelector('.markdown-body')
      if (markdownBody) {
        markdownBody.setAttribute('data-color-mode', isDark ? 'dark' : 'light')
      }
    }

    updateTheme()

    const observer = new MutationObserver(() => {
      updateTheme()
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => {
      observer.disconnect()
      const link = document.getElementById('hljs-theme')
      if (link) {
        link.remove()
      }
    }
  }, [])

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.innerHTML = html
    }
  }, [html])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (onScroll) {
      const target = e.currentTarget
      onScroll(target.scrollTop, target.scrollHeight, target.clientHeight)
    }
  }

  return (
    <div
      className="bg-white dark:bg-gray-950 flex justify-center min-h-full"
      onScroll={handleScroll}
      ref={scrollRef || containerRef}
    >
      <div
        className="markdown-body w-full max-w-6xl px-8 pt-8"
        data-color-mode={
          document.documentElement.classList.contains('dark') ? 'dark' : 'light'
        }
        ref={contentRef}
        style={{
          colorScheme: document.documentElement.classList.contains('dark')
            ? 'dark'
            : 'light',
        }}
      />
    </div>
  )
}
