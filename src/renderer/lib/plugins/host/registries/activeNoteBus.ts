/**
 * Active_Note_Event の配信（Requirement 13.11、13.14、13.15）。
 *
 * メインウィンドウは `useNoteWorkspace`、ノートウィンドウは `editor.tsx` が publish する。
 * リスナーは Load_Order 順に呼び出し、例外はリスナーごとに捕捉して報告し、
 * 他のリスナーへの配信を続ける。
 */
import type { ActiveNoteEvent, Disposable } from '@/shared/plugin/api'
import { RegistryStore } from '../registryStore'

export type ActiveNoteListener = (event: ActiveNoteEvent) => void

export interface ActiveNoteBusOptions {
  /** リスナーの例外の報告先 */
  onListenerError?(pluginId: string, error: unknown): void
}

export class ActiveNoteBus {
  readonly store = new RegistryStore<ActiveNoteListener>()

  private readonly onListenerError?: (pluginId: string, error: unknown) => void
  private current: ActiveNoteEvent | null = null

  constructor(options: ActiveNoteBusOptions = {}) {
    this.onListenerError = options.onListenerError
  }

  subscribe(pluginId: string, listener: ActiveNoteListener): Disposable {
    const disposable = this.store.register(pluginId, listener)
    // Plugins may activate after the workspace has already published its note.
    // A fresh subscriber receives the current note as its initial switch.
    if (this.current) {
      this.deliver(pluginId, listener, {
        ...this.current,
        type: 'switched',
        note: this.current.note ? { ...this.current.note } : null,
      })
    }
    return disposable
  }

  publish(event: ActiveNoteEvent): void {
    this.current = { ...event, note: event.note ? { ...event.note } : null }
    // 配信中の購読・解除の影響を受けないよう、配信開始時点の一覧を使う
    for (const { pluginId, item: listener } of this.store.getSnapshot()) {
      this.deliver(pluginId, listener, event)
    }
  }

  private deliver(
    pluginId: string,
    listener: ActiveNoteListener,
    event: ActiveNoteEvent
  ): void {
    try {
      listener(event)
    } catch (error) {
      this.report(pluginId, error)
    }
  }

  private report(pluginId: string, error: unknown): void {
    try {
      if (this.onListenerError) this.onListenerError(pluginId, error)
      else console.error(error)
    } catch (reportError) {
      console.error(reportError)
    }
  }
}
