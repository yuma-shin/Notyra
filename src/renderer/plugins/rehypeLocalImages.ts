import { visit } from 'unist-util-visit'
import type { Root, Element } from 'hast'

interface RehypeLocalImagesOptions {
  noteDir: string
}

const PROTOCOL_PREFIXES = [
  'http://',
  'https://',
  'data:',
  'blob:',
  'local-resource://',
]

export function rehypeLocalImages(options: RehypeLocalImagesOptions) {
  const { noteDir } = options

  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'img') return

      const src = node.properties?.src
      if (typeof src !== 'string' || !src) return

      // Skip URLs that already have a protocol
      if (PROTOCOL_PREFIXES.some(prefix => src.startsWith(prefix))) return

      // Convert relative path to local-resource:// URL
      // Normalize to forward slashes and remove drive letter colon for clean URL parsing
      // e.g., F:\notes + images/foo.png → local-resource://F/notes/images/foo.png
      const absolutePath = `${noteDir}/${src}`.replace(/\\/g, '/')
      const urlPath = absolutePath.replace(/^([A-Za-z]):\//, '$1/')
      node.properties.src = `local-resource://${urlPath}`
    })
  }
}
