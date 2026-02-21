import { visit } from 'unist-util-visit'
import type { Root, Element, Text } from 'hast'

/**
 * Rehype plugin that transforms ```mermaid code blocks into placeholder divs.
 * These divs are later rendered by mermaid.js in MarkdownPreview.
 */
export function rehypeMermaid() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'pre' || !parent || index === undefined) return

      const codeEl = node.children.find(
        (child): child is Element =>
          child.type === 'element' && child.tagName === 'code'
      )

      if (!codeEl) return

      const classes = (codeEl.properties?.className as string[]) || []
      if (!classes.includes('language-mermaid')) return

      // Extract raw diagram text from the code element
      const text = codeEl.children
        .filter((c): c is Text => c.type === 'text')
        .map(c => c.value)
        .join('')
        .trim()

      // Replace <pre><code class="language-mermaid"> with a placeholder div
      ;(parent as Element).children[index] = {
        type: 'element',
        tagName: 'div',
        properties: {
          className: ['mermaid-placeholder'],
          'data-diagram': encodeURIComponent(text),
        },
        children: [],
      }
    })
  }
}
