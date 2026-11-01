import { useEffect, useId, useRef, useState } from 'react'
import type React from 'react'
import { useTranslation } from 'react-i18next'
import {
  resolveSettingValue,
  validateSettingValue,
} from '@/shared/plugin/settingsSchema'
import type {
  SettingDeclaration,
  SettingType,
  SettingValue,
} from '@/shared/plugin/types'
import { tauriApi } from '../../../lib/tauriApi'
import { cn } from '../../../lib/utils'

const INVALID_KEYS: Record<SettingType, string> = {
  string: 'plugins.settingsForm.invalidString',
  number: 'plugins.settingsForm.invalidNumber',
  boolean: 'plugins.settingsForm.invalidBoolean',
  select: 'plugins.settingsForm.invalidSelect',
}

/** 入力欄の表示値（string / number は入力中の文字列をそのまま保持する） */
type InputValue = string | boolean

function toInputValue(value: SettingValue): InputValue {
  return typeof value === 'number' ? String(value) : value
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export interface PluginSettingsFormProps {
  pluginId: string
  /** Plugin の表示名（翻訳しない） */
  displayName: string
  /** Plugin_Manifest で宣言された Plugin_Settings */
  settings: readonly SettingDeclaration[]
  /** 既定は `tauriApi.plugins.getSettings` */
  loadSettings?: (id: string) => Promise<Record<string, unknown>>
  /** 既定は `tauriApi.plugins.setSetting` */
  saveSetting?: (id: string, key: string, value: SettingValue) => Promise<void>
}

/**
 * Plugin_Settings の入力フォーム（Requirement 17.3〜17.6）。
 *
 * Plugin の有効/無効にかかわらず表示できる。入力のたびに `validateSettingValue` で検証し、
 * 宣言の型に合う値だけを保存する。合わない値は入力エラーを表示して保存しない。
 * Plugin 由来の文言（表示名・説明・選択肢のラベル）は翻訳せずテキストとして描画する。
 */
export function PluginSettingsForm({
  pluginId,
  displayName,
  settings,
  loadSettings = tauriApi.plugins.getSettings,
  saveSetting = tauriApi.plugins.setSetting,
}: PluginSettingsFormProps) {
  const { t } = useTranslation()
  const [values, setValues] = useState<Record<string, InputValue> | null>(null)
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})
  const [saveError, setSaveError] = useState<string | null>(null)

  // 親の再描画で配列・関数の参照が変わっても、宣言の内容が同じなら読み込み直さない
  // （入力中の値やエラー表示を保つため）
  const loadRef = useRef(loadSettings)
  loadRef.current = loadSettings
  const settingsKey = JSON.stringify(settings)

  useEffect(() => {
    let cancelled = false
    const decls = JSON.parse(settingsKey) as SettingDeclaration[]
    const resolveAll = (stored: Record<string, unknown>) => {
      const next: Record<string, InputValue> = {}
      for (const decl of decls) {
        next[decl.key] = toInputValue(
          resolveSettingValue(
            decl,
            Object.hasOwn(stored, decl.key) ? stored[decl.key] : undefined
          )
        )
      }
      return next
    }
    setValues(null)
    setInvalid({})
    loadRef.current(pluginId).then(
      stored => {
        if (!cancelled) setValues(resolveAll(stored ?? {}))
      },
      e => {
        console.error('[plugins] failed to load settings:', e)
        if (!cancelled) setValues(resolveAll({}))
      }
    )
    return () => {
      cancelled = true
    }
  }, [pluginId, settingsKey])

  const handleChange = (decl: SettingDeclaration, raw: InputValue) => {
    setValues(prev => ({ ...(prev ?? {}), [decl.key]: raw }))
    const result = validateSettingValue(decl, raw)
    if (!result.ok) {
      setInvalid(prev => ({ ...prev, [decl.key]: true }))
      return
    }
    setInvalid(prev => ({ ...prev, [decl.key]: false }))
    saveSetting(pluginId, decl.key, result.value).then(
      () => setSaveError(null),
      e => setSaveError(errorMessage(e))
    )
  }

  return (
    <section
      aria-label={t('plugins.settingsForm.title', { name: displayName })}
      className="space-y-3"
      data-testid="plugin-settings-form"
    >
      {settings.length === 0 ? (
        <p className="text-caption text-muted-foreground">
          {t('plugins.settingsForm.empty')}
        </p>
      ) : (
        settings.map(decl => (
          <SettingField
            decl={decl}
            disabled={values === null}
            invalid={invalid[decl.key] === true}
            key={decl.key}
            onChange={raw => handleChange(decl, raw)}
            value={values?.[decl.key] ?? toInputValue(decl.default)}
          />
        ))
      )}
      {saveError !== null && (
        <p className="text-caption text-destructive" role="alert">
          {t('plugins.settingsForm.saveFailed', { message: saveError })}
        </p>
      )}
    </section>
  )
}

interface SettingFieldProps {
  decl: SettingDeclaration
  value: InputValue
  invalid: boolean
  disabled: boolean
  onChange: (raw: InputValue) => void
}

function SettingField({
  decl,
  value,
  invalid,
  disabled,
  onChange,
}: SettingFieldProps) {
  const { t } = useTranslation()
  const inputId = useId()
  const descriptionId = useId()
  const errorId = useId()
  const hasDescription =
    decl.description !== undefined && decl.description !== ''
  const describedBy =
    [hasDescription ? descriptionId : null, invalid ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined

  const inputClass = cn(
    'h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
    invalid ? 'border-destructive' : 'border-border'
  )

  let control: React.ReactNode
  switch (decl.type) {
    case 'boolean':
      control = (
        <ToggleSwitch
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          checked={value === true}
          disabled={disabled}
          id={inputId}
          onCheckedChange={onChange}
        />
      )
      break
    case 'select':
      control = (
        <select
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={inputClass}
          disabled={disabled}
          id={inputId}
          onChange={e => onChange(e.target.value)}
          value={typeof value === 'string' ? value : ''}
        >
          {decl.options.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )
      break
    default:
      control = (
        <input
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={inputClass}
          disabled={disabled}
          id={inputId}
          inputMode={decl.type === 'number' ? 'decimal' : undefined}
          onChange={e => onChange(e.target.value)}
          type="text"
          value={typeof value === 'string' ? value : String(value)}
        />
      )
  }

  return (
    <div className="space-y-1" data-setting-key={decl.key}>
      <div
        className={cn(
          decl.type === 'boolean' && 'flex items-center justify-between gap-3'
        )}
      >
        <label className="block text-sm font-medium" htmlFor={inputId}>
          {decl.title}
        </label>
        {decl.type === 'boolean' && control}
      </div>
      {hasDescription && (
        <p className="text-caption text-muted-foreground" id={descriptionId}>
          {decl.description}
        </p>
      )}
      {decl.type !== 'boolean' && control}
      {invalid && (
        <p className="text-caption text-destructive" id={errorId}>
          {t(INVALID_KEYS[decl.type])}
        </p>
      )}
    </div>
  )
}

export interface ToggleSwitchProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    'onChange' | 'role' | 'type'
  > {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

/** `role="switch"` のトグル */
export function ToggleSwitch({
  checked,
  onCheckedChange,
  className,
  disabled,
  ...props
}: ToggleSwitchProps) {
  return (
    <button
      aria-checked={checked}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-muted',
        className
      )}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      role="switch"
      type="button"
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block size-4 rounded-full bg-background shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}
