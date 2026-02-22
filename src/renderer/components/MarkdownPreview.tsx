import type React from 'react'
import { useEffect, useRef } from 'react'
import mermaid from 'mermaid'
import { useMarkdownProcessing } from '@/renderer/hooks/useMarkdownProcessing'
import { useCodeCopyHandler } from '@/renderer/hooks/useCodeCopyHandler'
import { useCheckboxHandler } from '@/renderer/hooks/useCheckboxHandler'
import { useLinkHandler } from '@/renderer/hooks/useLinkHandler'
import { useImageLightbox } from '@/renderer/hooks/useImageLightbox'
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
  noteDir?: string
}

export function MarkdownPreview({
  content,
  scrollRef,
  onScroll,
  onChange,
  noteDir,
}: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Custom hooks
  const html = useMarkdownProcessing(content, noteDir)
  useCodeCopyHandler(html, contentRef)
  useCheckboxHandler(content, contentRef, onChange)
  useLinkHandler(html, contentRef)
  const { lightboxSrc, closeLightbox } = useImageLightbox(html, contentRef)

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
    if (!contentRef.current) return

    // innerHTML 置き換え前に既存の Mermaid SVG をキャッシュ
    // (diagram ソースをキーにして、変更のない図は再レンダリングせず即座に復元する)
    const mermaidCache = new Map<string, string>()
    for (const el of contentRef.current.querySelectorAll<HTMLElement>(
      '.mermaid-placeholder'
    )) {
      const encoded = el.getAttribute('data-diagram')
      if (encoded && el.querySelector('svg')) {
        mermaidCache.set(encoded, el.innerHTML)
      }
    }

    contentRef.current.innerHTML = html

    // キャッシュ済み SVG を即座に復元し、コンテンツ高さの崩壊を防ぐ
    const placeholders = contentRef.current.querySelectorAll<HTMLElement>(
      '.mermaid-placeholder'
    )
    const needsRender: HTMLElement[] = []
    for (const el of placeholders) {
      const encoded = el.getAttribute('data-diagram')
      if (encoded && mermaidCache.has(encoded)) {
        el.innerHTML = mermaidCache.get(encoded) ?? ''
        el.style.textAlign = 'center'
      } else {
        needsRender.push(el)
      }
    }

    if (needsRender.length === 0) return

    // 新規・変更された図のみ Mermaid でレンダリング
    const isDark = document.documentElement.classList.contains('dark')
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'loose',
    })

    for (const [i, el] of needsRender.entries()) {
      const encoded = el.getAttribute('data-diagram')
      if (!encoded) continue
      const diagram = decodeURIComponent(encoded)
      const id = `mermaid-${Date.now()}-${i}`
      mermaid
        .render(id, diagram)
        .then(({ svg }) => {
          el.innerHTML = svg
          el.style.textAlign = 'center'
        })
        .catch((err: unknown) => {
          const errorMessage = err instanceof Error ? err.message : String(err)
          el.innerHTML = `<pre style="color:#dc2626;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px 14px;font-size:0.8rem;white-space:pre-wrap;overflow-x:auto;">${errorMessage}</pre>`
        })
        .finally(() => {
          // mermaid.render() がエラー時に document.body へ残す要素を確実に削除
          // ただしビュアー内の要素（描画済み SVG）は削除しない
          for (const strayId of [id, `d${id}`]) {
            const stray = document.getElementById(strayId)
            if (stray && !contentRef.current?.contains(stray)) {
              stray.remove()
            }
          }
        })
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
      className="bg-background flex justify-center min-h-full"
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

      {lightboxSrc && (
        <button
          aria-label="拡大画像を閉じる"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-zoom-out"
          onClick={closeLightbox}
          type="button"
        >
          <img
            alt="拡大画像"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            src={lightboxSrc}
          />
        </button>
      )}
    </div>
  )
}
