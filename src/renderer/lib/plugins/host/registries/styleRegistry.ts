/**
 * Plugin が追加する CSS（Requirement 12.1〜12.4）と、Theme_Plugin の追加CSS
 * （そのテーマが選択中の間だけ有効。Requirement 11.5）を管理する。
 *
 * 各 CSS は `<style data-plugin-id="<id>">` として `document.head` の末尾に Load_Order 順で
 * 挿入する。レジストリは Plugin_Host_Window ごとに生成するため、CSS はその Window の
 * 文書にだけ適用される（Requirement 12.2）。
 */
import type { Disposable } from '@/shared/plugin/api'
import { RegistryStore } from '../registryStore'

export interface StyleOptions {
  /** 指定すると、このカラーテーマ ID が選択中の間だけ CSS を適用する */
  whenThemeId?: string
}

export interface StyleItem {
  readonly css: string
  readonly whenThemeId?: string
}

export const PLUGIN_STYLE_ATTRIBUTE = 'data-plugin-id'

export class StyleRegistry {
  readonly store = new RegistryStore<StyleItem>()

  private readonly doc: Document | undefined
  private readonly elements = new Map<StyleItem, HTMLStyleElement>()
  private activeThemeId: string | null = null

  constructor(doc: Document | undefined = globalThis.document) {
    this.doc = doc
    this.store.subscribe(() => this.sync())
  }

  /** CSS を追加する。戻り値の dispose() で取り除く（冪等） */
  add(pluginId: string, css: string, options: StyleOptions = {}): Disposable {
    const item: StyleItem = Object.freeze({
      css,
      ...(options.whenThemeId !== undefined
        ? { whenThemeId: options.whenThemeId }
        : {}),
    })
    return this.store.register(pluginId, item)
  }

  /** 選択中のカラーテーマ ID を設定し、条件付きの CSS の適用状態を更新する */
  setActiveThemeId(themeId: string | null): void {
    if (this.activeThemeId === themeId) return
    this.activeThemeId = themeId
    this.sync()
  }

  getActiveThemeId(): string | null {
    return this.activeThemeId
  }

  /** 現在文書に適用している CSS（Load_Order 順） */
  getAppliedEntries(): { pluginId: string; item: StyleItem }[] {
    return this.store.getSnapshot().filter(e => this.isActive(e.item))
  }

  private isActive(item: StyleItem): boolean {
    return (
      item.whenThemeId === undefined || item.whenThemeId === this.activeThemeId
    )
  }

  /** 登録状態と選択中のテーマに合わせて `<style>` 要素を挿入・削除・並べ替える */
  private sync(): void {
    const doc = this.doc
    if (!doc) return

    const applied = this.getAppliedEntries()
    const wanted = new Set(applied.map(e => e.item))

    for (const [item, element] of this.elements) {
      if (!wanted.has(item)) {
        element.remove()
        this.elements.delete(item)
      }
    }

    const ordered = applied.map(({ pluginId, item }) => {
      let element = this.elements.get(item)
      if (!element) {
        element = doc.createElement('style')
        element.setAttribute(PLUGIN_STYLE_ATTRIBUTE, pluginId)
        element.textContent = item.css
        this.elements.set(item, element)
      }
      return element
    })

    // 未挿入の要素がある、または並び順が Load_Order と異なる場合だけ末尾に並べ直す
    const inDocument = [...doc.head.children].filter(el =>
      ordered.includes(el as HTMLStyleElement)
    )
    const inOrder =
      inDocument.length === ordered.length &&
      inDocument.every((el, i) => el === ordered[i])
    if (!inOrder) {
      for (const element of ordered) doc.head.appendChild(element)
    }
  }
}
