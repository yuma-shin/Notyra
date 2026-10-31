import fc from 'fast-check'
import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import remarkGithubAlerts from 'remark-github-alerts'
import remarkRehype from 'remark-rehype'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'
import { expect, it, vi } from 'vitest'
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}))
import { runs } from '../../helpers/pluginArbitraries'
import { buildMarkdownProcessor } from '@/renderer/lib/markdownPipeline'
import { MarkdownExtensionRegistry } from '@/renderer/lib/plugins/host/registries'
import { rehypeLocalImages } from '@/renderer/plugins/rehypeLocalImages'
import { rehypeMermaid } from '@/renderer/plugins/rehypeMermaid'
import { rehypeSourceLines } from '@/renderer/plugins/rehypeSourceLines'

const markdownArb = fc
  .array(
    fc.oneof(
      fc.string(),
      fc.constantFrom(
        '# Heading',
        '| a | b |\n|---|---|\n| 1 | 2 |',
        '- [x] task',
        '> [!NOTE]\n> alert',
        '```js\nconst x = 1\n```',
        '```mermaid\ngraph TD; A-->B\n```',
        '<div>html</div>',
        '![local](./images/a.png)'
      )
    ),
    { maxLength: 8 }
  )
  .map(parts => parts.join('\n\n'))

// Fixed pre-plugin pipeline, deliberately independent of the production builder.
function legacyProcessor(target: 'preview' | 'export', noteDir?: string) {
  let processor = remark()
    .use(remarkGfm)
    .use(remarkGithubAlerts)
    .use(remarkRehype, { allowDangerousHtml: true })
  if (noteDir) processor = processor.use(rehypeLocalImages, { noteDir })
  processor = processor.use(rehypeMermaid).use(rehypeHighlight)
  if (target === 'preview') processor = processor.use(rehypeSourceLines)
  return processor.use(rehypeStringify, { allowDangerousHtml: true })
}

// Feature: plugin-system, Property 32: Markdown 拡張の適用順序
it('Property 32: respects plugin Load_Order and registration order at both stages', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.integer({ min: 1, max: 4 }), { maxLength: 6 }),
      async counts => {
        const r = new MarkdownExtensionRegistry()
        const calls: string[] = []
        const expected: string[] = []
        const order = counts.map((_, i) => `p-${i}`).reverse()
        r.setLoadOrder(order)
        counts.forEach((count, i) => {
          for (let n = 0; n < count; n++)
            for (const kind of ['remark', 'rehype'] as const)
              r.register(`p-${i}`, kind, () => (tree: unknown) => {
                expect(JSON.stringify(tree)).not.toContain('hljs')
                calls.push(`${kind}:p-${i}:${n}`)
              })
        })
        for (const kind of ['remark', 'rehype'])
          for (const id of order)
            for (let n = 0; n < counts[Number(id.slice(2))]; n++)
              expected.push(`${kind}:${id}:${n}`)
        await buildMarkdownProcessor({
          target: 'preview',
          pluginRemark: r.getActivePlugins('remark'),
          pluginRehype: r.getActivePlugins('rehype'),
        }).process('```js\nconst x = 1\n```')
        expect(calls).toEqual(expected)
      }
    ),
    runs
  )
})

// Feature: plugin-system, Property 33: 拡張なしの Markdown 出力は導入前と同一
it('Property 33: matches the pre-plugin preview and export pipelines', async () => {
  await fc.assert(
    fc.asyncProperty(markdownArb, fc.boolean(), async (markdown, local) => {
      const noteDir = local ? '/notes' : undefined
      for (const target of ['preview', 'export'] as const) {
        expect(
          String(
            await buildMarkdownProcessor({ target, noteDir }).process(markdown)
          )
        ).toBe(String(await legacyProcessor(target, noteDir).process(markdown)))
      }
    }),
    runs
  )
})

// Feature: plugin-system, Property 34: 例外を出した Markdown 拡張の除外
it('Property 34: excludes failing plugins and retains all healthy extensions', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
      async failures => {
        const r = new MarkdownExtensionRegistry()
        const calls: string[] = []
        failures.forEach((bad, i) =>
          r.registerRemark(`p-${i}`, () => () => {
            if (bad) throw new Error('bad')
            calls.push(`p-${i}`)
          })
        )
        const snapshot = r.getSnapshot()
        for (let attempt = 0; attempt <= failures.length; attempt++) {
          try {
            await buildMarkdownProcessor({
              target: 'preview',
              pluginRemark: r.getActivePlugins('remark'),
              onPluginError: id => r.exclude(id),
            }).process('# Hi')
            break
          } catch {
            /* next user edit retries with remaining plugins */
          }
        }
        expect(r.getSnapshot()).toBe(snapshot)
        calls.length = 0
        await buildMarkdownProcessor({
          target: 'export',
          pluginRemark: r.getActivePlugins('remark'),
        }).process('# Hi')
        expect(calls).toEqual(
          failures.flatMap((bad, i) => (bad ? [] : [`p-${i}`]))
        )
      }
    ),
    runs
  )
})
