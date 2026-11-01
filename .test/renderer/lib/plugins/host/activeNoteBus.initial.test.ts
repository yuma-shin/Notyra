import { expect, it, vi } from 'vitest'
import { ActiveNoteBus } from '@/renderer/lib/plugins/host/registries/activeNoteBus'

it('gives a plugin activated later the current note without waiting for an edit', () => {
  const bus = new ActiveNoteBus()
  const note = { path: '/notes/a.md', title: 'A', rootFolder: '/notes', body: '# A\n## B' }
  bus.publish({ type: 'changed', note, windowKind: 'main' })
  const listener = vi.fn()
  const disposable = bus.subscribe('toc', listener)
  expect(listener).toHaveBeenCalledWith({ type: 'switched', note, windowKind: 'main' })
  disposable.dispose()
  bus.publish({ type: 'switched', note: null, windowKind: 'main' })
  expect(listener).toHaveBeenCalledTimes(1)
  const next = vi.fn()
  bus.subscribe('next', next)
  expect(next).toHaveBeenCalledWith({ type: 'switched', note: null, windowKind: 'main' })
})

it('isolates exceptions and mutation in the initial notification', () => {
  const report = vi.fn()
  const bus = new ActiveNoteBus({ onListenerError: report })
  bus.publish({ type: 'switched', note: { path: '/a.md', title: 'A', rootFolder: '/', body: '# A' }, windowKind: 'note' })
  const failure = new Error('bad listener')
  expect(() => bus.subscribe('bad', event => { if (event.note) event.note.body = 'changed'; throw failure })).not.toThrow()
  expect(report).toHaveBeenCalledWith('bad', failure)
  const good = vi.fn()
  bus.subscribe('good', good)
  expect(good.mock.calls[0][0].note.body).toBe('# A')
})
