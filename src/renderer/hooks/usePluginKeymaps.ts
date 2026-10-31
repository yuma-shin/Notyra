/**
 * Plugin のキーバインドを `window` の keydown で処理する（Requirement 16.4、16.5、16.8、16.9）。
 *
 * - 照合には KeymapRegistry の解決済みの結果（組み込み優先、Load_Order 先勝ち）を使う
 * - IME 変換中の入力と、既に処理済み（`defaultPrevented`）の入力は扱わない
 *   （エディタなど本体のキーバインドが処理したキーを奪わない）
 * - 一致したら `preventDefault` し、Plugin_Command を `runPluginCommand` で実行する
 *   （キーの押し続けによるリピートは既定動作だけを抑止し、実行しない）
 * - 1ストロークのキーバインドのみを照合する
 *
 * PluginHostProvider の内側で1回だけ呼ぶ。
 */
import { useEffect, useRef } from 'react'
import type { PluginErrorSource } from '@/shared/plugin/types'
import type { Registries } from '../lib/plugins/host/registries'
import { runPluginCommand } from '../lib/plugins/host/runPluginCommand'
import { keyEventToKeys } from '../lib/plugins/keybindings'

type ReportError = (
  pluginId: string,
  source: PluginErrorSource,
  error: unknown
) => void

export interface UsePluginKeymapsOptions {
  /** Plugin_Command の待機上限（テスト用）。既定は 10秒 */
  timeoutMs?: number
}

export function usePluginKeymaps(
  registries: Registries,
  reportError: ReportError,
  options: UsePluginKeymapsOptions = {}
): void {
  const reportErrorRef = useRef(reportError)
  reportErrorRef.current = reportError
  const { timeoutMs } = options

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleKeyDown = (event: KeyboardEvent) => {
      // keyCode 229 は IME 処理中の keydown（isComposing が false の環境がある）
      if (event.isComposing || event.keyCode === 229) return
      if (event.defaultPrevented) return

      let commandId: string | undefined
      for (const key of keyEventToKeys(event)) {
        commandId = registries.keymaps.lookup(key)?.command
        if (commandId) break
      }
      if (!commandId) return

      event.preventDefault()
      if (event.repeat) return
      void runPluginCommand(
        {
          commands: registries.commands,
          reportError: (pluginId, source, error) =>
            reportErrorRef.current(pluginId, source, error),
          timeoutMs,
        },
        commandId
      )
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [registries, timeoutMs])
}
