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

interface PendingReconcile {
  event: NoteMutation
  needsReload: boolean
}

/** Owns debounce snapshots and serializes writes, even across note switches. */
export class NoteSaveSession {
  private path: string | null = null
  private pending: { path: string; body: string } | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private writes: Promise<void> = Promise.resolve()
  private activeWrites = 0
  private readonly locks = new Map<string, NoteMutation>()
  private readonly pendingReconciles = new Map<string, PendingReconcile>()
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
      // An abort can release prepare, but cannot undo a committed write whose
      // editor reconciliation still needs to succeed.
      if (!this.pendingReconciles.has(event.transactionId))
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
    const previousReconciles = [...this.pendingReconciles]
    const pending = this.pendingReconciles.get(event.transactionId) ?? {
      event,
      needsReload: affected,
    }
    this.pendingReconciles.set(event.transactionId, pending)
    const reloadedPaths: string[] = []
    if (affected) {
      pending.needsReload = true
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
        pending.needsReload = false
        reloadedPaths.push(...event.paths)
        if (currentPath) reloadedPaths.push(currentPath)
        if (path) reloadedPaths.push(path)
      }
      this.watcherPending = false
    }
    await this.options.structure(event)
    if (
      !pending.needsReload &&
      this.pendingReconciles.get(event.transactionId) === pending
    ) {
      this.pendingReconciles.delete(event.transactionId)
      this.unlock(event.transactionId)
    }
    // A fresh load can recover earlier failures of this same note (including
    // rename/move), but must never release an unrelated note's protection.
    let remaining = previousReconciles
    while (remaining.length > 0 && reloadedPaths.length > 0) {
      const unresolved: typeof remaining = []
      let recovered = false
      for (const [id, previous] of remaining) {
        const paths = [
          ...previous.event.paths,
          ...(previous.event.newPath ? [previous.event.newPath] : []),
        ]
        if (
          this.pendingReconciles.get(id) === previous &&
          paths.some(path =>
            reloadedPaths.some(reloaded => sameNotePath(path, reloaded))
          )
        ) {
          this.pendingReconciles.delete(id)
          this.unlock(id)
          reloadedPaths.push(...paths)
          recovered = true
        } else if (this.pendingReconciles.get(id) === previous) {
          unresolved.push([id, previous])
        }
      }
      if (!recovered) break
      remaining = unresolved
    }
  }

  async retryReconcile(): Promise<void> {
    const errors: Array<{
      id: string
      pending: PendingReconcile
      error: unknown
    }> = []
    for (const [id, pending] of [...this.pendingReconciles]) {
      if (this.pendingReconciles.get(id) !== pending) continue
      try {
        await this.mutation(pending.event)
      } catch (error) {
        errors.push({ id, pending, error })
      }
    }
    const failed = errors.find(
      ({ id, pending }) => this.pendingReconciles.get(id) === pending
    )
    if (failed) throw failed.error
  }

  private unlock(transactionId: string): void {
    this.locks.delete(transactionId)
    this.options.locked(this.isLocked)
  }
}
