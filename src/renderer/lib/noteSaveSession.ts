import type { NoteContent } from '@/shared/types'
import type { NoteMutation } from '@/shared/noteMutation'

export function sameNotePath(a: string, b: string): boolean {
  const normalize = (path: string) => {
    const value = path
      .replace(/\\/g, '/')
      .replace(/^\/\/\?\/UNC\//i, '//')
      .replace(/^\/\/\?\//, '')
    return /^[a-z]:\//i.test(value) || value.startsWith('//')
      ? value.toLowerCase()
      : value
  }
  return normalize(a) === normalize(b)
}

interface SessionOptions {
  save(path: string, body: string): Promise<string | undefined>
  load(path: string): Promise<NoteContent | null>
  reload(content: NoteContent | null, path: string | null): void
  rebind(path: string | null): void
  structure(event: NoteMutation): Promise<void>
  saving(value: boolean): void
  locked(value: boolean): void
  error(error: unknown): void
}

/** Owns debounce snapshots and serializes writes, even across note switches. */
export class NoteSaveSession {
  private path: string | null = null
  private pending: { path: string; body: string } | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private writes: Promise<void> = Promise.resolve()
  private activeWrites = 0
  private readonly locks = new Map<string, NoteMutation>()
  private pendingReconcile: NoteMutation | null = null
  private watcherPending = false
  private generation = 0
  private readonly knownContents = new Map<string, string>()

  constructor(private readonly options: SessionOptions) {}

  bind(path: string | null): void {
    if (path === this.path) return
    if (this.path) this.knownContents.delete(this.path)
    this.path = path
    this.generation++
    this.options.locked(this.isLocked)
  }

  get isLocked(): boolean {
    return this.path !== null && this.isPathLocked(this.path)
  }

  isPathLocked(currentPath: string): boolean {
    return [...this.locks.values()].some(event =>
      [...event.paths, ...(event.newPath ? [event.newPath] : [])].some(path =>
        sameNotePath(path, currentPath)
      )
    )
  }

  get version(): number {
    return this.generation
  }

  schedule(body: string): boolean {
    if (!this.path || this.isLocked) return false
    if (this.pending && this.pending.path !== this.path) {
      void this.flush().catch(() => {})
    }
    this.pending = { path: this.path, body }
    this.generation++
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush().catch(() => {})
    }, 1000)
    return true
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer)
    this.timer = undefined
    const pending = this.pending
    this.pending = null
    if (pending) {
      this.activeWrites++
      this.options.saving(true)
      const write = this.writes
        .catch(() => {})
        .then(async () => {
          const raw = await this.options.save(pending.path, pending.body)
          if (raw !== undefined) this.knownContents.set(pending.path, raw)
        })
      this.writes = write
      try {
        await write
      } catch (error) {
        // Keep the failed snapshot available for retry/prepare, rather than
        // acknowledging a plugin mutation after an unsuccessful local save.
        this.pending ??= pending
        this.options.error(error)
        throw error
      } finally {
        this.activeWrites--
        if (this.activeWrites === 0) this.options.saving(false)
      }
    } else {
      await this.writes
    }
    if (this.watcherPending && !this.pending && !this.isLocked) {
      await this.reloadFromWatcher()
    }
  }

  /** Metadata and UI structural operations must also drain before prepare. */
  async runWrite<T>(
    operation: () => Promise<T>,
    targets = this.path ? [this.path] : []
  ): Promise<T> {
    if (
      (targets.length === 0 && this.locks.size > 0) ||
      targets.some(path => this.isPathLocked(path))
    )
      throw new Error('A plugin note operation is in progress')
    this.activeWrites++
    this.options.saving(true)
    const result = this.writes
      .catch(() => {})
      .then(operation)
      .finally(() => {
        this.activeWrites--
        if (this.activeWrites === 0) this.options.saving(false)
      })
    this.writes = result.then(() => {})
    void this.writes.catch(() => {})
    const value = await result
    if (this.watcherPending && !this.pending && !this.isLocked)
      await this.reloadFromWatcher()
    return value
  }

  async reloadFromWatcher(): Promise<void> {
    this.watcherPending = true
    if (this.pending || this.activeWrites > 0 || this.isLocked || !this.path)
      return
    const path = this.path
    const generation = this.generation
    try {
      const content = await this.options.load(path)
      if (this.path !== path || generation !== this.generation || this.isLocked)
        return
      this.watcherPending = false
      if (content && this.knownContents.get(path) === content.rawContent) return
      this.options.reload(content, path)
    } catch (error) {
      this.options.error(error)
    }
  }

  async mutation(event: NoteMutation): Promise<void> {
    if (event.phase === 'abort') {
      this.unlock(event.transactionId)
      return
    }
    const currentPath = this.path
    const affected =
      currentPath !== null &&
      (event.paths.some(path => sameNotePath(path, currentPath)) ||
        (this.locks.has(event.transactionId) &&
          event.newPath !== null &&
          sameNotePath(event.newPath, currentPath)))
    if (event.phase === 'prepare') {
      this.locks.set(event.transactionId, event)
      if (affected) {
        this.generation++
        this.options.locked(true)
      }
      await this.flush()
      return
    }
    const previousReconcile = this.pendingReconcile
    this.pendingReconcile = event
    if (affected) {
      this.generation++
      this.locks.set(event.transactionId, event)
      this.options.locked(true)
      clearTimeout(this.timer)
      this.pending = null
      // Change the destination synchronously, before the first read/scan. A
      // React render or a delayed timer must never save back to the old path.
      const path = event.kind === 'delete' ? null : (event.newPath ?? this.path)
      this.bind(path)
      this.options.rebind(path)
      const generation = this.generation
      const content = path ? await this.options.load(path) : null
      if (this.path === path && generation === this.generation) {
        this.options.reload(content, path)
        if (content && path) this.knownContents.set(path, content.rawContent)
      }
      this.watcherPending = false
    }
    await this.options.structure(event)
    if (this.pendingReconcile === event) this.pendingReconcile = null
    if (
      previousReconcile &&
      previousReconcile.transactionId !== event.transactionId
    )
      this.unlock(previousReconcile.transactionId)
    this.unlock(event.transactionId)
  }

  async retryReconcile(): Promise<void> {
    if (this.pendingReconcile) await this.mutation(this.pendingReconcile)
  }

  private unlock(transactionId: string): void {
    this.locks.delete(transactionId)
    this.options.locked(this.isLocked)
  }
}
