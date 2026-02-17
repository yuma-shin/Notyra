import { describe, it, expect } from 'vitest'
import { rehypeLocalImages } from '@/renderer/plugins/rehypeLocalImages'
import { remark } from 'remark'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'

async function processMarkdown(md: string, noteDir: string): Promise<string> {
  const result = await remark()
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeLocalImages, { noteDir })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(md)
  return String(result)
}

describe('rehypeLocalImages', () => {
  it('should convert relative image paths to local-resource:// URLs', async () => {
    const md = '![alt](images/photo.png)'
    const html = await processMarkdown(md, '/root/notes')
    expect(html).toContain('src="local-resource:///root/notes/images/photo.png"')
  })

  it('should skip absolute http URLs', async () => {
    const md = '![alt](https://example.com/photo.png)'
    const html = await processMarkdown(md, '/root/notes')
    expect(html).toContain('src="https://example.com/photo.png"')
  })

  it('should skip data: URLs', async () => {
    const md = '![alt](data:image/png;base64,abc)'
    const html = await processMarkdown(md, '/root/notes')
    expect(html).toContain('src="data:image/png;base64,abc"')
  })

  it('should skip already converted local-resource:// URLs', async () => {
    const md = '![alt](local-resource:///root/notes/images/photo.png)'
    const html = await processMarkdown(md, '/root/notes')
    expect(html).toContain('src="local-resource:///root/notes/images/photo.png"')
  })

  it('should handle images/ prefix correctly', async () => {
    const md = '![test](images/note_20260216_001.jpg)'
    const html = await processMarkdown(md, '/my/project')
    expect(html).toContain('src="local-resource:///my/project/images/note_20260216_001.jpg"')
  })

  it('should handle blob: URLs by skipping them', async () => {
    const md = '![alt](blob:http://localhost/abc)'
    const html = await processMarkdown(md, '/root')
    expect(html).toContain('src="blob:http://localhost/abc"')
  })

  it('should handle multiple images in a single document', async () => {
    const md = '![a](images/a.png)\n\n![b](https://cdn.example.com/b.png)\n\n![c](images/c.jpg)'
    const html = await processMarkdown(md, '/root')
    expect(html).toContain('src="local-resource:///root/images/a.png"')
    expect(html).toContain('src="https://cdn.example.com/b.png"')
    expect(html).toContain('src="local-resource:///root/images/c.jpg"')
  })

  it('should handle Windows-style noteDir paths with forward slashes', async () => {
    const md = '![alt](images/photo.png)'
    const html = await processMarkdown(md, 'C:/Users/test/notes')
    expect(html).toContain('src="local-resource://C/Users/test/notes/images/photo.png"')
  })

  it('should handle Windows-style noteDir paths with backslashes', async () => {
    const md = '![alt](images/photo.png)'
    const html = await processMarkdown(md, 'C:\\Users\\test\\notes')
    expect(html).toContain('src="local-resource://C/Users/test/notes/images/photo.png"')
  })
})
