import { act, renderHook } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { RegistryStore } from '@/renderer/lib/plugins/host/registryStore'

const items = <T>(store: RegistryStore<T>) =>
  store.getSnapshot().map(e => [e.pluginId, e.item])

describe('RegistryStore', () => {
  it('orders entries by Load_Order, then registration order within a plugin', () => {
    const store = new RegistryStore<string>()
    store.register('b', 'b1')
    store.register('a', 'a1')
    store.register('b', 'b2')
    store.register('c', 'c1')
    store.setLoadOrder(['a', 'b'])

    expect(items(store)).toEqual([
      ['a', 'a1'],
      ['b', 'b1'],
      ['b', 'b2'],
      ['c', 'c1'], // Load_Order にない Plugin は末尾
    ])
    expect(store.getItems()).toEqual(['a1', 'b1', 'b2', 'c1'])
  })

  it('returns the same snapshot reference while nothing changes', () => {
    const store = new RegistryStore<string>()
    store.register('a', 'a1')
    store.setLoadOrder(['a'])
    const snapshot = store.getSnapshot()
    const itemList = store.getItems()

    store.setLoadOrder(['a', 'unknown'])
    expect(store.getSnapshot()).toBe(snapshot)
    expect(store.getItems()).toBe(itemList)
  })

  it('dispose is idempotent and restores the previous snapshot contents', () => {
    const store = new RegistryStore<string>()
    store.register('other', 'o1')
    const before = store.getSnapshot()

    const d1 = store.register('p', 'p1')
    const d2 = store.register('p', 'p2')
    d2.dispose()
    d1.dispose()
    d1.dispose()

    expect(store.getSnapshot()).toEqual(before)
    expect(store.getByPlugin('p')).toEqual([])
  })

  it('removes only the disposed entry when the same item is registered twice', () => {
    const store = new RegistryStore<string>()
    const d1 = store.register('p', 'x')
    store.register('p', 'x')
    d1.dispose()
    d1.dispose()
    expect(store.getItems()).toEqual(['x'])
  })

  it('notifies subscribers only on change and stops after unsubscribe', () => {
    const store = new RegistryStore<string>()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    const d = store.register('p', 'p1')
    expect(listener).toHaveBeenCalledTimes(1)
    store.setLoadOrder(['p'])
    expect(listener).toHaveBeenCalledTimes(1)
    d.dispose()
    expect(listener).toHaveBeenCalledTimes(2)
    d.dispose()
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    store.register('p', 'p2')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('works with useSyncExternalStore', () => {
    const store = new RegistryStore<string>()
    const { result } = renderHook(() =>
      useSyncExternalStore(store.subscribe, store.getItems)
    )
    expect(result.current).toEqual([])

    let d = { dispose: () => {} }
    act(() => {
      d = store.register('p', 'p1')
    })
    expect(result.current).toEqual(['p1'])

    act(() => d.dispose())
    expect(result.current).toEqual([])
  })
})
