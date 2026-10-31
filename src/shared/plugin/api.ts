// Plugin_API type definitions (canonical source of `@notyra/plugin-api`)

import type { Extension } from '@codemirror/state'
import type { MarkdownNoteMeta } from '../types'
import type { PluginBackendErrorKind, SettingValue } from './types'

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

export interface Disposable {
  dispose(): void
}

/**
 * Notyra 本体と同一インスタンスの共有モジュール。
 * 仮想モジュール `/@shared/<module>.js` と同じオブジェクトを指す。
 */
export interface SharedModules {
  readonly react: typeof import('react')
  readonly 'react-dom': typeof import('react-dom')
  readonly 'react-dom/client': typeof import('react-dom/client')
  readonly 'react/jsx-runtime': typeof import('react/jsx-runtime')
  readonly '@codemirror/state': typeof import('@codemirror/state')
  readonly '@codemirror/view': typeof import('@codemirror/view')
  readonly '@codemirror/language': typeof import('@codemirror/language')
  readonly '@codemirror/commands': typeof import('@codemirror/commands')
  readonly '@lezer/highlight': typeof import('@lezer/highlight')
}

/**
 * unified の Plugin と構造的に互換な型（`unified` を直接依存に持たないため）。
 * メソッド記法により引数は双変となり、任意のオプション型を持つ
 * remark / rehype プラグインを受け付ける。
 */
export type MarkdownPluginAttacher = {
  bivarianceHack(...parameters: unknown[]): unknown
}['bivarianceHack']

/** unified の Pluggable（Plugin 単体、または `[plugin, ...options]`）と互換 */
export type MarkdownPluggable =
  | MarkdownPluginAttacher
  | [MarkdownPluginAttacher, ...unknown[]]

// ---------------------------------------------------------------------------
// 拡張ポイントの入力
// ---------------------------------------------------------------------------

export interface SidePanelViewDefinition {
  /** 実 ID は `${pluginId}:${id}` */
  id: string
  title: string
  /** SVG 文字列 */
  icon: string
  /** 戻り値の関数は非表示時（破棄時）に呼ばれる */
  // biome-ignore lint/suspicious/noConfusingVoidType: render may return nothing or a cleanup function (design decision #20)
  render(container: HTMLElement): void | (() => void)
}

export interface CommandDefinition {
  /** 実 ID は `${pluginId}:${id}` */
  id: string
  title: string
  run(): unknown | Promise<unknown>
}

export interface ToolbarButtonDefinition {
  /** 実行する Plugin_Command の ID */
  command: string
  /** SVG 文字列 */
  icon: string
  tooltip: string
}

export interface KeybindingDefinition {
  /** CodeMirror と同じ記法（例: `Mod-Shift-k`） */
  key: string
  command: string
}

// ---------------------------------------------------------------------------
// イベント
// ---------------------------------------------------------------------------

export interface ActiveNote {
  path: string
  title: string
  rootFolder: string
  body: string
}

export interface ActiveNoteEvent {
  type: 'switched' | 'changed'
  note: ActiveNote | null
  windowKind: 'main' | 'note'
}

// ---------------------------------------------------------------------------
// network
// ---------------------------------------------------------------------------

export interface PluginRequestInit {
  method?: string
  headers?: Record<string, string>
  body?: string | ArrayBuffer | Uint8Array
}

export interface PluginResponse {
  readonly status: number
  readonly ok: boolean
  readonly url: string
  readonly headers: Record<string, string>
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
  arrayBuffer(): Promise<ArrayBuffer>
}

// ---------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------

export interface PluginNote {
  path: string
  body: string
  frontMatter: Record<string, unknown>
}

export interface CreateNoteInput {
  rootFolder: string
  folder?: string
  title: string
  body?: string
  frontMatter?: Record<string, unknown>
}

export interface UpdateNoteInput {
  body: string
  frontMatter: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Plugin_API
// ---------------------------------------------------------------------------

export interface NotyraPluginApi {
  readonly pluginId: string
  /** Plugin_API_Version（= Notyra のアプリバージョン） */
  readonly apiVersion: string
  readonly modules: SharedModules

  styles: {
    add(css: string): Disposable
  }

  sidePanel: {
    registerView(view: SidePanelViewDefinition): Disposable
  }

  markdown: {
    registerRemarkPlugin(plugin: MarkdownPluggable): Disposable
    registerRehypePlugin(plugin: MarkdownPluggable): Disposable
  }

  editor: {
    registerExtension(extension: Extension): Disposable
    /** 1始まり。アクティブなエディタがなければ false */
    scrollToLine(line: number): boolean
  }

  commands: {
    register(command: CommandDefinition): Disposable
    execute(id: string): Promise<void>
  }

  toolbar: {
    addButton(button: ToolbarButtonDefinition): Disposable
  }

  keymaps: {
    add(binding: KeybindingDefinition): Disposable
  }

  events: {
    onActiveNoteChange(listener: (e: ActiveNoteEvent) => void): Disposable
  }

  settings: {
    get<T extends SettingValue = SettingValue>(key: string): T
    getAll(): Record<string, SettingValue>
    onDidChange(
      listener: (values: Record<string, SettingValue>) => void
    ): Disposable
  }

  /** `clipboard` Permission が必要 */
  clipboard: {
    readText(): Promise<string>
    writeText(text: string): Promise<void>
  }

  /** `shell:openExternal` Permission が必要 */
  shell: {
    openExternal(url: string): Promise<void>
  }

  /** `network` Permission が必要 */
  network: {
    fetch(url: string, init?: PluginRequestInit): Promise<PluginResponse>
  }

  /** `notes:read` / `notes:write` Permission が必要 */
  notes: {
    listRootFolders(): Promise<string[]>
    list(rootFolder: string): Promise<MarkdownNoteMeta[]>
    read(path: string): Promise<PluginNote>
    create(input: CreateNoteInput): Promise<string>
    update(path: string, input: UpdateNoteInput): Promise<void>
    rename(path: string, newTitle: string): Promise<string>
    move(
      rootFolder: string,
      path: string,
      targetFolder: string
    ): Promise<string>
    delete(path: string): Promise<void>
  }
}

// ---------------------------------------------------------------------------
// エラー
// ---------------------------------------------------------------------------

export type PluginApiErrorKind =
  | 'permissionDenied'
  | 'schemeNotAllowed'
  | 'blocked'
  | 'outOfScope'
  | 'notFound'
  | 'nameConflict'
  | 'deleteRejected'
  | 'io'
  | 'network'
  | 'timeout'
  | 'responseTooLarge'
  | 'tooManyRedirects'
  | 'pluginNotActive'
  | 'invalidArgument'

/**
 * PluginApiError が持ちうるすべての種別。
 * Plugin_API の種別に加え、Rust バックエンドの PluginError の種別
 * （インストール・更新などの管理操作で発生する `repoNotFound` 等）を含む。
 */
export type PluginErrorKind = PluginApiErrorKind | PluginBackendErrorKind

export class PluginApiError extends Error {
  readonly kind: PluginErrorKind
  readonly details?: unknown

  constructor(kind: PluginErrorKind, message?: string, details?: unknown) {
    super(message ?? kind)
    this.name = 'PluginApiError'
    this.kind = kind
    this.details = details
  }
}

// ---------------------------------------------------------------------------
// エントリモジュールの規約
// ---------------------------------------------------------------------------

export interface PluginModule {
  activate?(): void | Promise<void>
  deactivate?(): void | Promise<void>
}
