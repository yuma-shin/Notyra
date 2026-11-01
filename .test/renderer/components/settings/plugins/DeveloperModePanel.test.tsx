import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import i18n from 'i18next'
import type { ComponentProps } from 'react'
import { DeveloperModePanel } from '@/renderer/components/settings/plugins/DeveloperModePanel'
import type {
  InstallOutcome,
  OperationOutcome,
} from '@/renderer/lib/plugins/manager/pluginManager'
import { PluginApiError } from '@/shared/plugin/api'
import type { PluginStateView } from '@/shared/plugin/types'

const state = {
  schemaVersion: 1,
  thirdPartyWarningAcknowledged: true,
  developerMode: true,
  plugins: [],
} as unknown as PluginStateView

const done: OperationOutcome = { status: 'done', state }

function setup(
  props: Partial<ComponentProps<typeof DeveloperModePanel>> = {}
) {
  const onToggle = vi.fn(async (): Promise<OperationOutcome> => done)
  const onLoadFolder = vi.fn(
    async (): Promise<InstallOutcome> => ({ status: 'cancelled' })
  )
  render(
    <DeveloperModePanel
      developerMode={false}
      onLoadFolder={onLoadFolder}
      onToggle={onToggle}
      {...props}
    />
  )
  return {
    onToggle: (props.onToggle as typeof onToggle | undefined) ?? onToggle,
    onLoadFolder:
      (props.onLoadFolder as typeof onLoadFolder | undefined) ?? onLoadFolder,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

describe('DeveloperModePanel', () => {
  afterEach(async () => {
    cleanup()
    await i18n.changeLanguage('en')
  })

  it('shows the toggle and hides folder selection while developer mode is off (19.1, 19.3)', () => {
    setup()

    const toggle = screen.getByRole('switch', {
      name: 'Enable developer mode',
    })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('Developer mode')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Load plugin from folder/i })
    ).not.toBeInTheDocument()
  })

  it('requests the opposite state when the toggle is clicked (19.2)', async () => {
    const { onToggle } = setup()

    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => expect(onToggle).toHaveBeenCalledWith(true))
    await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled())
  })

  it('shows folder selection while developer mode is on and runs it on click (19.3)', async () => {
    const { onToggle, onLoadFolder } = setup({ developerMode: true })

    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith(false))

    fireEvent.click(
      await screen.findByRole('button', { name: /Load plugin from folder/i })
    )
    await waitFor(() => expect(onLoadFolder).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables the toggle and folder selection when disabled (1.5)', () => {
    const { onToggle, onLoadFolder } = setup({
      developerMode: true,
      disabled: true,
    })

    const toggle = screen.getByRole('switch')
    const load = screen.getByRole('button', {
      name: /Load plugin from folder/i,
    })
    expect(toggle).toBeDisabled()
    expect(load).toBeDisabled()

    fireEvent.click(toggle)
    fireEvent.click(load)
    expect(onToggle).not.toHaveBeenCalled()
    expect(onLoadFolder).not.toHaveBeenCalled()
  })

  it('shows the loading label and disables controls while loading', async () => {
    const pending = deferred<InstallOutcome>()
    const onLoadFolder = vi.fn(() => pending.promise)
    setup({ developerMode: true, onLoadFolder })

    fireEvent.click(
      screen.getByRole('button', { name: /Load plugin from folder/i })
    )

    const loading = await screen.findByRole('button', { name: /Loading/ })
    expect(loading).toBeDisabled()
    expect(loading).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('switch')).toBeDisabled()

    await act(async () => {
      pending.resolve({ status: 'cancelled' })
    })
    expect(
      screen.getByRole('button', { name: /Load plugin from folder/i })
    ).toBeEnabled()
  })

  it('shows a failed load outcome with the default formatter', async () => {
    const onLoadFolder = vi.fn(
      async (): Promise<InstallOutcome> => ({
        status: 'failed',
        error: { kind: 'alreadyInstalled', id: 'notyra-toc' },
      })
    )
    setup({ developerMode: true, onLoadFolder })

    fireEvent.click(
      screen.getByRole('button', { name: /Load plugin from folder/i })
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('plugins.errors.alreadyInstalledWithId', { id: 'notyra-toc' })
    )
  })

  it('formats incompatible and backend errors', async () => {
    const outcomes: InstallOutcome[] = [
      {
        status: 'failed',
        error: { kind: 'incompatible', range: '^9.0.0', current: '3.2.0' },
      },
      {
        status: 'failed',
        error: {
          kind: 'backend',
          error: new PluginApiError('io', 'disk full', {
            kind: 'io',
            message: 'disk full',
          }),
        },
      },
    ]
    const onLoadFolder = vi.fn(async () => outcomes.shift() as InstallOutcome)
    setup({ developerMode: true, onLoadFolder })
    const load = () =>
      fireEvent.click(
        screen.getByRole('button', { name: /Load plugin from folder/i })
      )

    load()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('^9.0.0')
    expect(alert).toHaveTextContent('3.2.0')

    load()
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        i18n.t('plugins.errors.io', { message: 'disk full' })
      )
    )
  })

  it('uses the formatError prop when provided and clears the error on the next success', async () => {
    const onToggle = vi
      .fn<(enabled: boolean) => Promise<OperationOutcome>>()
      .mockResolvedValueOnce({
        status: 'failed',
        error: { kind: 'developerModeDisabled' },
      })
      .mockResolvedValueOnce(done)
    const formatError = vi.fn(() => 'custom message')
    setup({ onToggle, formatError })

    fireEvent.click(screen.getByRole('switch'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'custom message'
    )
    expect(formatError).toHaveBeenCalledWith({ kind: 'developerModeDisabled' })

    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    )
  })

  it('displays Notyra-defined text in Japanese (1.9)', async () => {
    await i18n.changeLanguage('ja')
    setup({ developerMode: true })

    expect(
      screen.getByRole('switch', { name: '開発者モードを有効にする' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /フォルダからプラグインを読み込む/ })
    ).toBeInTheDocument()
  })
})
