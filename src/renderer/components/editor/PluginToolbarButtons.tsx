/**
 * Plugin が Markdown ツールバーに追加したボタン（Requirement 16.3、16.5〜16.7）。
 *
 * - ToolbarRegistry を購読し、Load_Order 順に描画する
 * - アイコンは SVG を DOM に挿入せず `mask-image` + `currentColor` で描画する（design.md 決定 #19）
 * - ツールチップとアクセシブルなラベルには Plugin が指定した文言をそのまま使う
 * - PluginHostProvider の外（設定画面・既存テスト）では何も描画しない
 */
import { type ReactNode, useMemo, useSyncExternalStore } from 'react'
import { usePluginHost } from '@/renderer/contexts/PluginHostContext'
import { ICON_SIZE } from '@/renderer/lib/iconConstants'
import type { ToolbarButton } from '@/renderer/lib/plugins/host/registries'
import { runPluginCommand } from '@/renderer/lib/plugins/host/runPluginCommand'
import { svgMaskStyle } from '@/renderer/lib/plugins/svgIcon'
import { Button } from '../ui/button'
import { SimpleTooltip } from '../ui/tooltip'

const NO_BUTTONS: readonly ToolbarButton[] = Object.freeze([])

// 登録ごとに別オブジェクトになるボタンに、React の key 用の連番を割り当てる
// （同じ Plugin が同じコマンドのボタンを複数追加しても衝突しない）
const buttonKeys = new WeakMap<ToolbarButton, number>()
let nextButtonKey = 0
function keyOf(button: ToolbarButton): number {
  let key = buttonKeys.get(button)
  if (key === undefined) {
    key = nextButtonKey++
    buttonKeys.set(button, key)
  }
  return key
}
const noop = () => () => {}
const getNoButtons = () => NO_BUTTONS

interface PluginToolbarButtonsProps {
  /** ボタンが1件以上あるとき、先頭に描画する区切り */
  separator?: ReactNode
}

export function PluginToolbarButtons({ separator }: PluginToolbarButtonsProps) {
  const pluginHost = usePluginHost()
  const toolbar = pluginHost?.registries.toolbar ?? null
  const buttons = useSyncExternalStore(
    toolbar?.store.subscribe ?? noop,
    toolbar?.getButtons ?? getNoButtons
  )

  if (!pluginHost || buttons.length === 0) return null

  const { registries, reportError } = pluginHost
  const handleClick = (button: ToolbarButton) => {
    void runPluginCommand(
      { commands: registries.commands, reportError },
      button.command
    )
  }

  return (
    <>
      {separator}
      {buttons.map(button => (
        <PluginToolbarButton
          button={button}
          key={keyOf(button)}
          onClick={handleClick}
        />
      ))}
    </>
  )
}

interface PluginToolbarButtonProps {
  button: ToolbarButton
  onClick(button: ToolbarButton): void
}

function PluginToolbarButton({ button, onClick }: PluginToolbarButtonProps) {
  const iconStyle = useMemo(
    () => ({
      ...svgMaskStyle(button.icon),
      width: ICON_SIZE.TOOLBAR,
      height: ICON_SIZE.TOOLBAR,
    }),
    [button.icon]
  )

  return (
    <SimpleTooltip content={button.tooltip}>
      <Button
        aria-label={button.tooltip}
        data-plugin-id={button.pluginId}
        onClick={() => onClick(button)}
        size="icon"
        variant="ghost"
      >
        <span aria-hidden="true" className="inline-block" style={iconStyle} />
      </Button>
    </SimpleTooltip>
  )
}
