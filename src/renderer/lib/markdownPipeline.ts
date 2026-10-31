/**
 * プレビューとエクスポート（PDF / HTML）で共有する Markdown パイプライン
 * （design.md「15. Markdown パイプライン」、Requirement 14.2〜14.6）。
 *
 * 順序:
 *   remark → remarkGfm → remarkGithubAlerts → Plugin remark（Load_Order 順）
 *   → remarkRehype → rehypeLocalImages（noteDir があるとき）→ rehypeMermaid
 *   → Plugin rehype（Load_Order 順）→ rehypeHighlight
 *   → rehypeSourceLines（preview のみ）→ rehypeStringify
 *
 * Plugin の拡張が0件のときは、導入前の `useMarkdownProcessing`（preview）と
 * `processMarkdownForPdf`（export）と同一の構成になる（Requirement 14.6）。
 *
 * Plugin の pluggable は、アタッチャと返されるトランスフォーマを包み、
 * 例外（同期例外・reject・コールバックのエラー）を `onPluginError` に通知してから
 * 再送出する。除外の判断は呼び出し側が行う。
 */
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkGithubAlerts from 'remark-github-alerts'
import remarkRehype from 'remark-rehype'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'
import { rehypeLocalImages } from '@/renderer/plugins/rehypeLocalImages'
import { rehypeMermaid } from '@/renderer/plugins/rehypeMermaid'
import { rehypeSourceLines } from '@/renderer/plugins/rehypeSourceLines'
import type { MarkdownPluggable } from '@/shared/plugin/api'

export type MarkdownPipelineTarget = 'preview' | 'export'

/** Plugin が登録した pluggable（MarkdownExtensionRegistry の `getActivePlugins` と同じ形） */
export interface PluginPluggable {
  readonly pluginId: string
  readonly plugin: MarkdownPluggable
}

export interface BuildMarkdownProcessorOptions {
  noteDir?: string
  target: MarkdownPipelineTarget
  /** Load_Order 順 */
  pluginRemark?: readonly PluginPluggable[]
  /** Load_Order 順 */
  pluginRehype?: readonly PluginPluggable[]
  onPluginError?(pluginId: string, error: unknown): void
}

/** 処理結果（VFile）は `String(result)` で HTML になる */
export interface MarkdownProcessor {
  process(content: string): Promise<{ toString(): string }>
}

/**
 * unified の Processor を構造的に扱う型。
 * `unified` は直接の依存ではなく型を import できないため、Plugin の pluggable を
 * 任意の引数で `use` できるようにこの境界で型を緩める。
 */
interface ProcessorLike extends MarkdownProcessor {
  use(plugin: unknown, ...parameters: unknown[]): ProcessorLike
}

type AnyFunction = (this: unknown, ...args: unknown[]) => unknown
type ErrorReporter = (pluginId: string, error: unknown) => void

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

/**
 * トランスフォーマを包む。unified（trough）は宣言された引数の数で
 * コールバック形式（`(tree, file, next)`）かを判定するため、引数の数を保つ。
 */
function wrapTransformer(
  pluginId: string,
  transformer: AnyFunction,
  report: ErrorReporter
): AnyFunction {
  if (transformer.length >= 3) {
    return function wrappedCallbackTransformer(
      this: unknown,
      tree: unknown,
      file: unknown,
      next: unknown
    ) {
      const done = (error?: unknown, ...rest: unknown[]) => {
        if (error) report(pluginId, error)
        ;(next as AnyFunction)(error, ...rest)
      }
      try {
        return transformer.call(this, tree, file, done)
      } catch (error) {
        report(pluginId, error)
        throw error
      }
    } as AnyFunction
  }

  return function wrappedTransformer(
    this: unknown,
    tree: unknown,
    file: unknown
  ) {
    let result: unknown
    try {
      result = transformer.call(this, tree, file)
    } catch (error) {
      report(pluginId, error)
      throw error
    }
    if (isThenable(result)) {
      return Promise.resolve(result).catch((error: unknown) => {
        report(pluginId, error)
        throw error
      })
    }
    // trough は Error を返したトランスフォーマを失敗として扱う
    if (result instanceof Error) report(pluginId, result)
    return result
  } as AnyFunction
}

function wrapAttacher(
  pluginId: string,
  attacher: AnyFunction,
  report: ErrorReporter
): AnyFunction {
  return function wrappedAttacher(this: unknown, ...parameters: unknown[]) {
    let transformer: unknown
    try {
      transformer = attacher.apply(this, parameters)
    } catch (error) {
      report(pluginId, error)
      throw error
    }
    return typeof transformer === 'function'
      ? wrapTransformer(pluginId, transformer as AnyFunction, report)
      : transformer
  }
}

function applyPluginPluggables(
  processor: ProcessorLike,
  pluggables: readonly PluginPluggable[],
  report: ErrorReporter
): ProcessorLike {
  let current = processor
  for (const { pluginId, plugin } of pluggables) {
    const [attacher, ...parameters] = Array.isArray(plugin) ? plugin : [plugin]
    if (typeof attacher !== 'function') {
      // unified に渡すと例外になるため、Plugin の例外として扱う
      const error = new TypeError(
        `Invalid markdown plugin registered by "${pluginId}"`
      )
      report(pluginId, error)
      throw error
    }
    current = current.use(
      wrapAttacher(pluginId, attacher as AnyFunction, report),
      ...parameters
    )
  }
  return current
}

export function buildMarkdownProcessor(
  options: BuildMarkdownProcessorOptions
): MarkdownProcessor {
  const {
    noteDir,
    target,
    pluginRemark = [],
    pluginRehype = [],
    onPluginError,
  } = options

  const report: ErrorReporter = (pluginId, error) => {
    if (!onPluginError) return
    try {
      onPluginError(pluginId, error)
    } catch (reportError) {
      console.error(
        '[notyra] failed to report a markdown plugin error:',
        reportError
      )
    }
  }

  let processor = remark()
    .use(remarkGfm)
    .use(remarkGithubAlerts) as unknown as ProcessorLike

  processor = applyPluginPluggables(processor, pluginRemark, report)
  processor = processor.use(remarkRehype, { allowDangerousHtml: true })

  if (noteDir) {
    processor = processor.use(rehypeLocalImages, { noteDir })
  }

  processor = processor.use(rehypeMermaid)
  processor = applyPluginPluggables(processor, pluginRehype, report)
  processor = processor.use(rehypeHighlight)

  if (target === 'preview') {
    processor = processor.use(rehypeSourceLines)
  }

  return processor.use(rehypeStringify, { allowDangerousHtml: true })
}
