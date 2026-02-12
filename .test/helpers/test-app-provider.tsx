import React from 'react'
import { render, renderHook, type RenderOptions, type RenderHookOptions } from '@testing-library/react'
import { AppProvider } from '@/renderer/contexts/AppContext'
import type { AppSettings } from '@/shared/types'

interface TestProviderOptions {
  settings?: Partial<AppSettings>
}

function TestAppProvider({
  children,
  settings,
}: { children: React.ReactNode } & TestProviderOptions) {
  if (settings) {
    localStorage.setItem(
      'appSettings',
      JSON.stringify(settings),
    )
  }
  return <AppProvider>{children}</AppProvider>
}

export function renderWithProviders(
  ui: React.ReactElement,
  options?: TestProviderOptions & { renderOptions?: Omit<RenderOptions, 'wrapper'> },
) {
  const { settings, renderOptions } = options ?? {}
  return render(ui, {
    wrapper: ({ children }) => (
      <TestAppProvider settings={settings}>{children}</TestAppProvider>
    ),
    ...renderOptions,
  })
}

export function renderHookWithProviders<TResult>(
  hook: () => TResult,
  options?: TestProviderOptions & { renderHookOptions?: Omit<RenderHookOptions<unknown>, 'wrapper'> },
) {
  const { settings, renderHookOptions } = options ?? {}
  return renderHook(hook, {
    wrapper: ({ children }) => (
      <TestAppProvider settings={settings}>{children}</TestAppProvider>
    ),
    ...renderHookOptions,
  })
}
