import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NoteSaveSession, sameNotePath } from '@/renderer/lib/noteSaveSession'
import type { NoteMutation } from '@/shared/noteMutation'
import type { NoteContent } from '@/shared/types'

const content = (body: string, path = '/notes/a.md'): NoteContent => ({
  content: body, rawContent: body,
  meta: { id: path, filePath: path, relativePath: path.split('/').at(-1)!, title: 'Note' },
})
function event(phase: NoteMutation['phase'], kind: NoteMutation['kind'] = 'update', newPath: string | null = null): NoteMutation {
  return { requestId: phase, transactionId: 'tx', phase, kind, paths: ['/notes/a.md'], newPath }
}
function setup() {
  let disk = content('initial')
  const save = vi.fn(async (path: string, body: string) => {
    disk = content(body, path)
    return body
  })
  const load = vi.fn(async () => disk)
  const reload = vi.fn(), rebind = vi.fn(), structure = vi.fn(async () => {})
  const session = new NoteSaveSession({ save, load, reload, rebind, structure, error: vi.fn(), locked: vi.fn(), saving: vi.fn() })
  session.bind('/notes/a.md')
  return { session, save, load, reload, rebind, structure, write: (next: NoteContent) => { disk = next } }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('drains a pending autosave before plugin update and cannot overwrite its committed body', async () => {
  const { session, save, reload, write } = setup()
  session.schedule('typed')
  await vi.advanceTimersByTimeAsync(200)
  await session.mutation(event('prepare'))
  expect(save).toHaveBeenLastCalledWith('/notes/a.md', 'typed')
  expect(session.isLocked).toBe(true)
  expect(session.schedule('stale edit during the write')).toBe(false)
  write(content('typed + plugin'))
  await session.mutation(event('commit'))
  expect(reload).toHaveBeenLastCalledWith(content('typed + plugin'), '/notes/a.md')
  await vi.advanceTimersByTimeAsync(5000)
  expect(save).toHaveBeenCalledTimes(1)
  expect(session.isLocked).toBe(false)
  session.schedule('typed + plugin + next edit')
  await vi.advanceTimersByTimeAsync(1000)
  expect(save).toHaveBeenLastCalledWith('/notes/a.md', 'typed + plugin + next edit')
})

it('awaits an autosave that already started before acknowledging prepare', async () => {
  const { session, save } = setup()
  let finish!: (raw: string) => void
  save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  session.schedule('in flight')
  await vi.advanceTimersByTimeAsync(1000)
  let prepared = false
  const preparing = session.mutation(event('prepare')).then(() => { prepared = true })
  await Promise.resolve()
  expect(prepared).toBe(false)
  finish('in flight')
  await preparing
  expect(prepared).toBe(true)
})

it('also waits for a metadata write already running in the editor', async () => {
  const { session } = setup()
  let finish!: () => void
  const write = session.runWrite(() => new Promise<void>(resolve => { finish = resolve }))
  await Promise.resolve()
  let prepared = false
  const prepare = session.mutation(event('prepare')).then(() => { prepared = true })
  await Promise.resolve()
  expect(prepared).toBe(false)
  finish()
  await Promise.all([write, prepare])
  expect(prepared).toBe(true)
})

it('rechecks watcher notifications deferred by a UI metadata write', async () => {
  const { session, load, reload, write } = setup()
  let finish!: () => void
  const writing = session.runWrite(() => new Promise<void>(resolve => { finish = resolve }))
  await Promise.resolve()
  await session.reloadFromWatcher()
  expect(load).not.toHaveBeenCalled()
  write(content('external change'))
  finish()
  await writing
  expect(reload).toHaveBeenLastCalledWith(content('external change'), '/notes/a.md')
})

it('blocks UI writes to a mutating note even when a different note is selected', async () => {
  const { session } = setup()
  session.bind('/notes/b.md')
  await session.mutation(event('prepare'))
  expect(session.isLocked).toBe(false)
  const deleting = vi.fn(async () => {})
  await expect(session.runWrite(deleting, ['/notes/a.md'])).rejects.toThrow('in progress')
  expect(deleting).not.toHaveBeenCalled()
  await session.mutation(event('abort'))
  await session.runWrite(deleting, ['/notes/a.md'])
  expect(deleting).toHaveBeenCalledOnce()
})

it.each(['rename', 'move'] as const)('rebinds %s synchronously and only saves subsequent edits to the new path', async kind => {
  const { session, save, rebind, write } = setup()
  session.schedule('unsaved')
  await session.mutation(event('prepare', kind))
  write(content('unsaved', '/notes/sub/new.md'))
  const committing = session.mutation(event('commit', kind, '/notes/sub/new.md'))
  expect(rebind).toHaveBeenLastCalledWith('/notes/sub/new.md')
  expect(session.schedule('too early')).toBe(false)
  await committing
  session.schedule('after rename')
  await vi.advanceTimersByTimeAsync(5000)
  expect(save.mock.calls).toEqual([
    ['/notes/a.md', 'unsaved'], ['/notes/sub/new.md', 'after rename'],
  ])
})

it('clears a deleted editor and never recreates the old file', async () => {
  const { session, save, reload } = setup()
  session.schedule('last edit')
  await session.mutation(event('prepare', 'delete'))
  await session.mutation(event('commit', 'delete'))
  expect(reload).toHaveBeenLastCalledWith(null, null)
  expect(session.schedule('recreate')).toBe(false)
  await vi.advanceTimersByTimeAsync(5000)
  expect(save).toHaveBeenCalledTimes(1)
})

it('distinguishes self-generated watcher echoes by bytes and defers other notifications during saves', async () => {
  const { session, reload, write } = setup()
  session.schedule('local')
  await session.reloadFromWatcher()
  expect(reload).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1000)
  expect(reload).not.toHaveBeenCalled()
  write(content('external'))
  await session.reloadFromWatcher()
  expect(reload).toHaveBeenLastCalledWith(content('external'), '/notes/a.md')
})

it('does not acknowledge a failed flush, and abort releases the editor without losing its retry snapshot', async () => {
  const { session, save } = setup()
  save.mockRejectedValueOnce(new Error('disk full'))
  session.schedule('keep this')
  await expect(session.mutation(event('prepare'))).rejects.toThrow('disk full')
  expect(session.isLocked).toBe(true)
  await session.mutation(event('abort'))
  expect(session.isLocked).toBe(false)
  await session.flush()
  expect(save).toHaveBeenLastCalledWith('/notes/a.md', 'keep this')
})

it.each([false, true])('never retries an older failed save after a newer save was queued (newer fails: %s)', async newerFails => {
  const { session, save } = setup()
  let fail!: (error: Error) => void
  save.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  if (newerFails) save.mockRejectedValueOnce(new Error('second save failed'))
  session.schedule('A')
  const first = expect(session.flush()).rejects.toThrow('first save failed')
  await vi.advanceTimersByTimeAsync(0)
  session.schedule('B')
  const second = session.flush()
  const checkedSecond = newerFails
    ? expect(second).rejects.toThrow('second save failed')
    : second
  fail(new Error('first save failed'))
  await first
  await checkedSecond
  await session.flush()
  await vi.advanceTimersByTimeAsync(5000)
  expect(save.mock.calls).toEqual([
    ['/notes/a.md', 'A'], ['/notes/a.md', 'B'],
    ...(newerFails ? [['/notes/a.md', 'B']] : []),
  ])
})

it('retains a failed snapshot when the newer queued save belongs to a different note', async () => {
  const { session, save } = setup()
  let fail!: (error: Error) => void
  save.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  session.schedule('A')
  const first = expect(session.flush()).rejects.toThrow('save failed')
  await vi.advanceTimersByTimeAsync(0)
  session.bind('/notes/b.md')
  session.schedule('B')
  const second = session.flush()
  fail(new Error('save failed'))
  await first
  await second
  await session.flush()
  expect(save.mock.calls).toEqual([
    ['/notes/a.md', 'A'], ['/notes/b.md', 'B'], ['/notes/a.md', 'A'],
  ])
})

it('keeps stale content locked if commit reload fails, and allows retry at the new path', async () => {
  const { session, load, reload, write } = setup()
  await session.mutation(event('prepare', 'rename'))
  load.mockRejectedValueOnce(new Error('read failed'))
  await expect(session.mutation(event('commit', 'rename', '/notes/b.md'))).rejects.toThrow('read failed')
  expect(session.schedule('stale')).toBe(false)
  write(content('renamed', '/notes/b.md'))
  await session.retryReconcile()
  expect(load).toHaveBeenLastCalledWith('/notes/b.md')
  expect(reload).toHaveBeenLastCalledWith(content('renamed', '/notes/b.md'), '/notes/b.md')
  expect(session.isLocked).toBe(false)
})

it.each(['update', 'rename'] as const)('retains a failed A %s and its retry after an unrelated B commit', async kind => {
  const { session, load, reload, save, write } = setup()
  const a = (phase: NoteMutation['phase']) => ({ ...event(phase, kind, kind === 'rename' ? '/notes/renamed-a.md' : null), transactionId: 'a' })
  const b = (phase: NoteMutation['phase']) => ({ ...event(phase), transactionId: 'b', paths: ['/notes/b.md'] })
  const path = kind === 'rename' ? '/notes/renamed-a.md' : '/notes/a.md'
  await session.mutation(a('prepare'))
  load.mockRejectedValueOnce(new Error('A load failed'))
  await expect(session.mutation(a('commit'))).rejects.toThrow('A load failed')
  await session.mutation(b('prepare'))
  await session.mutation(b('commit'))
  expect(session.isLocked).toBe(true)
  expect(session.schedule('stale A')).toBe(false)
  await vi.advanceTimersByTimeAsync(5000)
  expect(save).not.toHaveBeenCalled()
  write(content('plugin A', path))
  await session.retryReconcile()
  expect(reload).toHaveBeenLastCalledWith(content('plugin A', path), path)
  expect(session.isLocked).toBe(false)
  expect(session.schedule('plugin A + local edit')).toBe(true)
})

it('keeps independent failures until each note is actually reloaded, including retries while another note is selected', async () => {
  const { session, load, reload, write } = setup()
  const a = (phase: NoteMutation['phase']) => ({ ...event(phase), transactionId: 'a' })
  const b = (phase: NoteMutation['phase']) => ({ ...event(phase), transactionId: 'b', paths: ['/notes/b.md'] })
  await session.mutation(a('prepare'))
  load.mockRejectedValueOnce(new Error('A failed'))
  await expect(session.mutation(a('commit'))).rejects.toThrow('A failed')
  session.bind('/notes/b.md')
  await session.mutation(b('prepare'))
  load.mockRejectedValueOnce(new Error('B failed'))
  await expect(session.mutation(b('commit'))).rejects.toThrow('B failed')
  session.bind('/notes/a.md')
  write(content('plugin A'))
  await session.retryReconcile()
  expect(reload).toHaveBeenLastCalledWith(content('plugin A'), '/notes/a.md')
  expect(session.isPathLocked('/notes/a.md')).toBe(false)
  expect(session.isPathLocked('/notes/b.md')).toBe(true)
  session.bind('/notes/b.md')
  expect(session.schedule('stale B')).toBe(false)
  write(content('plugin B', '/notes/b.md'))
  await session.retryReconcile()
  expect(reload).toHaveBeenLastCalledWith(content('plugin B', '/notes/b.md'), '/notes/b.md')
  expect(session.isLocked).toBe(false)
})

it('releases earlier failures for the same note only after a new transaction loads and reconciles that note', async () => {
  const { session, load, write } = setup()
  await session.mutation(event('prepare'))
  load.mockRejectedValueOnce(new Error('failed'))
  await expect(session.mutation(event('commit'))).rejects.toThrow('failed')
  const next = (phase: NoteMutation['phase']) => ({ ...event(phase, 'rename', '/notes/new-a.md'), transactionId: 'next' })
  await session.mutation(next('prepare'))
  write(content('reconciled A', '/notes/new-a.md'))
  await session.mutation(next('commit'))
  expect(session.isLocked).toBe(false)
  expect(session.isPathLocked('/notes/a.md')).toBe(false)
  const calls = load.mock.calls.length
  await session.retryReconcile()
  expect(load).toHaveBeenCalledTimes(calls)
})

it('does not discard a committed failure when a late abort arrives', async () => {
  const { session, load, reload, write } = setup()
  await session.mutation(event('prepare'))
  load.mockRejectedValueOnce(new Error('failed'))
  await expect(session.mutation(event('commit'))).rejects.toThrow('failed')
  await session.mutation(event('abort'))
  expect(session.schedule('stale')).toBe(false)
  write(content('recovered'))
  await session.retryReconcile()
  expect(reload).toHaveBeenLastCalledWith(content('recovered'), '/notes/a.md')
  expect(session.isLocked).toBe(false)
})

it('continues retrying independent notes when an earlier reconciliation still fails', async () => {
  const { session, load, structure, write } = setup()
  const a = (phase: NoteMutation['phase']) => ({ ...event(phase), transactionId: 'a' })
  const b = (phase: NoteMutation['phase']) => ({ ...event(phase), transactionId: 'b', paths: ['/notes/b.md'] })
  await session.mutation(a('prepare'))
  load.mockRejectedValueOnce(new Error('A failed'))
  await expect(session.mutation(a('commit'))).rejects.toThrow('A failed')
  session.bind('/notes/b.md')
  await session.mutation(b('prepare'))
  load.mockRejectedValueOnce(new Error('B failed'))
  await expect(session.mutation(b('commit'))).rejects.toThrow('B failed')
  structure.mockRejectedValueOnce(new Error('A metadata failed'))
  write(content('plugin B', '/notes/b.md'))
  await expect(session.retryReconcile()).rejects.toThrow('A metadata failed')
  expect(session.isPathLocked('/notes/a.md')).toBe(true)
  expect(session.isPathLocked('/notes/b.md')).toBe(false)
  session.bind('/notes/a.md')
  write(content('plugin A'))
  await session.retryReconcile()
  expect(session.isLocked).toBe(false)
})

it('recovers the same note through multiple failed renames after its final path is successfully synchronized', async () => {
  const { session, load, structure, write } = setup()
  await session.mutation(event('prepare'))
  load.mockRejectedValueOnce(new Error('initial update failed'))
  await expect(session.mutation(event('commit'))).rejects.toThrow('initial update failed')
  for (const [from, to, id] of [['/notes/a.md', '/notes/b.md', 'ab'], ['/notes/b.md', '/notes/c.md', 'bc']] as const) {
    const rename = (phase: NoteMutation['phase']) => ({ ...event(phase, 'rename', to), transactionId: id, paths: [from] })
    await session.mutation(rename('prepare'))
    load.mockRejectedValueOnce(new Error('rename load failed'))
    await expect(session.mutation(rename('commit'))).rejects.toThrow('rename load failed')
  }
  write(content('latest body', '/notes/c.md'))
  structure.mockRejectedValueOnce(new Error('metadata failed'))
    .mockRejectedValueOnce(new Error('metadata failed'))
    .mockRejectedValueOnce(new Error('metadata failed'))
  await expect(session.retryReconcile()).rejects.toThrow('metadata failed')
  expect(session.isLocked).toBe(true)
  await session.retryReconcile()
  for (const path of ['/notes/a.md', '/notes/b.md', '/notes/c.md']) expect(session.isPathLocked(path)).toBe(false)
  const calls = load.mock.calls.length
  await session.retryReconcile()
  expect(load).toHaveBeenCalledTimes(calls)
})

it('does not apply a late commit or watcher read to a different selected note', async () => {
  const { session, reload, load, structure } = setup()
  let finish!: (value: NoteContent) => void
  load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const reading = session.reloadFromWatcher()
  await session.mutation(event('prepare'))
  session.bind('/other/b.md')
  finish(content('stale'))
  await reading
  await session.mutation(event('commit'))
  expect(reload).not.toHaveBeenCalled()
  expect(structure).toHaveBeenCalled()
  expect(session.isLocked).toBe(false)
})

it('invalidates an older read when a newly opened window receives commit without prepare', async () => {
  const { session, load, reload, write } = setup()
  let finish!: (value: NoteContent) => void
  load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const reading = session.reloadFromWatcher()
  write(content('plugin result'))
  await session.mutation(event('commit'))
  finish(content('old read'))
  await reading
  expect(reload).toHaveBeenCalledTimes(1)
  expect(reload).toHaveBeenLastCalledWith(content('plugin result'), '/notes/a.md')
})

it.each(['update', 'rename', 'move', 'delete'] as const)('synchronizes an editor opened through a nested link for %s', async kind => {
  const { session, save, reload, rebind, write } = setup()
  const alias = '/notes/sub-alias/a.md'
  const canonical = '/notes/sub/a.md'
  session.bind(alias)
  const newPath = kind === 'rename' || kind === 'move' ? '/notes/sub/new.md' : null
  const mutation = (phase: NoteMutation['phase']) => ({
    ...event(phase, kind, newPath), paths: [canonical, alias],
  })
  session.schedule('local edit')
  await session.mutation(mutation('prepare'))
  expect(save).toHaveBeenLastCalledWith(alias, 'local edit')
  expect(session.isLocked).toBe(true)
  expect(session.schedule('stale edit')).toBe(false)
  const destination = kind === 'delete' ? null : newPath ?? alias
  write(content('plugin change', destination ?? alias))
  await session.mutation(mutation('commit'))
  expect(rebind).toHaveBeenLastCalledWith(destination)
  expect(reload).toHaveBeenLastCalledWith(
    destination ? content('plugin change', destination) : null, destination
  )
  await vi.advanceTimersByTimeAsync(5000)
  expect(save).toHaveBeenCalledTimes(1)
  expect(session.isLocked).toBe(false)
})

it('recognizes Windows path aliases without conflating case-sensitive Unix paths', () => {
  expect(sameNotePath('C:\\Notes\\A.md', '//?/C:/notes/a.md')).toBe(true)
  expect(sameNotePath('\\\\?\\UNC\\server\\share\\A.md', '//server/share/a.md')).toBe(true)
  expect(sameNotePath('/notes/A.md', '/notes/a.md')).toBe(false)
})
