/**
 * アクティブなノートの状態から Active_Note_Event を発行する（Requirement 13.11、13.14）。
 *
 * - `switched`: アクティブなノートが変わり、そのノートの本文が読み込まれたときに1回だけ発行する。
 *   ノート未選択への切り替えは `note: null` で発行する
 * - `changed`: 同じノートの本文が変わったときに、短いデバウンスを挟んで発行する
 *   （入力のたびに Plugin のリスナーを同期実行しないため）
 * - 保留中の `changed` は、ノートの切り替え・破棄の前に即時発行する。保留中のイベントは
 *   予約時点のノート情報を保持するため、別ノートの本文として届くことはない
 * - 本文の読み込み前（`bodyPath` が選択中のノートと一致しない間）は発行しない。
 *   切り替え直後に前のノートの本文で `switched` を出したり、読み込み完了時に
 *   `changed` を二重発行したりしないため
 */
import type { ActiveNote, ActiveNoteEvent } from '@/shared/plugin/api'

/** 本文の変更通知（`changed`）のデバウンス時間 */
export const ACTIVE_NOTE_CHANGE_DEBOUNCE_MS = 200

export interface ActiveNoteSnapshot {
  /** アクティブなノート（本文を除く）。未選択なら null */
  note: Omit<ActiveNote, 'body'> | null
  /** 現在の本文 */
  body: string
  /** `body` がどのノートの本文か。読み込み前は前のノートのパスや null になる */
  bodyPath: string | null
}

export interface ActiveNotePublisherOptions {
  windowKind: ActiveNoteEvent['windowKind']
  publish(event: ActiveNoteEvent): void
  debounceMs?: number
}

/** 未発行（初期状態）を表す */
const NOTHING_PUBLISHED: unique symbol = Symbol('nothingPublished')

export class ActiveNotePublisher {
  private readonly windowKind: ActiveNoteEvent['windowKind']
  private readonly publishEvent: (event: ActiveNoteEvent) => void
  private readonly debounceMs: number

  /** 最後に `switched` を発行したノートのパス（null はノート未選択） */
  private currentPath: string | null | typeof NOTHING_PUBLISHED =
    NOTHING_PUBLISHED
  private lastBody = ''
  private pending: ActiveNoteEvent | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(options: ActiveNotePublisherOptions) {
    this.windowKind = options.windowKind
    this.publishEvent = options.publish
    this.debounceMs = options.debounceMs ?? ACTIVE_NOTE_CHANGE_DEBOUNCE_MS
  }

  /** 最新の状態を渡す。必要に応じて `switched` / `changed` を発行する */
  update(snapshot: ActiveNoteSnapshot): void {
    if (this.disposed) return
    const { note, body, bodyPath } = snapshot

    if (note === null) {
      // 初期状態でノート未選択なら何も発行しない
      if (this.currentPath === NOTHING_PUBLISHED || this.currentPath === null)
        return
      this.flush()
      this.currentPath = null
      this.lastBody = ''
      this.emit({ type: 'switched', note: null, windowKind: this.windowKind })
      return
    }

    if (note.path !== this.currentPath) {
      // 前のノートの保留中の変更は、前のノートの情報のまま先に届ける
      this.flush()
      // 本文の読み込みが終わるまで待つ
      if (bodyPath !== note.path) return
      this.currentPath = note.path
      this.lastBody = body
      this.emit({
        type: 'switched',
        note: { ...note, body },
        windowKind: this.windowKind,
      })
      return
    }

    // 同じノート。本文が変わったときだけ `changed` を予約する
    if (bodyPath !== note.path || body === this.lastBody) return
    this.lastBody = body
    this.schedule({
      type: 'changed',
      note: { ...note, body },
      windowKind: this.windowKind,
    })
  }

  /** 保留中の `changed` があれば即時に発行する */
  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    const event = this.pending
    this.pending = null
    if (event) this.emit(event)
  }

  /** 保留中の `changed` を発行してから停止する。以後の `update` は無視する */
  dispose(): void {
    if (this.disposed) return
    this.flush()
    this.disposed = true
  }

  private schedule(event: ActiveNoteEvent): void {
    this.pending = event
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, this.debounceMs)
  }

  private emit(event: ActiveNoteEvent): void {
    try {
      this.publishEvent(event)
    } catch (error) {
      // ActiveNoteBus はリスナーごとに例外を捕捉するが、念のため本体の動作を守る
      console.error(error)
    }
  }
}
