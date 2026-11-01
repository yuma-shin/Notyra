/**
 * Plugin の remark / rehype プラグイン（Requirement 14.1、14.4、14.7、14.8）。
 *
 * - スナップショットは remark と rehype の Load_Order 順の登録一覧で、登録・解除で変わる
 *   （プレビューの再描画の契機。Requirement 14.7）
 * - 例外を出した Plugin は `exclude` でセッション中除外する。除外はスナップショットに
 *   含めず、参照も変えない（例外を理由に即時再生成しない。Requirement 14.9）。
 *   除外は `getActivePlugins` が処理のたびに反映する
 */
import type { Disposable, MarkdownPluggable } from '@/shared/plugin/api'
import { type RegistryEntry, RegistryStore } from '../registryStore'

export type MarkdownPluginKind = 'remark' | 'rehype'

export interface MarkdownExtensionSnapshot {
  readonly remark: readonly RegistryEntry<MarkdownPluggable>[]
  readonly rehype: readonly RegistryEntry<MarkdownPluggable>[]
}

export interface ActiveMarkdownPlugin {
  readonly pluginId: string
  readonly plugin: MarkdownPluggable
}

type Listener = () => void

export class MarkdownExtensionRegistry {
  readonly remarkStore = new RegistryStore<MarkdownPluggable>()
  readonly rehypeStore = new RegistryStore<MarkdownPluggable>()

  private readonly excluded = new Set<string>()
  private snapshot: MarkdownExtensionSnapshot = Object.freeze({
    remark: this.remarkStore.getSnapshot(),
    rehype: this.rehypeStore.getSnapshot(),
  })

  register(
    pluginId: string,
    kind: MarkdownPluginKind,
    plugin: MarkdownPluggable
  ): Disposable {
    return this.storeOf(kind).register(pluginId, plugin)
  }

  registerRemark(pluginId: string, plugin: MarkdownPluggable): Disposable {
    return this.register(pluginId, 'remark', plugin)
  }

  registerRehype(pluginId: string, plugin: MarkdownPluggable): Disposable {
    return this.register(pluginId, 'rehype', plugin)
  }

  subscribe = (listener: Listener): (() => void) => {
    const unsubscribeRemark = this.remarkStore.subscribe(listener)
    const unsubscribeRehype = this.rehypeStore.subscribe(listener)
    return () => {
      unsubscribeRemark()
      unsubscribeRehype()
    }
  }

  /** 登録一覧（除外を含まない）。登録が変わらない限り同一参照を返す */
  getSnapshot = (): MarkdownExtensionSnapshot => {
    const remark = this.remarkStore.getSnapshot()
    const rehype = this.rehypeStore.getSnapshot()
    if (remark !== this.snapshot.remark || rehype !== this.snapshot.rehype) {
      this.snapshot = Object.freeze({ remark, rehype })
    }
    return this.snapshot
  }

  setLoadOrder(pluginIds: readonly string[]): void {
    this.remarkStore.setLoadOrder(pluginIds)
    this.rehypeStore.setLoadOrder(pluginIds)
  }

  /**
   * 例外を出した Plugin を起動中のセッションの残りの期間除外する。
   * スナップショットは変えず、購読者にも通知しない。
   */
  exclude(pluginId: string): void {
    this.excluded.add(pluginId)
  }

  isExcluded(pluginId: string): boolean {
    return this.excluded.has(pluginId)
  }

  /** 処理に使う、除外した Plugin を除いた登録一覧（Load_Order 順） */
  getActivePlugins(kind: MarkdownPluginKind): ActiveMarkdownPlugin[] {
    return this.storeOf(kind)
      .getSnapshot()
      .filter(e => !this.excluded.has(e.pluginId))
      .map(e => ({ pluginId: e.pluginId, plugin: e.item }))
  }

  private storeOf(kind: MarkdownPluginKind): RegistryStore<MarkdownPluggable> {
    return kind === 'remark' ? this.remarkStore : this.rehypeStore
  }
}
