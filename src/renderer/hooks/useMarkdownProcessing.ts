import { useEffect, useState } from 'react'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkGithubAlerts from 'remark-github-alerts'
import remarkRehype from 'remark-rehype'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'
import { rehypeLocalImages } from '@/renderer/plugins/rehypeLocalImages'
import { rehypeMermaid } from '@/renderer/plugins/rehypeMermaid'

export function useMarkdownProcessing(content: string, noteDir?: string) {
  const [html, setHtml] = useState('')

  useEffect(() => {
    const processMarkdown = async () => {
      try {
        let pipeline = remark()
          .use(remarkGfm)
          .use(remarkGithubAlerts)
          .use(remarkRehype, { allowDangerousHtml: true })

        if (noteDir) {
          pipeline = pipeline.use(rehypeLocalImages, { noteDir })
        }

        const result = await pipeline
          .use(rehypeMermaid)
          .use(rehypeHighlight)
          .use(rehypeStringify, { allowDangerousHtml: true })
          .process(content)

        let html = String(result)

        // チェックボックスのdisabled属性を削除してクリック可能にする
        html = html.replace(/<input([^>]*)disabled([^>]*)>/g, '<input$1$2>')

        // コードブロックに行番号とコピーボタンを追加
        html = html.replace(
          /<pre><code class="([^"]*)">([\s\S]*?)<\/code><\/pre>/g,
          (_match, className, code) => {
            const tempDiv = document.createElement('div')
            tempDiv.innerHTML = `<code>${code}</code>`
            const textContent = tempDiv.textContent || ''
            const lines = textContent.split('\n')
            const lineCount =
              lines[lines.length - 1] === '' ? lines.length - 1 : lines.length

            const lineNumbers = Array.from(
              { length: lineCount },
              (_, i) => i + 1
            ).join('\n')

            return `<pre class="has-line-numbers"><div class="line-numbers" aria-hidden="true">${lineNumbers}</div><code class="${className}">${code}</code><button type="button" class="copy-button" title="コードをコピー"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button></pre>`
          }
        )

        setHtml(html)
      } catch (error) {
        console.error('Markdown processing error:', error)
        setHtml('<p>プレビューの生成に失敗しました</p>')
      }
    }

    processMarkdown()
  }, [content, noteDir])

  return html
}
