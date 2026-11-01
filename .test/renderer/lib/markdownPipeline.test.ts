import { describe, expect, it, vi } from 'vitest'
import { buildMarkdownProcessor } from '@/renderer/lib/markdownPipeline'

const SAMPLE = '# Title\n\n```js\nconst x = 1\n```\n\n- [ ] task'

async function render(
  options: Parameters<typeof buildMarkdownProcessor>[0],
  content = SAMPLE
): Promise<string> {
  return String(await buildMarkdownProcessor(options).process(content))
}

describe('buildMarkdownProcessor', () => {
  it('adds source line attributes only for the preview target', async () => {
    const preview = await render({ target: 'preview' })
    const exported = await render({ target: 'export' })

    expect(preview).toContain('data-source-line')
    expect(exported).not.toContain('data-source-line')
    expect(exported).toContain('hljs')
  })

  it('runs plugin remark plugins after built-ins and plugin rehype plugins before rehype-highlight, in Load_Order', async () => {
    const calls: string[] = []
    const record = (label: string) =>
      function attacher() {
        return (tree: unknown) => {
          // rehype-highlight が実行済みなら code 要素に hljs クラスが付いている
          const serialized = JSON.stringify(tree)
          calls.push(`${label}:${serialized.includes('hljs') ? 'hl' : 'raw'}`)
        }
      }

    await render({
      target: 'preview',
      pluginRemark: [
        { pluginId: 'a', plugin: record('remark-a') },
        { pluginId: 'b', plugin: record('remark-b') },
      ],
      pluginRehype: [
        { pluginId: 'a', plugin: record('rehype-a') },
        { pluginId: 'b', plugin: [record('rehype-b'), { option: true }] },
      ],
    })

    expect(calls).toEqual([
      'remark-a:raw',
      'remark-b:raw',
      'rehype-a:raw',
      'rehype-b:raw',
    ])
  })

  it('reports exceptions thrown by plugin transformers with the plugin id and rethrows', async () => {
    const onPluginError = vi.fn()
    const failure = new Error('boom')

    await expect(
      render({
        target: 'preview',
        pluginRehype: [
          { pluginId: 'ok', plugin: () => () => undefined },
          {
            pluginId: 'bad',
            plugin: () => async () => {
              throw failure
            },
          },
        ],
        onPluginError,
      })
    ).rejects.toBe(failure)

    expect(onPluginError).toHaveBeenCalledTimes(1)
    expect(onPluginError).toHaveBeenCalledWith('bad', failure)
  })

  it('reports exceptions thrown by plugin attachers', async () => {
    const onPluginError = vi.fn()
    const failure = new Error('attach failed')

    await expect(
      render({
        target: 'export',
        pluginRemark: [
          {
            pluginId: 'bad',
            plugin: () => {
              throw failure
            },
          },
        ],
        onPluginError,
      })
    ).rejects.toBe(failure)

    expect(onPluginError).toHaveBeenCalledWith('bad', failure)
  })
})
