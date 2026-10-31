/**
 * Plugin のコード（activate / deactivate / Plugin_Command の実行処理）を
 * タイムアウト付きで実行する。
 *
 * - 同期例外、Promise の reject、タイムアウトをいずれも `ok: false` として返す
 * - タイムアウト後に遅れて完了・失敗した結果は無視する（未処理の reject にもしない）
 * - 完了した時点でタイマーを解除する
 */

export type RunWithTimeoutResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown; timedOut: boolean }

export class PluginTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms`)
    this.name = 'PluginTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export function runWithTimeout<T>(
  fn: () => T | Promise<T>,
  ms: number
): Promise<RunWithTimeoutResult<T>> {
  let result: T | Promise<T>
  try {
    result = fn()
  } catch (error) {
    return Promise.resolve({ ok: false, error, timedOut: false })
  }

  return new Promise<RunWithTimeoutResult<T>>(resolve => {
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve({ ok: false, error: new PluginTimeoutError(ms), timedOut: true })
    }, ms)

    const settle = (outcome: RunWithTimeoutResult<T>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(outcome)
    }

    // 拒否ハンドラを常に付けるため、タイムアウト後の reject も未処理にならない。
    // Promise.resolve は thenable の then 取得時の例外も reject として扱う。
    Promise.resolve(result).then(
      value => settle({ ok: true, value }),
      error => settle({ ok: false, error, timedOut: false })
    )
  })
}
