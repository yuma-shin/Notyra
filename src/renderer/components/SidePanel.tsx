/**
 * Side_Panel（Requirement 13.3〜13.10、13.13、design.md 決定 #9・#20）。
 *
 * - 登録済みの Side_Panel_View ごとにタブを表示し、選択中のビューだけを描画する
 * - ビューは `render(container)` で描画し、戻り値の関数を非表示時（タブ切り替え・パネルを閉じる・
 *   Plugin_Stop）に呼ぶ。再表示時は改めて `render` を呼ぶ
 * - `render` の例外はそのビューの領域内に `role="alert"` で表示し、他の UI は継続する
 * - 選択中のビューが存在しない（未登録・Plugin_Stop 済み）場合は先頭のビューを表示する。
 *   永続化された選択は書き換えない（Plugin の読み込み後に復元できるようにするため）
 * - ビューが0件のときは空状態を表示する
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { usePluginRegistries } from '../contexts/PluginHostContext'
import type { SidePanelView } from '../lib/plugins/host/registries'
import { svgMaskStyle } from '../lib/plugins/svgIcon'
import { cn } from '../lib/utils'
import { SimpleTooltip } from './ui/tooltip'

const EMPTY_VIEWS: readonly SidePanelView[] = Object.freeze([])
const subscribeNothing = () => () => {}
const getEmptyViews = () => EMPTY_VIEWS

/**
 * このウィンドウの Side_Panel_View（Load_Order 順）を購読する。
 * PluginHostProvider の外では常に空配列を返す。
 */
export function useSidePanelViews(): readonly SidePanelView[] {
  const registry = usePluginRegistries()?.sidePanel ?? null
  return useSyncExternalStore(
    registry ? registry.store.subscribe : subscribeNothing,
    registry ? registry.getViews : getEmptyViews
  )
}

/** 選択中のビュー。指定 ID が無ければ先頭のビュー、0件なら null */
export function resolveActiveView(
  views: readonly SidePanelView[],
  activeViewId: string | undefined
): SidePanelView | null {
  return views.find(view => view.id === activeViewId) ?? views[0] ?? null
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** DOM の id 属性に使える文字列にする */
function toDomId(viewId: string): string {
  return viewId.replace(/[^A-Za-z0-9_-]/g, '_')
}

export interface SidePanelProps {
  views: readonly SidePanelView[]
  /** 永続化された選択中のビューの ID */
  activeViewId?: string
  onSelectView(viewId: string): void
  /** `render` またはクリーンアップ関数の例外の報告先 */
  onRenderError(pluginId: string, error: unknown): void
  width: number
}

export function SidePanel({
  views,
  activeViewId,
  onSelectView,
  onRenderError,
  width,
}: SidePanelProps) {
  const { t } = useTranslation()
  const activeView = resolveActiveView(views, activeViewId)

  return (
    <aside
      aria-label={t('plugins.sidePanel.title')}
      className="h-full flex flex-col flex-shrink-0 border-l border-border bg-background overflow-hidden"
      data-testid="side-panel"
      style={{ width }}
    >
      {activeView ? (
        <>
          <div
            aria-label={t('plugins.sidePanel.tabs')}
            className="flex items-center gap-0.5 px-1.5 h-9 flex-shrink-0 border-b border-border overflow-x-auto"
            role="tablist"
          >
            {views.map(view => {
              const selected = view.id === activeView.id
              const domId = toDomId(view.id)
              return (
                <SimpleTooltip content={view.title} key={view.id}>
                  <button
                    aria-controls={`side-panel-view-${domId}`}
                    aria-label={view.title}
                    aria-selected={selected}
                    className={cn(
                      'h-7 w-7 flex items-center justify-center rounded-md flex-shrink-0 transition-colors hover:bg-accent',
                      selected
                        ? 'text-[color:var(--theme-accent)] bg-accent'
                        : 'text-muted-foreground'
                    )}
                    id={`side-panel-tab-${domId}`}
                    onClick={() => {
                      if (!selected) onSelectView(view.id)
                    }}
                    role="tab"
                    tabIndex={selected ? 0 : -1}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="block h-4 w-4"
                      style={svgMaskStyle(view.icon)}
                    />
                  </button>
                </SimpleTooltip>
              )
            })}
          </div>
          <SidePanelViewHost
            key={activeView.id}
            onRenderError={onRenderError}
            view={activeView}
          />
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <p className="text-sm text-muted-foreground font-medium">
            {t('plugins.sidePanel.empty')}
          </p>
          <p className="text-xs text-muted-foreground/70 mt-2">
            {t('plugins.sidePanel.emptyHint')}
          </p>
        </div>
      )}
    </aside>
  )
}

interface SidePanelViewHostProps {
  view: SidePanelView
  onRenderError(pluginId: string, error: unknown): void
}

/** 1つの Side_Panel_View の描画領域。マウントで `render`、アンマウントでクリーンアップする */
function SidePanelViewHost({ view, onRenderError }: SidePanelViewHostProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const onRenderErrorRef = useRef(onRenderError)
  onRenderErrorRef.current = onRenderError

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cleanup: (() => void) | undefined
    try {
      const result = view.render(container)
      if (typeof result === 'function') cleanup = result
      setRenderError(null)
    } catch (error) {
      container.replaceChildren()
      setRenderError(errorMessage(error))
      onRenderErrorRef.current(view.pluginId, error)
    }

    return () => {
      try {
        cleanup?.()
      } catch (error) {
        onRenderErrorRef.current(view.pluginId, error)
      }
      container.replaceChildren()
    }
  }, [view])

  const domId = toDomId(view.id)
  return (
    <div
      aria-labelledby={`side-panel-tab-${domId}`}
      className="flex-1 min-h-0 flex flex-col overflow-auto"
      id={`side-panel-view-${domId}`}
      role="tabpanel"
    >
      {renderError !== null && (
        <div
          className="m-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {t('plugins.sidePanel.renderError', { message: renderError })}
        </div>
      )}
      <div
        className="flex-1 min-h-0"
        data-plugin-id={view.pluginId}
        data-testid="side-panel-view-container"
        ref={containerRef}
      />
    </div>
  )
}
