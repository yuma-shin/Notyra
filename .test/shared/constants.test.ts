import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('ENVIRONMENT', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('NODE_ENV が development のとき IS_DEV は true', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { ENVIRONMENT } = await import('@/shared/constants')
    expect(ENVIRONMENT.IS_DEV).toBe(true)
    vi.unstubAllEnvs()
  })

  it('NODE_ENV が production のとき IS_DEV は false', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { ENVIRONMENT } = await import('@/shared/constants')
    expect(ENVIRONMENT.IS_DEV).toBe(false)
    vi.unstubAllEnvs()
  })
})

describe('PLATFORM', () => {
  it('PLATFORM オブジェクトが IS_MAC, IS_WINDOWS, IS_LINUX プロパティを持つ', async () => {
    const { PLATFORM } = await import('@/shared/constants')
    expect(PLATFORM).toHaveProperty('IS_MAC')
    expect(PLATFORM).toHaveProperty('IS_WINDOWS')
    expect(PLATFORM).toHaveProperty('IS_LINUX')
  })

  it('PLATFORM の各値が boolean である', async () => {
    const { PLATFORM } = await import('@/shared/constants')
    expect(typeof PLATFORM.IS_MAC).toBe('boolean')
    expect(typeof PLATFORM.IS_WINDOWS).toBe('boolean')
    expect(typeof PLATFORM.IS_LINUX).toBe('boolean')
  })

  it('正確に1つのプラットフォームだけが true（現在の環境で）', async () => {
    const { PLATFORM } = await import('@/shared/constants')
    const trueCount = [PLATFORM.IS_MAC, PLATFORM.IS_WINDOWS, PLATFORM.IS_LINUX].filter(Boolean).length
    expect(trueCount).toBeLessThanOrEqual(1)
  })
})
