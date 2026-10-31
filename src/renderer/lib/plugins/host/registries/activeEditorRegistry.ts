/**
 * Plugin_Host_Window のアクティブなエディタとプレビューの移動先（Requirement 13.12）。
 *
 * EditorView は `onCreateEditor` で `register` し、破棄時に dispose する。
 * 複数のエディタがある場合は、最後に登録またはフォーカスされたものをアクティブとする。
 * Plugin ごとの登録ではないため、Plugin_Stop の解除対象ではない。
 */
import { EditorView } from '@codemirror/view'
import type { Disposable } from '@/shared/plugin/api'

export class ActiveEditorRegistry {
  /** 末尾がアクティブ */
  private readonly views: EditorView[] = []
  private readonly previewScrollers = new Set<(line: number) => boolean>()

  /** Preview-only note views provide navigation without a CodeMirror instance. */
  registerPreviewScroller(scroll: (line: number) => boolean): Disposable {
    this.previewScrollers.add(scroll)
    return {
      dispose: () => {
        this.previewScrollers.delete(scroll)
      },
    }
  }

  register(view: EditorView): Disposable {
    this.remove(view)
    this.views.push(view)
    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        this.remove(view)
      },
    }
  }

  /** 登録済みのエディタをアクティブにする（フォーカス時に呼ぶ） */
  activate(view: EditorView): void {
    if (!this.views.includes(view)) return
    this.remove(view)
    this.views.push(view)
  }

  getActive(): EditorView | null {
    return this.views[this.views.length - 1] ?? null
  }

  /**
   * 現在のノートの指定行（1始まり）を表示領域の先頭へスクロールする。
   * プレビューのみの場合は対応する描画ブロックへ移動する。
   * 範囲外の行は表示可能な範囲へ丸める。移動先が登録されていない、
   * または行番号が有限の数でない場合は false を返す。
   */
  scrollToLine(line: number): boolean {
    if (!Number.isFinite(line)) return false
    const view = this.getActive()
    if (!view) {
      const scroll = Array.from(this.previewScrollers).at(-1)
      return scroll?.(Math.max(1, Math.trunc(line))) ?? false
    }
    const doc = view.state.doc
    const lineNumber = Math.min(Math.max(Math.trunc(line), 1), doc.lines)
    const { from } = doc.line(lineNumber)
    view.dispatch({ effects: EditorView.scrollIntoView(from, { y: 'start' }) })
    return true
  }

  private remove(view: EditorView): void {
    const index = this.views.indexOf(view)
    if (index !== -1) this.views.splice(index, 1)
  }
}
