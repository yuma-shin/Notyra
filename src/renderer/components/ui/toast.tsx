import type * as React from 'react'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react'
import { cva } from 'class-variance-authority'
import { useTranslation } from 'react-i18next'
import { LuCircleAlert, LuCircleCheck, LuInfo, LuX } from 'react-icons/lu'

import { cn } from 'renderer/lib/utils'

/** 自動消去までの既定時間（ミリ秒） */
export const TOAST_DURATION_MS = 5000

/** 同時に保持するトーストの上限。超えた分は古いものから破棄する */
export const MAX_TOASTS = 5

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastOptions {
  kind?: ToastKind
  title?: string
  message: string
  /** 自動消去までの時間（ミリ秒）。0 以下で自動消去しない */
  duration?: number
}

export interface ToastItem {
  id: string
  kind: ToastKind
  title?: string
  message: string
  duration: number
}

type ToastShortcutOptions = Omit<ToastOptions, 'kind' | 'message'>

/**
 * トーストを表示する API。React の外（PluginHost 等）からも使える。
 */
export interface ToastApi {
  show(options: ToastOptions): string
  info(message: string, options?: ToastShortcutOptions): string
  success(message: string, options?: ToastShortcutOptions): string
  error(message: string, options?: ToastShortcutOptions): string
  dismiss(id: string): void
  clear(): void
}

/** トーストの外部ストア。`useSyncExternalStore` で購読する */
export interface ToastStore extends ToastApi {
  subscribe(listener: () => void): () => void
  getSnapshot(): readonly ToastItem[]
}

export function createToastStore(): ToastStore {
  let items: readonly ToastItem[] = []
  let counter = 0
  const listeners = new Set<() => void>()

  const emit = () => {
    for (const listener of listeners) listener()
  }

  const show = (options: ToastOptions): string => {
    counter += 1
    const id = `toast-${counter}`
    const item: ToastItem = {
      id,
      kind: options.kind ?? 'info',
      title: options.title,
      message: options.message,
      duration: options.duration ?? TOAST_DURATION_MS,
    }
    items = [...items, item].slice(-MAX_TOASTS)
    emit()
    return id
  }

  const dismiss = (id: string) => {
    if (!items.some(item => item.id === id)) return
    items = items.filter(item => item.id !== id)
    emit()
  }

  return {
    show,
    info: (message, options) => show({ ...options, kind: 'info', message }),
    success: (message, options) =>
      show({ ...options, kind: 'success', message }),
    error: (message, options) => show({ ...options, kind: 'error', message }),
    dismiss,
    clear: () => {
      if (items.length === 0) return
      items = []
      emit()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => items,
  }
}

/** ウィンドウごとの既定ストア（各ウィンドウは独立した JS コンテキストで動く） */
export const toastStore: ToastStore = createToastStore()

/** React の外から使うための既定の ToastApi */
export const toast: ToastApi = toastStore

const ToastContext = createContext<ToastApi | null>(null)

const toastVariants = cva(
  'pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-lg border bg-card px-4 py-3 text-sm text-card-foreground',
  {
    variants: {
      kind: {
        info: 'border-border',
        success: 'border-border',
        error: 'border-destructive',
      },
    },
    defaultVariants: {
      kind: 'info',
    },
  }
)

const ICONS: Record<ToastKind, React.ComponentType<{ className?: string }>> = {
  info: LuInfo,
  success: LuCircleCheck,
  error: LuCircleAlert,
}

export interface ToastProps {
  item: ToastItem
  onDismiss: (id: string) => void
  closeLabel: string
}

export function Toast({ item, onDismiss, closeLabel }: ToastProps) {
  const { id, duration } = item

  useEffect(() => {
    if (duration <= 0) return
    const timer = setTimeout(() => onDismiss(id), duration)
    return () => clearTimeout(timer)
  }, [id, duration, onDismiss])

  const Icon = ICONS[item.kind]

  return (
    <div
      className={cn(toastVariants({ kind: item.kind }))}
      data-kind={item.kind}
      data-slot="toast"
      role={item.kind === 'error' ? 'alert' : 'status'}
      style={{ boxShadow: 'var(--elevation-md)' }}
    >
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          item.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'
        )}
      />
      <div className="min-w-0 flex-1">
        {item.title && (
          <div className="font-medium break-words" data-slot="toast-title">
            {item.title}
          </div>
        )}
        <div
          className={cn(
            'whitespace-pre-wrap break-words',
            item.title && 'text-muted-foreground'
          )}
          data-slot="toast-message"
        >
          {item.message}
        </div>
      </div>
      <button
        aria-label={closeLabel}
        className="-mr-1 shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onDismiss(id)}
        type="button"
      >
        <LuX className="size-4" />
      </button>
    </div>
  )
}

export interface ToastProviderProps {
  children?: React.ReactNode
  /** 省略時はウィンドウ既定の `toastStore` を使う */
  store?: ToastStore
  /** 閉じるボタンのアクセシブルなラベル。省略時は i18n の既存文言 */
  closeLabel?: string
}

export function ToastProvider({
  children,
  store = toastStore,
  closeLabel,
}: ToastProviderProps) {
  const { t } = useTranslation()
  const items = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  )

  const api = useMemo<ToastApi>(
    () => ({
      show: store.show,
      info: store.info,
      success: store.success,
      error: store.error,
      dismiss: store.dismiss,
      clear: store.clear,
    }),
    [store]
  )

  const label = closeLabel ?? t('titleBar.close')

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section
        className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col items-end gap-2"
        data-slot="toast-viewport"
      >
        {items.map(item => (
          <Toast
            closeLabel={label}
            item={item}
            key={item.id}
            onDismiss={store.dismiss}
          />
        ))}
      </section>
    </ToastContext.Provider>
  )
}

/**
 * ToastProvider 配下で ToastApi を取得する。
 * Provider の外では既定の `toast`（ウィンドウ既定ストア）を返す。
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? toast
}
