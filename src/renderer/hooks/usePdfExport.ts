import { useCallback, useRef, useState } from 'react'
import {
  type PluginHostContextValue,
  usePluginHost,
} from '@/renderer/contexts/PluginHostContext'
import { buildMarkdownProcessor } from '@/renderer/lib/markdownPipeline'
import githubMarkdownLightCss from 'github-markdown-css/github-markdown-light.css?inline'
import githubMarkdownDarkCss from 'github-markdown-css/github-markdown-dark.css?inline'
import hljsLightCss from 'highlight.js/styles/github.min.css?inline'
import hljsDarkCss from 'highlight.js/styles/github-dark.min.css?inline'

/**
 * エクスポート用の Markdown 処理。エクスポートを実行するウィンドウの
 * MarkdownExtensionRegistry の拡張を適用する（Requirement 14.5）。
 * Plugin 起因の例外は、該当 Plugin をセッション中除外してエラー報告し、
 * エクスポートは失敗として扱う（次回のエクスポートから除外を反映する）。
 */
async function processMarkdownForPdf(
  content: string,
  noteDir: string | undefined,
  pluginHost: PluginHostContextValue | null
): Promise<string> {
  const registry = pluginHost?.registries.markdown ?? null
  const pluginErrors = new Map<string, unknown>()
  let result: { toString(): string }
  try {
    result = await buildMarkdownProcessor({
      noteDir,
      target: 'export',
      pluginRemark: registry?.getActivePlugins('remark') ?? [],
      pluginRehype: registry?.getActivePlugins('rehype') ?? [],
      onPluginError: (pluginId, error) => {
        if (!pluginErrors.has(pluginId)) pluginErrors.set(pluginId, error)
      },
    }).process(content)
  } finally {
    for (const [pluginId, pluginError] of pluginErrors) {
      registry?.exclude(pluginId)
      pluginHost?.reportError(pluginId, 'markdown', pluginError)
    }
  }

  let html = String(result)

  // コードブロックに行番号を追加（コピーボタンはPDFでは不要なので除外）
  html = html.replace(
    /<pre><code class="([^"]*)">([\s\S]*?)<\/code><\/pre>/g,
    (_match, className, code) => {
      // rehype が生成するコードの先頭改行を除去
      const trimmedCode = code.replace(/^\n/, '')
      const tempDiv = document.createElement('div')
      tempDiv.innerHTML = `<code>${trimmedCode}</code>`
      const textContent = tempDiv.textContent || ''
      const lines = textContent.split('\n')
      const lineCount =
        lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
      const lineNumbers = Array.from(
        { length: lineCount },
        (_, i) => i + 1
      ).join('\n')
      return `<pre class="has-line-numbers"><div class="line-numbers" aria-hidden="true">${lineNumbers}</div><code class="${className}">${trimmedCode}</code></pre>`
    }
  )

  return html
}

async function renderMermaidInHtml(
  html: string,
  isDark: boolean
): Promise<string> {
  const container = document.createElement('div')
  container.style.cssText =
    'position:absolute;left:-9999px;visibility:hidden;pointer-events:none'
  container.innerHTML = html
  document.body.appendChild(container)

  try {
    const placeholders = container.querySelectorAll<HTMLElement>(
      '.mermaid-placeholder'
    )
    if (placeholders.length > 0) {
      const { default: mermaid } = await import('mermaid')
      mermaid.initialize({
        startOnLoad: false,
        theme: isDark ? 'dark' : 'default',
        securityLevel: 'loose',
      })

      for (const [i, el] of Array.from(placeholders).entries()) {
        const encoded = el.getAttribute('data-diagram')
        if (!encoded) continue
        const diagram = decodeURIComponent(encoded)
        const id = `pdf-mermaid-${Date.now()}-${i}`
        try {
          const { svg } = await mermaid.render(id, diagram)
          el.innerHTML = svg
          el.style.textAlign = 'center'
        } catch {
          // エラー時はプレースホルダーをそのまま残す
        } finally {
          for (const strayId of [id, `d${id}`]) {
            const stray = document.getElementById(strayId)
            if (stray && !container.contains(stray)) stray.remove()
          }
        }
      }
    }
    return container.innerHTML
  } finally {
    document.body.removeChild(container)
  }
}

async function inlineLocalImages(html: string): Promise<string> {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  // data-tauri-path 属性を持つ画像を Tauri コマンド経由で base64 に変換する。
  // fetch() は Tauri のアセットプロトコルでハングすることがあるため使用しない。
  const { tauriApi } = await import('@/renderer/lib/tauriApi')
  const images = doc.querySelectorAll<HTMLImageElement>('img[data-tauri-path]')

  await Promise.all(
    Array.from(images).map(async img => {
      const tauriPath = img.getAttribute('data-tauri-path')
      if (!tauriPath) return
      try {
        const dataUrl = await tauriApi.image.getAsBase64(tauriPath)
        img.src = dataUrl
        img.removeAttribute('data-tauri-path')
      } catch {
        // 変換失敗時は元のsrcを維持
      }
    })
  )

  return doc.body.innerHTML
}

function buildHtmlDocument(
  bodyHtml: string,
  isDark: boolean,
  title: string
): string {
  const markdownCss = isDark ? githubMarkdownDarkCss : githubMarkdownLightCss
  const hljsCss = isDark ? hljsDarkCss : hljsLightCss
  const bg = isDark ? '#0d1117' : '#ffffff'

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
${markdownCss}
</style>
<style>
${hljsCss}
</style>
<style>
* { box-sizing: border-box; }
body { margin: 0; padding: 0; background: ${bg}; }
.markdown-body {
  box-sizing: border-box;
  min-width: 200px;
  max-width: 980px;
  margin: 0 auto;
  padding: 45px;
}
pre.has-line-numbers {
  display: flex;
  padding: 16px 0;
}
.line-numbers {
  flex-shrink: 0;
  min-width: 2em;
  padding: 0 16px;
  margin-right: 16px;
  text-align: right;
  color: ${isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)'};
  font-size: 12px;
  line-height: 1.5;
  border-right: 1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'};
  user-select: none;
  white-space: pre;
}
pre.has-line-numbers code {
  flex: 1;
  padding: 0 16px 0 0;
  font-size: 12px;
  line-height: 1.5;
}
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .markdown-body { padding: 0; max-width: none; }
  pre { white-space: pre-wrap; word-wrap: break-word; page-break-inside: avoid; }
  img { max-width: 100%; height: auto; }
  svg { max-width: 100%; }
  h1, h2, h3, h4, h5, h6 { page-break-after: avoid; }
  table { page-break-inside: avoid; }
}
</style>
</head>
<body>
<article class="markdown-body" data-color-mode="${isDark ? 'dark' : 'light'}">
${bodyHtml}
</article>
</body>
</html>`
}

export interface ExportResult {
  success: boolean
  filePath?: string
  canceled?: boolean
  error?: string
}

/** @deprecated Use ExportResult */
export type PdfExportResult = ExportResult

async function buildExportHtml(
  markdownContent: string,
  noteDir: string | undefined,
  title: string,
  pluginHost: PluginHostContextValue | null
): Promise<string> {
  const isDark = document.documentElement.classList.contains('dark')
  const processedHtml = await processMarkdownForPdf(
    markdownContent,
    noteDir,
    pluginHost
  )
  const htmlWithMermaid = await renderMermaidInHtml(processedHtml, isDark)
  const htmlWithImages = await inlineLocalImages(htmlWithMermaid)
  return buildHtmlDocument(htmlWithImages, isDark, title)
}

export function usePdfExport() {
  const [isExporting, setIsExporting] = useState(false)
  const [isHtmlExporting, setIsHtmlExporting] = useState(false)

  // エクスポートを実行するウィンドウの PluginHost（Provider の外では null = 拡張なし）
  const pluginHost = usePluginHost()
  const pluginHostRef = useRef(pluginHost)
  pluginHostRef.current = pluginHost

  const exportPdf = useCallback(
    async (
      markdownContent: string,
      noteDir: string | undefined,
      title: string
    ): Promise<ExportResult | undefined> => {
      setIsExporting(true)
      try {
        const fullHtml = await buildExportHtml(
          markdownContent,
          noteDir,
          title,
          pluginHostRef.current
        )

        // html2pdf.js + html2canvas は Tauri WebView2 でフリーズするため使用しない。
        // ヘッドレス Edge (msedge.exe --headless=new --print-to-pdf) でダイアログなしに PDF を生成する。
        // Edge が見つからない場合は Rust 側でエラーを返す。
        const { tauriApi } = await import('@/renderer/lib/tauriApi')
        return await tauriApi.export.pdf(fullHtml, title)
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      } finally {
        setIsExporting(false)
      }
    },
    []
  )

  const exportHtml = useCallback(
    async (
      markdownContent: string,
      noteDir: string | undefined,
      title: string
    ): Promise<ExportResult | undefined> => {
      setIsHtmlExporting(true)
      try {
        const fullHtml = await buildExportHtml(
          markdownContent,
          noteDir,
          title,
          pluginHostRef.current
        )
        const { tauriApi } = await import('@/renderer/lib/tauriApi')
        return await tauriApi.export.html(fullHtml, title)
      } finally {
        setIsHtmlExporting(false)
      }
    },
    []
  )

  return { exportPdf, isExporting, exportHtml, isHtmlExporting }
}
