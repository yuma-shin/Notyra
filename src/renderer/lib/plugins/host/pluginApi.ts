/**
 * Plugin_API ファサード（design.md「13. Plugin_API の型」）。
 *
 * `createPluginApi(pluginId, deps)` は Plugin 専用の `NotyraPluginApi` を作る。
 * 仮想モジュール `@notyra/plugin-api` は PluginHost.getPluginApi(id) 経由でこのオブジェクトを返す。
 *
 * - 登録系の API は、レジストリへの登録を現在のセッションに `track` で記録する。
 *   Plugin が個別に dispose した登録は `untrack` で記録から外す
 * - ID の接頭辞（`${pluginId}:`）はレジストリ側で付与するため、ここでは Plugin の
 *   ローカル ID をそのまま渡す
 * - 権限付き API は、呼び出し時点の同意済み Permission で判定し、なければ tauriApi を
 *   呼ばずに `permissionDenied` で reject する（Rust 側の再確認とは独立。Requirement 6.9）
 * - セッションがない（停止済み・未開始）ときの呼び出しは `pluginNotActive`
 */
import type { Extension } from '@codemirror/state'
import type {
  ActiveNoteEvent,
  CommandDefinition,
  CreateNoteInput,
  Disposable,
  KeybindingDefinition,
  MarkdownPluggable,
  NotyraPluginApi,
  PluginNote,
  PluginRequestInit,
  PluginResponse,
  SharedModules,
  SidePanelViewDefinition,
  ToolbarButtonDefinition,
  UpdateNoteInput,
} from '@/shared/plugin/api'
import { PluginApiError } from '@/shared/plugin/api'
import { resolveSettingValue } from '@/shared/plugin/settingsSchema'
import type {
  Permission,
  PluginHttpRequest,
  PluginHttpResponse,
  SettingDeclaration,
  SettingValue,
} from '@/shared/plugin/types'
import type { MarkdownNoteMeta } from '@/shared/types'
import { toPluginApiError } from '../pluginError'
import { runWithTimeout } from '../withTimeout'
import { ID_SEPARATOR, resolveCommandId } from './registries/ids'
import type { Registries } from './registries'
import type { PluginSession } from './session'
import { SHARED_MODULES } from './sharedModules'

// ---------------------------------------------------------------------------
// 依存
// ---------------------------------------------------------------------------

type TauriPluginsApi =
  typeof import('@/renderer/lib/tauriApi')['tauriApi']['plugins']

/** ファサードが使う tauriApi.plugins の部分集合（テストで差し替え可能） */
export interface PluginApiBackend {
  clipboardRead: TauriPluginsApi['clipboardRead']
  clipboardWrite: TauriPluginsApi['clipboardWrite']
  openExternal: TauriPluginsApi['openExternal']
  httpRequest: TauriPluginsApi['httpRequest']
  notes: Pick<
    TauriPluginsApi['notes'],
    | 'listRoots'
    | 'list'
    | 'read'
    | 'create'
    | 'update'
    | 'rename'
    | 'move'
    | 'delete'
  >
}

/** `notes.delete` の確認ダイアログに渡す内容（Requirement 18.12） */
export interface NoteDeleteConfirmation {
  pluginId: string
  /** Plugin の表示名 */
  pluginName: string
  /** 削除対象のノート名（ファイル名から `.md` を除いたもの） */
  noteName: string
  path: string
}

/** 登録に失敗した拡張ポイント（PluginHost が PluginErrorSource に対応付けて報告する） */
export type RegistrationTarget =
  | 'style'
  | 'sidePanel'
  | 'markdown'
  | 'editorExtension'
  | 'command'
  | 'toolbar'
  | 'keymap'
  | 'activeNote'
  | 'settings'

export interface PluginApiDeps {
  backend: PluginApiBackend
  registries: Registries
  /** Plugin_API_Version（= Notyra のアプリバージョン） */
  appVersion: string
  /** 既定は SHARED_MODULES */
  modules?: SharedModules
  /** この Plugin の現在のセッション。読み込まれていなければ null */
  getSession(): PluginSession | null
  /** 呼び出し時点の同意済み Permission（Installed_Plugin_State） */
  getConsentedPermissions(): readonly Permission[]
  /** Plugin の表示名（確認ダイアログに表示する） */
  getDisplayName(): string
  /** Plugin_Manifest の Plugin_Settings 宣言 */
  getSettingDeclarations(): readonly SettingDeclaration[]
  /** 登録済みルートフォルダのパス（`notes.delete` のルート決定に使う） */
  getRootFolders(): readonly string[]
  /**
   * 削除の確認ダイアログを表示し、確定なら true を返す。
   * キャンセル・閉じる操作は false（Requirement 18.12、18.14）
   */
  confirmDelete(request: NoteDeleteConfirmation): Promise<boolean>
  /** 登録の拒否（`invalidArgument` など）の報告先。例外は Plugin にもそのまま送出する */
  onRegistrationError?(target: RegistrationTarget, error: unknown): void
  /** `commands.execute` のタイムアウト（ミリ秒）。既定は 10秒（Requirement 16.6） */
  commandTimeoutMs?: number
}

const DEFAULT_COMMAND_TIMEOUT_MS = 10_000

// ---------------------------------------------------------------------------
// ファサード
// ---------------------------------------------------------------------------

export function createPluginApi(
  pluginId: string,
  deps: PluginApiDeps
): NotyraPluginApi {
  const { backend, registries } = deps
  const commandTimeoutMs = deps.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS

  const requireSession = (): PluginSession => {
    const session = deps.getSession()
    if (!session || session.disposed || session.pluginId !== pluginId) {
      throw new PluginApiError(
        'pluginNotActive',
        `Plugin "${pluginId}" is not active`
      )
    }
    return session
  }

  const requirePermission = (permission: Permission): void => {
    if (!deps.getConsentedPermissions().includes(permission)) {
      throw new PluginApiError(
        'permissionDenied',
        `Plugin "${pluginId}" has not been granted the "${permission}" permission`,
        { permission }
      )
    }
  }

  const reportRegistrationError = (
    target: RegistrationTarget,
    error: unknown
  ): void => {
    try {
      deps.onRegistrationError?.(target, error)
    } catch (reportError) {
      console.error(reportError)
    }
  }

  /**
   * 引数の検証とレジストリへの登録を行い、セッションに記録した Disposable を返す。
   * 失敗（検証エラー・レジストリの拒否）は報告してから Plugin に送出する。
   */
  const register = (
    target: RegistrationTarget,
    doRegister: () => Disposable
  ): Disposable => {
    const session = requireSession()
    let inner: Disposable
    try {
      inner = doRegister()
    } catch (error) {
      reportRegistrationError(target, error)
      throw error
    }

    let disposed = false
    const handle: Disposable = {
      dispose: () => {
        if (disposed) return
        disposed = true
        session.untrack(handle)
        inner.dispose()
      },
    }
    session.track(handle)
    return handle
  }

  /** 権限付きの非同期 API。セッション → Permission → 本体の順に確認する */
  const gated = async <T>(
    permission: Permission,
    run: () => Promise<T>
  ): Promise<T> => {
    requireSession()
    requirePermission(permission)
    try {
      return await run()
    } catch (error) {
      throw toPluginApiError(error)
    }
  }

  // --- settings ---

  const findDeclaration = (key: string): SettingDeclaration | undefined =>
    deps.getSettingDeclarations().find(d => d.key === key)

  const resolveAll = (
    stored: Readonly<Record<string, unknown>>
  ): Record<string, SettingValue> => {
    const result: Record<string, SettingValue> = {}
    for (const decl of deps.getSettingDeclarations()) {
      result[decl.key] = resolveSettingValue(
        decl,
        Object.hasOwn(stored, decl.key) ? stored[decl.key] : undefined
      )
    }
    return result
  }

  const api: NotyraPluginApi = {
    pluginId,
    apiVersion: deps.appVersion,
    modules: deps.modules ?? SHARED_MODULES,

    styles: Object.freeze({
      add(css: string): Disposable {
        return register('style', () => {
          assertString(css, 'css')
          return registries.styles.add(pluginId, css)
        })
      },
    }),

    sidePanel: Object.freeze({
      registerView(view: SidePanelViewDefinition): Disposable {
        return register('sidePanel', () => {
          assertObject(view, 'view')
          assertLocalId(view.id, 'view.id')
          assertString(view.title, 'view.title')
          assertString(view.icon, 'view.icon')
          assertFunction(view.render, 'view.render')
          return registries.sidePanel.register(pluginId, {
            id: view.id,
            title: view.title,
            icon: view.icon,
            render: view.render,
          })
        })
      },
    }),

    markdown: Object.freeze({
      registerRemarkPlugin(plugin: MarkdownPluggable): Disposable {
        return register('markdown', () => {
          assertPluggable(plugin, 'plugin')
          return registries.markdown.registerRemark(pluginId, plugin)
        })
      },
      registerRehypePlugin(plugin: MarkdownPluggable): Disposable {
        return register('markdown', () => {
          assertPluggable(plugin, 'plugin')
          return registries.markdown.registerRehype(pluginId, plugin)
        })
      },
    }),

    editor: Object.freeze({
      registerExtension(extension: Extension): Disposable {
        return register('editorExtension', () =>
          registries.editorExtensions.register(pluginId, extension)
        )
      },
      scrollToLine(line: number): boolean {
        requireSession()
        if (typeof line !== 'number') return false
        return registries.activeEditor.scrollToLine(line)
      },
    }),

    commands: Object.freeze({
      register(command: CommandDefinition): Disposable {
        return register('command', () => {
          assertObject(command, 'command')
          assertLocalId(command.id, 'command.id')
          assertString(command.title, 'command.title')
          assertFunction(command.run, 'command.run')
          return registries.commands.register(pluginId, {
            id: command.id,
            title: command.title,
            run: command.run,
          })
        })
      },
      async execute(id: string): Promise<void> {
        requireSession()
        assertNonEmptyString(id, 'id')
        const realId = resolveCommandId(pluginId, id)
        const command = registries.commands.get(realId)
        if (!command) {
          throw new PluginApiError(
            'invalidArgument',
            `Command "${realId}" is not registered`
          )
        }
        const result = await runWithTimeout(
          () => command.run(),
          commandTimeoutMs
        )
        if (!result.ok) {
          if (result.timedOut) {
            throw new PluginApiError(
              'timeout',
              `Command "${realId}" timed out after ${commandTimeoutMs}ms`,
              result.error
            )
          }
          throw result.error
        }
      },
    }),

    toolbar: Object.freeze({
      addButton(button: ToolbarButtonDefinition): Disposable {
        return register('toolbar', () => {
          assertObject(button, 'button')
          assertNonEmptyString(button.command, 'button.command')
          assertString(button.icon, 'button.icon')
          assertString(button.tooltip, 'button.tooltip')
          return registries.toolbar.register(pluginId, {
            command: button.command,
            icon: button.icon,
            tooltip: button.tooltip,
          })
        })
      },
    }),

    keymaps: Object.freeze({
      add(binding: KeybindingDefinition): Disposable {
        return register('keymap', () => {
          assertObject(binding, 'binding')
          assertNonEmptyString(binding.key, 'binding.key')
          assertNonEmptyString(binding.command, 'binding.command')
          return registries.keymaps.register(pluginId, {
            key: binding.key,
            command: binding.command,
          })
        })
      },
    }),

    events: Object.freeze({
      onActiveNoteChange(listener: (e: ActiveNoteEvent) => void): Disposable {
        return register('activeNote', () => {
          assertFunction(listener, 'listener')
          return registries.activeNote.subscribe(pluginId, listener)
        })
      },
    }),

    settings: Object.freeze({
      get<T extends SettingValue = SettingValue>(key: string): T {
        requireSession()
        const decl = findDeclaration(key)
        if (!decl) {
          throw new PluginApiError(
            'invalidArgument',
            `Setting "${String(key)}" is not declared`
          )
        }
        const stored = registries.settings.getValues(pluginId)
        return resolveSettingValue(
          decl,
          Object.hasOwn(stored, key) ? stored[key] : undefined
        ) as T
      },
      getAll(): Record<string, SettingValue> {
        requireSession()
        return resolveAll(registries.settings.getValues(pluginId))
      },
      onDidChange(
        listener: (values: Record<string, SettingValue>) => void
      ): Disposable {
        return register('settings', () => {
          assertFunction(listener, 'listener')
          return registries.settings.subscribe(pluginId, values =>
            listener(resolveAll(values))
          )
        })
      },
    }),

    clipboard: Object.freeze({
      readText: (): Promise<string> =>
        gated('clipboard', () => backend.clipboardRead(pluginId)),
      writeText: (text: string): Promise<void> =>
        gated('clipboard', async () => {
          assertString(text, 'text')
          await backend.clipboardWrite(pluginId, text)
        }),
    }),

    shell: Object.freeze({
      openExternal: (url: string): Promise<void> =>
        gated('shell:openExternal', async () => {
          assertExternalUrl(url)
          await backend.openExternal(pluginId, url)
        }),
    }),

    network: Object.freeze({
      fetch: (url: string, init?: PluginRequestInit): Promise<PluginResponse> =>
        gated('network', async () => {
          const request = toHttpRequest(url, init)
          const response = await backend.httpRequest(pluginId, request)
          return toPluginResponse(response)
        }),
    }),

    notes: Object.freeze({
      listRootFolders: (): Promise<string[]> =>
        gated('notes:read', () => backend.notes.listRoots(pluginId)),

      list: (rootFolder: string): Promise<MarkdownNoteMeta[]> =>
        gated('notes:read', async () => {
          assertNonEmptyString(rootFolder, 'rootFolder')
          return backend.notes.list(pluginId, rootFolder)
        }),

      read: (path: string): Promise<PluginNote> =>
        gated('notes:read', async () => {
          assertNonEmptyString(path, 'path')
          return backend.notes.read(pluginId, path)
        }),

      create: (input: CreateNoteInput): Promise<string> =>
        gated('notes:write', async () => {
          assertObject(input, 'input')
          assertNonEmptyString(input.rootFolder, 'input.rootFolder')
          assertNonEmptyString(input.title, 'input.title')
          assertOptional(input.folder, assertString, 'input.folder')
          assertOptional(input.body, assertString, 'input.body')
          assertOptional(input.frontMatter, assertObject, 'input.frontMatter')
          return backend.notes.create(pluginId, {
            root: input.rootFolder,
            folder: input.folder,
            title: input.title,
            body: input.body,
            frontMatter: input.frontMatter,
          })
        }),

      update: (path: string, input: UpdateNoteInput): Promise<void> =>
        gated('notes:write', async () => {
          assertNonEmptyString(path, 'path')
          assertObject(input, 'input')
          assertString(input.body, 'input.body')
          assertObject(input.frontMatter, 'input.frontMatter')
          await backend.notes.update(
            pluginId,
            path,
            input.body,
            input.frontMatter
          )
        }),

      rename: (path: string, newTitle: string): Promise<string> =>
        gated('notes:write', async () => {
          assertNonEmptyString(path, 'path')
          assertNonEmptyString(newTitle, 'newTitle')
          return backend.notes.rename(pluginId, path, newTitle)
        }),

      move: (
        rootFolder: string,
        path: string,
        targetFolder: string
      ): Promise<string> =>
        gated('notes:write', async () => {
          assertNonEmptyString(rootFolder, 'rootFolder')
          assertNonEmptyString(path, 'path')
          assertString(targetFolder, 'targetFolder')
          return backend.notes.move(pluginId, rootFolder, path, targetFolder)
        }),

      delete: (path: string): Promise<void> =>
        gated('notes:write', async () => {
          assertNonEmptyString(path, 'path')
          const root = findContainingRoot(path, deps.getRootFolders())
          if (root === null) {
            throw new PluginApiError(
              'outOfScope',
              `path is outside the registered root folders: ${path}`,
              { path }
            )
          }

          let confirmed = false
          try {
            confirmed = await deps.confirmDelete({
              pluginId,
              pluginName: deps.getDisplayName(),
              noteName: noteNameFromPath(path),
              path,
            })
          } catch (error) {
            console.error(error)
            confirmed = false
          }
          if (!confirmed) {
            throw new PluginApiError(
              'deleteRejected',
              'The user rejected deleting the note',
              { path }
            )
          }
          // ダイアログの表示中に停止された場合は削除しない
          requireSession()
          await backend.notes.delete(pluginId, root, path)
        }),
    }),
  }

  return Object.freeze(api)
}

// ---------------------------------------------------------------------------
// 引数の検証（Plugin は任意の JavaScript から呼び出せるため、型に頼らず確認する）
// ---------------------------------------------------------------------------

function invalid(name: string, expected: string): PluginApiError {
  return new PluginApiError('invalidArgument', `${name} must be ${expected}`)
}

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') throw invalid(name, 'a string')
}

function assertNonEmptyString(
  value: unknown,
  name: string
): asserts value is string {
  if (typeof value !== 'string' || value === '') {
    throw invalid(name, 'a non-empty string')
  }
}

/** Plugin 内の ID。区切り文字 `:` は実 ID の解決と衝突するため使えない */
function assertLocalId(value: unknown, name: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value === '' ||
    value.includes(ID_SEPARATOR)
  ) {
    throw invalid(name, `a non-empty string without "${ID_SEPARATOR}"`)
  }
}

function assertFunction(
  value: unknown,
  name: string
): asserts value is (...args: never[]) => unknown {
  if (typeof value !== 'function') throw invalid(name, 'a function')
}

function assertObject(
  value: unknown,
  name: string
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(name, 'an object')
  }
}

function assertOptional(
  value: unknown,
  assert: (value: unknown, name: string) => void,
  name: string
): void {
  if (value !== undefined) assert(value, name)
}

function assertPluggable(value: unknown, name: string): void {
  if (typeof value === 'function') return
  if (Array.isArray(value) && typeof value[0] === 'function') return
  throw invalid(name, 'a unified plugin or [plugin, ...options]')
}

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

/** `openExternal` で開けるスキーム（Requirement 6.11、6.12） */
export const EXTERNAL_URL_SCHEMES: ReadonlySet<string> = new Set([
  'http:',
  'https:',
  'mailto:',
])

function assertExternalUrl(url: unknown): void {
  assertString(url, 'url')
  let scheme: string
  try {
    scheme = new URL(url).protocol
  } catch {
    throw new PluginApiError('schemeNotAllowed', `Invalid URL: ${url}`, {
      scheme: '',
    })
  }
  if (!EXTERNAL_URL_SCHEMES.has(scheme)) {
    throw new PluginApiError(
      'schemeNotAllowed',
      `scheme not allowed: ${scheme.replace(/:$/, '')}`,
      { scheme: scheme.replace(/:$/, '') }
    )
  }
}

// ---------------------------------------------------------------------------
// network
// ---------------------------------------------------------------------------

/** PluginRequestInit を `plugin_http_request` の要求に変換する */
export function toHttpRequest(
  url: unknown,
  init: PluginRequestInit | undefined
): PluginHttpRequest {
  assertString(url, 'url')
  const request: PluginHttpRequest = { url }
  if (init === undefined) return request
  assertObject(init, 'init')

  if (init.method !== undefined) {
    assertString(init.method, 'init.method')
    request.method = init.method
  }

  if (init.headers !== undefined) {
    assertObject(init.headers, 'init.headers')
    const headers: Array<[string, string]> = []
    for (const [name, value] of Object.entries(init.headers)) {
      assertString(value, `init.headers["${name}"]`)
      headers.push([name, value])
    }
    request.headers = headers
  }

  if (init.body !== undefined) {
    request.bodyBase64 = encodeBase64(toBytes(init.body))
  }
  return request
}

function toBytes(body: unknown): Uint8Array {
  if (typeof body === 'string') return new TextEncoder().encode(body)
  // 別 realm の ArrayBuffer / TypedArray も受け付けるため instanceof を使わない
  if (Object.prototype.toString.call(body) === '[object ArrayBuffer]') {
    return new Uint8Array(body as ArrayBuffer)
  }
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  }
  throw invalid('init.body', 'a string, ArrayBuffer, or Uint8Array')
}

/** `plugin_http_request` の応答を PluginResponse に変換する */
export function toPluginResponse(response: PluginHttpResponse): PluginResponse {
  const headers: Record<string, string> = {}
  for (const [name, value] of response.headers) {
    const key = name.toLowerCase()
    headers[key] = Object.hasOwn(headers, key)
      ? `${headers[key]}, ${value}`
      : value
  }

  let bytes: Uint8Array | null = null
  const body = (): Uint8Array => {
    if (bytes === null) {
      try {
        bytes = decodeBase64(response.bodyBase64)
      } catch (error) {
        throw new PluginApiError(
          'network',
          'Invalid response body encoding',
          error
        )
      }
    }
    return bytes
  }

  const text = async (): Promise<string> => new TextDecoder().decode(body())

  return Object.freeze({
    status: response.status,
    ok: response.status >= 200 && response.status <= 299,
    url: response.url,
    headers: Object.freeze(headers),
    text,
    async json<T = unknown>(): Promise<T> {
      return JSON.parse(await text()) as T
    },
    async arrayBuffer(): Promise<ArrayBuffer> {
      // 呼び出しごとに複製を返し、Plugin による変更が他の読み取りに影響しないようにする
      const copy = new Uint8Array(body().byteLength)
      copy.set(body())
      return copy.buffer
    },
  })
}

const BASE64_CHUNK = 0x8000

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK))
  }
  return btoa(binary)
}

export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ---------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------

/**
 * パスを字句的に正規化する（区切り文字を `/` に統一し、`.`・`..`・重複した区切りと
 * 末尾の区切りを除く）。範囲の最終判定は Rust の `resolve_within_roots` が行う。
 */
export function normalizePathLexically(path: string): string {
  const unified = path.replaceAll('\\', '/')
  const isUnc = unified.startsWith('//')
  const isAbsolute = unified.startsWith('/')
  const segments: string[] = []
  for (const segment of unified.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      const last = segments.at(-1)
      if (last === undefined || last === '..') {
        // 絶対パスのルートより上には遡らない。相対パスでは `..` を残す
        if (!isAbsolute) segments.push(segment)
      } else if (!/^[A-Za-z]:$/.test(last)) {
        // ドライブ文字（`C:`）より上には遡らない
        segments.pop()
      }
      continue
    }
    segments.push(segment)
  }
  const joined = segments.join('/')
  if (isUnc) return `//${joined}`
  return isAbsolute ? `/${joined}` : joined
}

function isCaseInsensitivePath(normalized: string): boolean {
  return /^[A-Za-z]:/.test(normalized) || normalized.startsWith('//')
}

/**
 * パスを含む登録済みルートフォルダ（ルート自身を含む）を返す。
 * 複数が該当する場合は最も深いルート。該当しなければ null。
 * Windows のドライブ文字・UNC パスは大文字小文字を区別せずに比較する。
 */
export function findContainingRoot(
  path: string,
  roots: readonly string[]
): string | null {
  const target = normalizePathLexically(path)
  let best: { root: string; length: number } | null = null
  for (const root of roots) {
    const normalizedRoot = normalizePathLexically(root)
    if (normalizedRoot === '' || normalizedRoot === '/') continue
    const fold = isCaseInsensitivePath(normalizedRoot)
    const t = fold ? target.toLowerCase() : target
    const r = fold ? normalizedRoot.toLowerCase() : normalizedRoot
    const inside = t === r || t.startsWith(`${r}/`)
    if (inside && (best === null || r.length > best.length)) {
      best = { root, length: r.length }
    }
  }
  return best?.root ?? null
}

/** 確認ダイアログに表示するノート名（ファイル名から `.md` を除く） */
export function noteNameFromPath(path: string): string {
  const name = path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1)
  if (!name) return path
  return name.replace(/\.md$/i, '')
}
