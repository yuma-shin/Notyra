import { describe, expect, it, vi } from 'vitest'
import { PluginSession } from '@/renderer/lib/plugins/host/session'

function recorder(log: string[], name: string) {
  return { dispose: vi.fn(() => log.push(name)) }
}

describe('PluginSession', () => {
  it('disposes tracked registrations in reverse order', () => {
    const log: string[] = []
    const session = new PluginSession('p')
    session.track(recorder(log, 'a'))
    session.track(recorder(log, 'b'))
    session.track(recorder(log, 'c'))

    expect(session.disposeAll()).toEqual([])
    expect(log).toEqual(['c', 'b', 'a'])
    expect(session.disposed).toBe(true)
  })

  it('is idempotent', () => {
    const log: string[] = []
    const session = new PluginSession('p')
    const d = session.track(recorder(log, 'a'))

    session.disposeAll()
    session.disposeAll()
    expect(d.dispose).toHaveBeenCalledTimes(1)
  })

  it('continues disposing after an exception and reports every error', () => {
    const log: string[] = []
    const onDisposeError = vi.fn()
    const session = new PluginSession('p', { onDisposeError })
    const e1 = new Error('first')
    const e2 = new Error('second')
    session.track(recorder(log, 'a'))
    session.track({
      dispose: () => {
        throw e1
      },
    })
    session.track(recorder(log, 'c'))
    session.track({
      dispose: () => {
        throw e2
      },
    })

    expect(session.disposeAll()).toEqual([e2, e1])
    expect(log).toEqual(['c', 'a'])
    expect(onDisposeError).toHaveBeenNthCalledWith(1, e2)
    expect(onDisposeError).toHaveBeenNthCalledWith(2, e1)
  })

  it('immediately disposes registrations tracked after disposeAll', () => {
    const log: string[] = []
    const session = new PluginSession('p')
    session.disposeAll()

    const late = session.track(recorder(log, 'late'))
    expect(late.dispose).toHaveBeenCalledTimes(1)
    expect(session.disposeAll()).toEqual([])
    expect(late.dispose).toHaveBeenCalledTimes(1)
  })

  it('does not dispose untracked registrations', () => {
    const log: string[] = []
    const session = new PluginSession('p')
    const a = session.track(recorder(log, 'a'))
    session.track(recorder(log, 'b'))
    session.untrack(a)

    session.disposeAll()
    expect(log).toEqual(['b'])
  })
})
