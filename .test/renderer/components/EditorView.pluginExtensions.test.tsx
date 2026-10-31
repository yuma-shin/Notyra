import { EditorView as CodemirrorEditorView } from '@codemirror/view'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@/renderer/components/EditorView'
import {
  createRegistries,
  type Registries,
} from '@/renderer/lib/plugins/host/registries'

const mocks = vi.hoisted(() => ({
  registries: null as Registries | null,
}))

vi.mock('@/renderer/contexts/PluginHostContext', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@/renderer/contexts/PluginHostContext')
  >()),
  usePluginRegistries: () => mocks.registries,
}))

function noop() {}

function getCodeMirrorView(): CodemirrorEditorView {
  const dom = document.querySelector('.cm-editor') as HTMLElement | null
  if (!dom) throw new Error('CodeMirror is not mounted')
  const view = CodemirrorEditorView.findFromDOM(dom)
  if (!view) throw new Error('EditorView instance not found')
  return view
}

const pluginAttribute = (value: string) =>
  CodemirrorEditorView.editorAttributes.of({ 'data-plugin-ext': value })

let registries: Registries

beforeEach(() => {
  registries = createRegistries({ platform: 'other' })
  mocks.registries = registries
})

afterEach(() => {
  cleanup()
  mocks.registries = null
})

describe('EditorView の Plugin エディタ拡張', () => {
  it('プレビューのみでも Plugin_API から見出しへ移動し、アンマウントで解除する', async () => {
    const onChange = vi.fn()
    const { unmount } = render(
      <EditorView content={'# First\n\n## Target\n\nBody'} filePath="/notes/preview.md" layoutMode="preview" onChange={onChange} onLayoutModeChange={noop} />
    )
    const heading = await screen.findByRole('heading', { name: 'Target' })
    const pane = heading.closest('.overflow-auto') as HTMLElement
    Object.defineProperties(pane, {
      scrollHeight: { value: 2000 }, clientHeight: { value: 400 },
    })
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect)
    vi.spyOn(heading, 'getClientRects').mockImplementation(
      () => [{ top: 600 - pane.scrollTop }] as unknown as DOMRectList
    )
    expect(registries.activeEditor.getActive()).toBeNull()
    act(() => { expect(registries.activeEditor.scrollToLine(3)).toBe(true) })
    expect(pane.scrollTop).toBe(600)
    expect(onChange).not.toHaveBeenCalled()
    unmount()
    expect(registries.activeEditor.scrollToLine(3)).toBe(false)
  })

  it('開いているエディタに再生成せず拡張を適用し、解除で取り除く。本文とカーソルは維持される', () => {
    render(
      <EditorView
        content={'Hello\nWorld'}
        filePath="/notes/a.md"
        layoutMode="editor"
        onChange={noop}
        onLayoutModeChange={noop}
      />
    )
    const view = getCodeMirrorView()
    act(() => {
      view.dispatch({ selection: { anchor: 3 } })
    })

    let registration: { dispose(): void } | undefined
    act(() => {
      registration = registries.editorExtensions.register(
        'plugin-a',
        pluginAttribute('a')
      )
    })

    expect(getCodeMirrorView()).toBe(view)
    expect(view.dom.getAttribute('data-plugin-ext')).toBe('a')
    expect(view.state.doc.toString()).toBe('Hello\nWorld')
    expect(view.state.selection.main.head).toBe(3)

    act(() => {
      registration?.dispose()
    })

    expect(getCodeMirrorView()).toBe(view)
    expect(view.dom.hasAttribute('data-plugin-ext')).toBe(false)
    expect(view.state.doc.toString()).toBe('Hello\nWorld')
    expect(view.state.selection.main.head).toBe(3)
  })

  it('解除した Plugin の拡張のみを取り除き、他の Plugin の拡張は維持する', () => {
    render(
      <EditorView
        content="text"
        filePath="/notes/a.md"
        layoutMode="editor"
        onChange={noop}
        onLayoutModeChange={noop}
      />
    )
    let first: { dispose(): void } | undefined
    act(() => {
      first = registries.editorExtensions.register(
        'plugin-a',
        CodemirrorEditorView.editorAttributes.of({ 'data-a': 'on' })
      )
      registries.editorExtensions.register(
        'plugin-b',
        CodemirrorEditorView.editorAttributes.of({ 'data-b': 'on' })
      )
    })
    const view = getCodeMirrorView()
    expect(view.dom.getAttribute('data-a')).toBe('on')
    expect(view.dom.getAttribute('data-b')).toBe('on')

    act(() => {
      first?.dispose()
    })

    expect(view.dom.hasAttribute('data-a')).toBe(false)
    expect(view.dom.getAttribute('data-b')).toBe('on')
  })

  it('登録中に新たに生成されたエディタにも拡張を適用する', () => {
    act(() => {
      registries.editorExtensions.register('plugin-a', pluginAttribute('a'))
    })
    const { rerender } = render(
      <EditorView
        content="first"
        filePath="/notes/a.md"
        layoutMode="editor"
        onChange={noop}
        onLayoutModeChange={noop}
      />
    )
    const firstView = getCodeMirrorView()
    expect(firstView.dom.getAttribute('data-plugin-ext')).toBe('a')

    rerender(
      <EditorView
        content="second"
        filePath="/notes/b.md"
        layoutMode="split"
        onChange={noop}
        onLayoutModeChange={noop}
      />
    )
    const secondView = getCodeMirrorView()
    expect(secondView).not.toBe(firstView)
    expect(secondView.dom.getAttribute('data-plugin-ext')).toBe('a')
  })

  it('生成したエディタをアクティブエディタとして登録し、破棄で解除する', () => {
    const { rerender, unmount } = render(
      <EditorView
        content={'line1\nline2\nline3'}
        filePath="/notes/a.md"
        layoutMode="editor"
        onChange={noop}
        onLayoutModeChange={noop}
      />
    )
    const firstView = getCodeMirrorView()
    expect(registries.activeEditor.getActive()).toBe(firstView)
    expect(registries.activeEditor.scrollToLine(2)).toBe(true)

    // ノート切り替えで生成し直されたエディタに置き換わる
    rerender(
      <EditorView
        content="other"
        filePath="/notes/b.md"
        layoutMode="editor"
        onChange={noop}
        onLayoutModeChange={noop}
      />
    )
    const secondView = getCodeMirrorView()
    expect(registries.activeEditor.getActive()).toBe(secondView)

    // プレビューのみの表示ではエディタが破棄されるため登録を解除する
    rerender(
      <EditorView
        content="other"
        filePath="/notes/b.md"
        layoutMode="preview"
        onChange={noop}
        onLayoutModeChange={noop}
      />
    )
    expect(registries.activeEditor.getActive()).toBeNull()
    expect(registries.activeEditor.scrollToLine(1)).toBe(false)

    rerender(
      <EditorView
        content="other"
        filePath="/notes/b.md"
        layoutMode="editor"
        onChange={noop}
        onLayoutModeChange={noop}
      />
    )
    expect(registries.activeEditor.getActive()).toBe(getCodeMirrorView())

    unmount()
    expect(registries.activeEditor.getActive()).toBeNull()
  })

  it('フォーカスされたエディタをアクティブにする', () => {
    render(
      <EditorView
        content="text"
        filePath="/notes/a.md"
        layoutMode="editor"
        onChange={noop}
        onLayoutModeChange={noop}
      />
    )
    const view = getCodeMirrorView()
    // 別のエディタが後から登録されてアクティブになった状態を作る
    const other = new CodemirrorEditorView({ doc: 'other' })
    const otherRegistration = registries.activeEditor.register(other)
    expect(registries.activeEditor.getActive()).toBe(other)

    act(() => {
      view.contentDOM.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    })
    expect(registries.activeEditor.getActive()).toBe(view)

    otherRegistration.dispose()
    other.destroy()
  })

  it('PluginHostProvider の外では拡張なしで動作する', () => {
    mocks.registries = null
    render(
      <EditorView
        content="text"
        filePath="/notes/a.md"
        layoutMode="editor"
        onChange={noop}
        onLayoutModeChange={noop}
      />
    )
    const view = getCodeMirrorView()
    expect(view.state.doc.toString()).toBe('text')
    expect(view.dom.hasAttribute('data-plugin-ext')).toBe(false)
  })
})
