import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveNoteEvent } from '@/shared/plugin/api'
import {
  ACTIVE_NOTE_CHANGE_DEBOUNCE_MS,
  ActiveNotePublisher,
} from '@/renderer/lib/plugins/host/activeNotePublisher'
import { ActiveNoteBus } from '@/renderer/lib/plugins/host/registries/activeNoteBus'

const A = { path: '/root/a.md', title: 'A', rootFolder: '/root' }
const B = { path: '/root/b.md', title: 'B', rootFolder: '/root' }

function setup() {
  const bus = new ActiveNoteBus()
  const events: ActiveNoteEvent[] = []
  bus.subscribe('p', e => events.push(e))
  const publisher = new ActiveNotePublisher({
    windowKind: 'main',
    publish: e => bus.publish(e),
  })
  return { publisher, events }
}

describe('ActiveNotePublisher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not publish while nothing is selected initially', () => {
    const { publisher, events } = setup()
    publisher.update({ note: null, body: '', bodyPath: null })
    expect(events).toEqual([])
  })

  it('publishes switched once, after the body of the new note is loaded', () => {
    const { publisher, events } = setup()
    // ノートは選択済みだが本文は未読み込み
    publisher.update({ note: A, body: '', bodyPath: null })
    expect(events).toEqual([])

    publisher.update({ note: A, body: 'a body', bodyPath: A.path })
    publisher.update({ note: A, body: 'a body', bodyPath: A.path })
    vi.advanceTimersByTime(ACTIVE_NOTE_CHANGE_DEBOUNCE_MS * 2)

    expect(events).toEqual([
      {
        type: 'switched',
        note: { ...A, body: 'a body' },
        windowKind: 'main',
      },
    ])
  })

  it('does not publish the previous body as the new note while loading', () => {
    const { publisher, events } = setup()
    publisher.update({ note: A, body: 'a body', bodyPath: A.path })
    // B を選択した直後（本文はまだ A のもの）
    publisher.update({ note: B, body: 'a body', bodyPath: A.path })
    expect(events).toHaveLength(1)

    publisher.update({ note: B, body: 'b body', bodyPath: B.path })
    expect(events.at(-1)).toEqual({
      type: 'switched',
      note: { ...B, body: 'b body' },
      windowKind: 'main',
    })
    vi.advanceTimersByTime(ACTIVE_NOTE_CHANGE_DEBOUNCE_MS * 2)
    expect(events).toHaveLength(2)
  })

  it('debounces changed and delivers only the latest body', () => {
    const { publisher, events } = setup()
    publisher.update({ note: A, body: 'a', bodyPath: A.path })
    publisher.update({ note: A, body: 'ab', bodyPath: A.path })
    publisher.update({ note: A, body: 'abc', bodyPath: A.path })
    expect(events).toHaveLength(1)

    vi.advanceTimersByTime(ACTIVE_NOTE_CHANGE_DEBOUNCE_MS)
    expect(events).toHaveLength(2)
    expect(events[1]).toEqual({
      type: 'changed',
      note: { ...A, body: 'abc' },
      windowKind: 'main',
    })
  })

  it('flushes a pending changed of the previous note before switching', () => {
    const { publisher, events } = setup()
    publisher.update({ note: A, body: 'a', bodyPath: A.path })
    publisher.update({ note: A, body: 'a edited', bodyPath: A.path })
    publisher.update({ note: B, body: 'a edited', bodyPath: A.path })

    expect(events.map(e => [e.type, e.note?.path, e.note?.body])).toEqual([
      ['switched', A.path, 'a'],
      ['changed', A.path, 'a edited'],
    ])

    publisher.update({ note: B, body: 'b', bodyPath: B.path })
    vi.advanceTimersByTime(ACTIVE_NOTE_CHANGE_DEBOUNCE_MS * 2)
    expect(events.map(e => [e.type, e.note?.path, e.note?.body])).toEqual([
      ['switched', A.path, 'a'],
      ['changed', A.path, 'a edited'],
      ['switched', B.path, 'b'],
    ])
  })

  it('publishes switched with null when the note is deselected', () => {
    const { publisher, events } = setup()
    publisher.update({ note: A, body: 'a', bodyPath: A.path })
    publisher.update({ note: null, body: '', bodyPath: null })
    publisher.update({ note: null, body: '', bodyPath: null })

    expect(events.at(-1)).toEqual({
      type: 'switched',
      note: null,
      windowKind: 'main',
    })
    expect(events).toHaveLength(2)
  })

  it('flushes on dispose and ignores later updates', () => {
    const { publisher, events } = setup()
    publisher.update({ note: A, body: 'a', bodyPath: A.path })
    publisher.update({ note: A, body: 'ab', bodyPath: A.path })
    publisher.dispose()
    expect(events.at(-1)?.type).toBe('changed')

    publisher.update({ note: B, body: 'b', bodyPath: B.path })
    vi.advanceTimersByTime(ACTIVE_NOTE_CHANGE_DEBOUNCE_MS * 2)
    expect(events).toHaveLength(2)
  })
})
