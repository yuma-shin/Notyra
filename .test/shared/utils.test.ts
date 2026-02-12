import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeAppId, waitFor } from '@/shared/utils'

describe('makeAppId', () => {
  it('カスタム ID を渡した場合、そのまま返す', () => {
    expect(makeAppId('com.example.app')).toBe('com.example.app')
  })

  it('デフォルト値で package.json から生成された ID を返す', () => {
    const result = makeAppId()
    expect(result).toMatch(/^com\..+\..+$/)
    expect(result).toBe(result.toLowerCase())
  })
})

describe('waitFor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('指定ミリ秒後に解決される', async () => {
    const promise = waitFor(1000)

    vi.advanceTimersByTime(999)
    // まだ解決されていない（pending 状態）

    vi.advanceTimersByTime(1)
    await expect(promise).resolves.toBeUndefined()
  })

  it('0ms でも正しく解決される', async () => {
    const promise = waitFor(0)
    vi.advanceTimersByTime(0)
    await expect(promise).resolves.toBeUndefined()
  })
})
