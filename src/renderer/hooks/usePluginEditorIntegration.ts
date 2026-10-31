/**
 * EditorView と Plugin のエディタ拡張・アクティブエディタを結線するフック
 * （design.md「16. エディタ拡張」、Requirement 13.12、15.2〜15.5、15.7）。
 *
 * - EditorExtensionRegistry を `useSyncExternalStore` で購読し、Load_Order 順の Extension 配列を返す。
 *   配列はレジストリの内容が変わらない限り同一参照のため、呼び出し側は `useMemo` の依存に使える
 * - `registerActiveEditor(view)` で ActiveEditorRegistry に登録し、フォーカス時にアクティブにする。
 *   次のエディタの登録、`releaseActiveEditor()`、アンマウントで登録を解除する
 * - プレビュー表示では `scrollPreview` を登録し、CodeMirror がなくても行移動できる
 * - PluginHostProvider の外（設定画面・テスト）では拡張なし・登録なしで動作する
 */
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { usePluginRegistries } from '../contexts/PluginHostContext'

const NO_EXTENSIONS: readonly Extension[] = Object.freeze([])
const noopSubscribe = (): (() => void) => () => {}
const getNoExtensions = (): readonly Extension[] => NO_EXTENSIONS

export interface PluginEditorIntegration {
  /** Plugin が登録した Extension（Load_Order 順）。変更がない限り同一参照 */
  readonly pluginExtensions: readonly Extension[]
  /** 生成されたエディタを ActiveEditorRegistry に登録する（前の登録は解除する） */
  registerActiveEditor(view: EditorView): void
  /** 現在の登録を解除する（エディタが破棄されたとき） */
  releaseActiveEditor(): void
}

export function usePluginEditorIntegration(
  scrollPreview?: (line: number) => boolean
): PluginEditorIntegration {
  const registries = usePluginRegistries()
  const editorExtensions = registries?.editorExtensions ?? null
  const activeEditor = registries?.activeEditor ?? null

  useEffect(() => {
    if (!activeEditor || !scrollPreview) return
    const registration = activeEditor.registerPreviewScroller(scrollPreview)
    return () => registration.dispose()
  }, [activeEditor, scrollPreview])

  const subscribe = editorExtensions?.store.subscribe ?? noopSubscribe
  const getSnapshot = editorExtensions?.getExtensions ?? getNoExtensions
  const pluginExtensions = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot
  )

  const releaseRef = useRef<(() => void) | null>(null)

  const releaseActiveEditor = useCallback(() => {
    const release = releaseRef.current
    releaseRef.current = null
    release?.()
  }, [])

  const registerActiveEditor = useCallback(
    (view: EditorView) => {
      releaseActiveEditor()
      if (!activeEditor) return
      const registration = activeEditor.register(view)
      const handleFocus = () => activeEditor.activate(view)
      view.dom.addEventListener('focusin', handleFocus)
      releaseRef.current = () => {
        view.dom.removeEventListener('focusin', handleFocus)
        registration.dispose()
      }
    },
    [activeEditor, releaseActiveEditor]
  )

  // アンマウント時に登録を解除する
  useEffect(() => releaseActiveEditor, [releaseActiveEditor])

  return { pluginExtensions, registerActiveEditor, releaseActiveEditor }
}
