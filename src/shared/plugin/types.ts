// Plugin system shared types (manifest, persisted state, UI models)

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

export type Permission =
  | 'notes:read'
  | 'notes:write'
  | 'clipboard'
  | 'shell:openExternal'
  | 'network'

export const PERMISSIONS: readonly Permission[] = Object.freeze([
  'notes:read',
  'notes:write',
  'clipboard',
  'shell:openExternal',
  'network',
])

// ---------------------------------------------------------------------------
// Plugin_Manifest（package.json + notyra フィールド）
// ---------------------------------------------------------------------------

export type PluginAuthor =
  | string
  | { name: string; email?: string; url?: string }

export type PluginType = 'feature' | 'theme'

interface ManifestBase {
  /** Plugin_ID（package.json の name） */
  id: string
  version: string
  description?: string
  author?: PluginAuthor
  displayName: string
  /** Compatible_Version_Range（node-semver の範囲構文） */
  notyraVersion: string
}

export interface PermissionDeclaration {
  name: Permission
  /** Permission_Purpose */
  purpose?: string
}

export interface FeatureManifest extends ManifestBase {
  type: 'feature'
  /** ES モジュール形式のエントリモジュールのパス */
  main: string
  permissions: PermissionDeclaration[]
  /** Declared_Destination（network 宣言時は1件以上必須） */
  networkDestinations?: string[]
  settings?: SettingDeclaration[]
}

export interface ThemeManifest extends ManifestBase {
  type: 'theme'
  /** カラーテーマ定義ファイルのパス */
  theme: string
  /** 追加CSSファイルのパス */
  themeCss?: string
}

export type PluginManifest = FeatureManifest | ThemeManifest

// ---------------------------------------------------------------------------
// Plugin_Settings
// ---------------------------------------------------------------------------

interface SettingDeclarationBase {
  key: string
  title: string
  description?: string
}

export interface SelectOption {
  value: string
  label: string
}

export type SettingDeclaration =
  | (SettingDeclarationBase & { type: 'string'; default: string })
  | (SettingDeclarationBase & { type: 'number'; default: number })
  | (SettingDeclarationBase & { type: 'boolean'; default: boolean })
  | (SettingDeclarationBase & {
      type: 'select'
      default: string
      options: SelectOption[]
    })

export type SettingType = SettingDeclaration['type']

export type SettingValue = string | number | boolean

// ---------------------------------------------------------------------------
// Manifest_Parser の結果
// ---------------------------------------------------------------------------

export type StructuralErrorCode =
  | 'invalidJson'
  | 'missingNotyra'
  | 'missingField'
  | 'typeMismatch'

export type ValueErrorCode =
  | 'unknownType'
  | 'unknownPermission'
  | 'networkWithoutDestinations'
  | 'invalidRange'
  | 'invalidId'
  | 'invalidVersion'
  | 'invalidDestination'
  | 'forbiddenForTheme'
  | 'invalidSetting'
  | 'duplicatePermission'
  | 'invalidPath'

export type ManifestError =
  | {
      category: 'structural'
      /** 項目名（例: `notyra.permissions[2].name`） */
      field: string
      value: unknown
      code: StructuralErrorCode
    }
  | {
      category: 'value'
      field: string
      value: unknown
      code: ValueErrorCode
    }

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ManifestError[] }

// ---------------------------------------------------------------------------
// Installed_Plugin_State（plugins/state.json）
// ---------------------------------------------------------------------------

export type PluginSource =
  | { type: 'github'; owner: string; repo: string }
  | { type: 'local'; path: string }

export interface PendingConsent {
  addedPermissions: Permission[]
  addedDestinations: string[]
}

export type DisabledReason = 'user' | 'activateFailed'

export interface InstalledPluginState {
  id: string
  version: string
  source: PluginSource
  enabled: boolean
  consentedPermissions: Permission[]
  consentedDestinations: string[]
  // 以下は補助項目
  /** 更新・開発者モード再読み込みごとに +1（loadKey 用） */
  generation: number
  /** Developer_Plugin の同意待ち */
  pendingConsent?: PendingConsent
  disabledReason?: DisabledReason
  /** ISO 8601 */
  installedAt: string
}

export interface PluginStateFile {
  schemaVersion: 1
  thirdPartyWarningAcknowledged: boolean
  developerMode: boolean
  /** 配列順 = Load_Order */
  plugins: InstalledPluginState[]
}

export interface InstalledPluginView extends InstalledPluginState {
  /** package.json の文字列。読めない場合は null */
  packageJson: string | null
}

/** `plugin_get_state` と `plugins:state-changed` のペイロード */
export interface PluginStateView extends Omit<PluginStateFile, 'plugins'> {
  plugins: InstalledPluginView[]
  /** 起動時に検出した問題（state.json の破損など）。なければ省略 */
  startupError?: PluginErrorPayload
}

// ---------------------------------------------------------------------------
// Rust バックエンドの PluginError（src-tauri/src/plugins/error.rs）
// ---------------------------------------------------------------------------

/** Network_Gateway が通信をブロックした理由 */
export type BlockReason =
  | 'notDeclared'
  | 'redirectNotDeclared'
  | 'resolvedToPrivate'
  | 'resolvedToNonPrivate'

/** Rust の `PluginError` のシリアライズ形式（`{ kind, ...fields }`） */
export type PluginErrorPayload =
  | { kind: 'repoNotFound' }
  | { kind: 'noRelease' }
  | { kind: 'noPackage' }
  /** `resetAt` は UNIX 秒 */
  | { kind: 'rateLimited'; resetAt: number | null }
  | { kind: 'network'; message: string }
  | { kind: 'tooLarge' }
  | { kind: 'invalidZip'; message: string }
  | { kind: 'manifestMissing' }
  | { kind: 'alreadyInstalled' }
  | { kind: 'notInstalled' }
  | { kind: 'io'; message: string }
  | { kind: 'permissionDenied'; permission: string }
  | { kind: 'schemeNotAllowed'; scheme: string }
  | { kind: 'blocked'; host: string; port: number; reason: BlockReason }
  | { kind: 'outOfScope'; path: string }
  | { kind: 'notFound'; path: string }
  | { kind: 'nameConflict'; path: string }
  | { kind: 'tooManyRedirects' }
  | { kind: 'responseTooLarge' }
  | { kind: 'timeout' }
  | { kind: 'corruptState'; message: string }
  | { kind: 'invalidArgument'; message: string }

export type PluginBackendErrorKind = PluginErrorPayload['kind']

// ---------------------------------------------------------------------------
// Rust コマンドの入出力（src-tauri/src/commands/plugin*.rs）
// ---------------------------------------------------------------------------

/**
 * インストール・更新・開発フォルダ登録・再同意で記録する内容。
 *
 * `source` は `plugin_commit_install`（GitHub 必須）と `plugin_register_dev`
 * （local で選択したパスと一致、または省略）で使い、更新と再同意では無視される。
 */
export interface InstallRecord {
  id: string
  version: string
  source?: PluginSource
  consentedPermissions: Permission[]
  consentedDestinations: string[]
}

/** `plugin_fetch_release` の戻り値 */
export interface FetchedPackage {
  stagingId: string
  /** staging のルートにある package.json の文字列 */
  packageJson: string
  /** Latest_Release のタグ名 */
  tag: string
}

/** `plugin_check_update` の戻り値（staging は Rust 側で常に破棄される） */
export interface UpdateCheck {
  version: string
}

/** `plugin_select_dev_folder` の戻り値 */
export interface DevFolder {
  path: string
  packageJson: string
}

/** `plugin_reload_dev` の戻り値 */
export interface DevReload {
  packageJson: string
}

/** `plugins:settings-changed` のペイロード（値の型検証は利用側で行う） */
export interface SettingsChangedPayload {
  id: string
  values: Record<string, unknown>
}

/** `plugins:stop-request` のペイロード */
export interface StopRequestPayload {
  id: string
  requestId: string
}

/** `plugin_http_request` の要求 */
export interface PluginHttpRequest {
  url: string
  /** 省略または空文字列なら `GET` */
  method?: string
  headers?: Array<[string, string]>
  bodyBase64?: string
}

/** `plugin_http_request` の応答 */
export interface PluginHttpResponse {
  status: number
  headers: Array<[string, string]>
  bodyBase64: string
  /** リダイレクト追従後の最終的な URL */
  url: string
}

// ---------------------------------------------------------------------------
// Consent_Dialog
// ---------------------------------------------------------------------------

export type DestinationClass = 'private' | 'public'

export interface ClassifiedDestination {
  dest: string
  class: DestinationClass
}

export interface ConsentRequest {
  mode: 'install' | 'update' | 'devLoad' | 'devReload'
  displayName: string
  author?: string
  source: PluginSource
  /** update / devReload では追加分のみ */
  permissions: PermissionDeclaration[]
  destinations: ClassifiedDestination[]
}

// ---------------------------------------------------------------------------
// エラー・キーバインド重複
// ---------------------------------------------------------------------------

export type PluginErrorSource =
  | 'load'
  | 'activate'
  | 'deactivate'
  | 'command'
  | 'markdown'
  | 'theme'
  | 'sidePanel'
  | 'editorExtension'

export interface PluginErrorEntry {
  pluginId: string
  source: PluginErrorSource
  message: string
  windowLabel: string
  /** ISO 8601 */
  at: string
}

export interface KeybindingConflict {
  pluginId: string
  key: string
  command: string
  with: 'builtin' | { pluginId: string }
}

// ---------------------------------------------------------------------------
// Plugin_Registry
// ---------------------------------------------------------------------------

export interface RegistryEntry {
  id: string
  name: string
  description: string
  author: string
  /** `owner/repo` 形式の GitHub リポジトリ */
  repo: string
}
