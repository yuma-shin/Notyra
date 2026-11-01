import { afterEach, expect, it, vi } from 'vitest'
import { runWithTimeout } from '@/renderer/lib/plugins/withTimeout'

afterEach(() => vi.useRealTimers())
it('times out at exactly ten seconds and ignores late completion', async () => {
  vi.useFakeTimers()
  let finish!: (value: number) => void
  const result = runWithTimeout(
    () =>
      new Promise<number>(resolve => {
        finish = resolve
      }),
    10_000
  )
  const completed = vi.fn()
  result.then(completed)
  await vi.advanceTimersByTimeAsync(9_999)
  expect(completed).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(await result).toMatchObject({ ok: false, timedOut: true })
  finish(42)
  await Promise.resolve()
  expect(completed).toHaveBeenCalledTimes(1)
})
it('handles synchronous failures and rejections and clears successful timers', async () => {
  vi.useFakeTimers()
  const error = new Error('boom')
  expect(
    await runWithTimeout(() => {
      throw error
    }, 10_000)
  ).toEqual({ ok: false, error, timedOut: false })
  expect(await runWithTimeout(() => Promise.reject(error), 10_000)).toEqual({
    ok: false,
    error,
    timedOut: false,
  })
  expect(await runWithTimeout(() => 42, 10_000)).toEqual({
    ok: true,
    value: 42,
  })
  expect(vi.getTimerCount()).toBe(0)
})
