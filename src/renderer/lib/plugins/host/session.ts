/**
 * Plugin ごとの登録スコープ。
 *
 * Plugin_API ファサードは、Plugin が行った登録（レジストリへの登録、イベント購読など）を
 * 現在のセッションに `track` で記録する。Plugin_Stop と activate() 失敗時の巻き戻しでは
 * `disposeAll` で登録の逆順にすべて解除し、登録状態を有効化前に戻す（Requirement 8.10、8.11）。
 */
import type { Disposable } from '@/shared/plugin/api'

export interface PluginSessionOptions {
  /** 解除中に発生した例外の報告先。例外は握りつぶさず、すべて報告する */
  onDisposeError?(error: unknown): void
}

export class PluginSession {
  readonly pluginId: string
  /** activate() が完了したか（deactivate() を呼ぶかの判定に使う） */
  activated = false

  private readonly disposables: Disposable[] = []
  private disposedFlag = false
  private readonly onDisposeError?: (error: unknown) => void

  constructor(pluginId: string, options: PluginSessionOptions = {}) {
    this.pluginId = pluginId
    this.onDisposeError = options.onDisposeError
  }

  /** disposeAll() 済みか */
  get disposed(): boolean {
    return this.disposedFlag
  }

  /**
   * 登録を記録する。
   * disposeAll() の後に呼ばれた場合（タイムアウト後に遅れて登録された場合など）は、
   * 記録せずに直ちに解除する。
   */
  track<T extends Disposable>(d: T): T {
    if (this.disposedFlag) {
      this.safeDispose(d)
      return d
    }
    this.disposables.push(d)
    return d
  }

  /**
   * 記録から外す（Plugin が個別に dispose した登録を保持し続けないため）。
   * 解除そのものは行わない。
   */
  untrack(d: Disposable): void {
    const index = this.disposables.lastIndexOf(d)
    if (index !== -1) this.disposables.splice(index, 1)
  }

  /**
   * 記録した登録を逆順にすべて解除する。冪等で、2回目以降は何もしない。
   * 個々の解除で例外が発生しても残りの解除を続行し、発生した例外を返す。
   */
  disposeAll(): unknown[] {
    if (this.disposedFlag) return []
    this.disposedFlag = true

    const errors: unknown[] = []
    while (this.disposables.length > 0) {
      const d = this.disposables.pop() as Disposable
      const error = this.safeDispose(d)
      if (error !== undefined) errors.push(error.value)
    }
    return errors
  }

  private safeDispose(d: Disposable): { value: unknown } | undefined {
    try {
      d.dispose()
      return undefined
    } catch (error) {
      try {
        this.onDisposeError?.(error)
      } catch (reportError) {
        console.error(reportError)
      }
      return { value: error }
    }
  }
}
