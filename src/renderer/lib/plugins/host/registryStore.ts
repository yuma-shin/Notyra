/**
 * 各レジストリ（Style、SidePanel、Markdown、Editor、Command、Toolbar、Keymap など）が
 * 共通で使う外部ストア。React からは `useSyncExternalStore(store.subscribe, store.getSnapshot)`
 * で購読する。
 *
 * - 登録は pluginId ごとの Map で保持し、`register` が返す Disposable は冪等
 * - スナップショットは Load_Order 順（同じ Plugin 内は登録順）。Load_Order にない Plugin は
 *   末尾に、最初に登録した順で並べる
 * - スナップショットは内容が変わらない限り同一参照を返す（`useSyncExternalStore` の要件）
 */
import type { Disposable } from '@/shared/plugin/api'

export interface RegistryEntry<T> {
  readonly pluginId: string
  readonly item: T
}

type Listener = () => void

interface PluginBucket<T> {
  /** 最初に登録した順序（Load_Order にない Plugin の並び順に使う） */
  readonly firstSeq: number
  readonly entries: RegistryEntry<T>[]
}

const EMPTY: readonly never[] = Object.freeze([])

export class RegistryStore<T> {
  private readonly buckets = new Map<string, PluginBucket<T>>()
  private readonly listeners = new Set<Listener>()
  private loadOrderIndex = new Map<string, number>()
  private seq = 0
  private snapshot: readonly RegistryEntry<T>[] = EMPTY
  private items: readonly T[] = EMPTY

  /**
   * 項目を登録し、解除用の Disposable を返す。
   * 解除は冪等で、2回目以降の dispose() は何もしない。
   */
  register = (pluginId: string, item: T): Disposable => {
    let bucket = this.buckets.get(pluginId)
    if (!bucket) {
      bucket = { firstSeq: this.seq++, entries: [] }
      this.buckets.set(pluginId, bucket)
    }
    const entry: RegistryEntry<T> = Object.freeze({ pluginId, item })
    bucket.entries.push(entry)
    this.commit()

    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        this.remove(entry)
      },
    }
  }

  /** 変更通知を購読する。戻り値の関数で購読を解除する */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Load_Order 順の登録一覧。変更がない限り同一参照を返す */
  getSnapshot = (): readonly RegistryEntry<T>[] => this.snapshot

  /** `getSnapshot()` の項目だけの一覧。変更がない限り同一参照を返す */
  getItems = (): readonly T[] => this.items

  /** 指定 Plugin の登録一覧（登録順） */
  getByPlugin = (pluginId: string): readonly RegistryEntry<T>[] =>
    this.buckets.get(pluginId)?.entries.slice() ?? EMPTY

  /**
   * Load_Order（Plugin_ID の列）を設定する。PluginHost が reconcile のたびに渡す。
   * 並び順が変わった場合のみスナップショットを更新して通知する。
   */
  setLoadOrder = (pluginIds: readonly string[]): void => {
    const next = new Map<string, number>()
    for (const [index, id] of pluginIds.entries()) {
      if (!next.has(id)) next.set(id, index)
    }
    this.loadOrderIndex = next
    this.commit()
  }

  private remove(entry: RegistryEntry<T>): void {
    const bucket = this.buckets.get(entry.pluginId)
    if (!bucket) return
    const index = bucket.entries.indexOf(entry)
    if (index === -1) return
    bucket.entries.splice(index, 1)
    if (bucket.entries.length === 0) this.buckets.delete(entry.pluginId)
    this.commit()
  }

  /** スナップショットを再計算し、内容が変わった場合のみ差し替えて通知する */
  private commit(): void {
    const next = this.computeSnapshot()
    if (shallowEqual(next, this.snapshot)) return
    this.snapshot = next.length === 0 ? EMPTY : Object.freeze(next)
    this.items =
      next.length === 0 ? EMPTY : Object.freeze(next.map(e => e.item))
    this.notify()
  }

  private computeSnapshot(): RegistryEntry<T>[] {
    const order = this.loadOrderIndex
    const plugins = [...this.buckets.entries()].sort(([idA, a], [idB, b]) => {
      const oa = order.get(idA) ?? Number.POSITIVE_INFINITY
      const ob = order.get(idB) ?? Number.POSITIVE_INFINITY
      if (oa !== ob) return oa < ob ? -1 : 1
      return a.firstSeq - b.firstSeq
    })
    return plugins.flatMap(([, bucket]) => bucket.entries)
  }

  private notify(): void {
    // 通知中の購読・解除の影響を受けないよう、複製してから呼び出す
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        console.error(error)
      }
    }
  }
}

function shallowEqual<E>(a: readonly E[], b: readonly E[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
