import type { Root } from 'hast'
import { visit } from 'unist-util-visit'

const blockTags = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'pre',
  'blockquote',
  'li',
  'table',
  'tr',
  'hr',
])

/** Keep Markdown source positions on rendered blocks for split-view scrolling. */
export function rehypeSourceLines() {
  return (tree: Root) => {
    visit(tree, 'element', node => {
      const isDiagram =
        Array.isArray(node.properties.className) &&
        node.properties.className.includes('mermaid-placeholder')
      if ((!blockTags.has(node.tagName) && !isDiagram) || !node.position) return
      node.properties['data-source-line'] = node.position.start.line
    })
  }
}
