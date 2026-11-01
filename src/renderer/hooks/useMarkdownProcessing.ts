import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { usePluginHost } from '@/renderer/contexts/PluginHostContext'
import { buildMarkdownProcessor } from '@/renderer/lib/markdownPipeline'
import type { MarkdownExtensionSnapshot } from '@/renderer/lib/plugins/host/registries'

const EMPTY_MARKDOWN_SNAPSHOT: MarkdownExtensionSnapshot = Object.freeze({
  remark: [],
  rehype: [],
})
const subscribeNothing = () => () => {}
const getEmptySnapshot = () => EMPTY_MARKDOWN_SNAPSHOT

export function useMarkdownProcessing(content: string, noteDir?: string) {
  const [html, setHtml] = useState('')

  // PluginHostProvider の外（設定画面・テスト）では拡張なしで処理する
  const pluginHost = usePluginHost()
  const registry = pluginHost?.registries.markdown ?? null
  // 登録・解除でのみ変わる。除外（exclude）では変わらないため、
  // Plugin の例外を理由に即時再生成しない（Requirement 14.7、14.9）
  const extensions = useSyncExternalStore(
    registry?.subscribe ?? subscribeNothing,
    registry?.getSnapshot ?? getEmptySnapshot
  )

  // エラー報告先の変化（PluginHost の起動など）では再処理しない
  const reportErrorRef = useRef(pluginHost?.reportError)
  reportErrorRef.current = pluginHost?.reportError

  useEffect(() => {
    // 再処理の契機として参照する
    void extensions
    let cancelled = false
    const processMarkdown = async () => {
      const pluginErrors = new Map<string, unknown>()
      try {
        const processor = buildMarkdownProcessor({
          noteDir,
          target: 'preview',
          pluginRemark: registry?.getActivePlugins('remark') ?? [],
          pluginRehype: registry?.getActivePlugins('rehype') ?? [],
          onPluginError: (pluginId, error) => {
            if (!pluginErrors.has(pluginId)) pluginErrors.set(pluginId, error)
          },
        })
        const result = await processor.process(content)

        let html = String(result)

        // チェックボックスのdisabled属性を削除してクリック可能にする
        html = html.replace(/<input([^>]*)disabled([^>]*)>/g, '<input$1$2>')

        // コードブロックに行番号とコピーボタンを追加
        html = html.replace(
          /<pre([^>]*)><code class="([^"]*)">([\s\S]*?)<\/code><\/pre>/g,
          (_match, preAttributes, className, code) => {
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

            return `<pre${preAttributes} class="has-line-numbers"><div class="line-numbers" aria-hidden="true">${lineNumbers}</div><code class="${className}">${code}</code><button type="button" class="copy-button" title="コードをコピー"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button></pre>`
          }
        )

        if (!cancelled) setHtml(html)
      } catch (error) {
        if (pluginErrors.size > 0) {
          // Plugin 起因の例外: 該当 Plugin をセッション中除外し、次回の生成契機から
          // 反映する。表示中のプレビューは直前の HTML のまま維持する（Requirement 14.8、14.9）
          return
        }
        console.error('Markdown processing error:', error)
        if (!cancelled) setHtml('<p>プレビューの生成に失敗しました</p>')
      } finally {
        for (const [pluginId, pluginError] of pluginErrors) {
          registry?.exclude(pluginId)
          reportErrorRef.current?.(pluginId, 'markdown', pluginError)
        }
      }
    }

    processMarkdown()
    return () => {
      cancelled = true
    }
  }, [content, noteDir, registry, extensions])

  return html
}
