import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  within,
} from '@testing-library/react'
import { RepoInstallForm } from '@/renderer/components/settings/plugins/RepoInstallForm'
import type { InstallOutcome } from '@/renderer/lib/plugins/manager/pluginManager'
import { toPluginApiError } from '@/renderer/lib/plugins/pluginError'
import type { PluginStateView } from '@/shared/plugin/types'

const PACKAGE_JSON = JSON.stringify({
  name: 'my-plugin',
  version: '1.0.0',
  notyra: {
    displayName: '<b>My Plugin</b>',
    type: 'feature',
    notyraVersion: '*',
    main: 'index.js',
    permissions: [],
  },
})

const STATE: PluginStateView = {
  schemaVersion: 1,
  thirdPartyWarningAcknowledged: true,
  developerMode: false,
  plugins: [
    {
      id: 'my-plugin',
      version: '1.0.0',
      source: { type: 'github', owner: 'someone', repo: 'my-plugin' },
      enabled: true,
      consentedPermissions: [],
      consentedDestinations: [],
      generation: 0,
      installedAt: '2026-01-01T00:00:00Z',
      packageJson: PACKAGE_JSON,
    },
  ],
}

function setup(
  onInstall: (spec: string) => Promise<InstallOutcome> = vi.fn(),
  disabled = false
) {
  render(<RepoInstallForm disabled={disabled} onInstall={onInstall} />)
  const input = screen.getByLabelText('GitHub repository')
  const button = screen.getByRole('button', { name: 'Install' })
  const type = (value: string) =>
    fireEvent.change(input, { target: { value } })
  const submit = () => fireEvent.click(button)
  return { input, button, type, submit, onInstall }
}

describe('RepoInstallForm', () => {
  afterEach(() => {
    cleanup()
  })

  it.each([
    ['', 'Enter a repository'],
    ['   ', 'Enter a repository'],
    ['not a repo', 'Use the format owner/repo or https://github.com/owner/repo'],
  ])('不正な入力 %j では通信せず入力欄にエラーを表示する', (value, message) => {
    const onInstall = vi.fn<(spec: string) => Promise<InstallOutcome>>()
    const { input, type, submit } = setup(onInstall)
    type(value)
    submit()

    expect(onInstall).not.toHaveBeenCalled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      message
    )
  })

  it('入力を変更すると形式エラーを消す', () => {
    const { input, type, submit } = setup()
    submit()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    type('a')
    expect(input).toHaveAttribute('aria-invalid', 'false')
    expect(input).not.toHaveAttribute('aria-describedby')
  })

  it('成功時は表示名で成功を表示し、入力をクリアする', async () => {
    const onInstall = vi.fn(
      async (): Promise<InstallOutcome> => ({
        status: 'installed',
        id: 'my-plugin',
        state: STATE,
      })
    )
    const { input, type, submit } = setup(onInstall)
    type('  someone/my-plugin ')
    submit()

    expect(onInstall).toHaveBeenCalledWith('  someone/my-plugin ')
    const status = await screen.findByRole('status')
    // Plugin 由来の文言は HTML として挿入しない
    expect(status).toHaveTextContent('Installed <b>My Plugin</b>')
    expect(status.querySelector('b')).toBeNull()
    expect(input).toHaveValue('')
  })

  it('実行中は入力と送信を無効化する', async () => {
    let resolve!: (o: InstallOutcome) => void
    const onInstall = vi.fn(
      () =>
        new Promise<InstallOutcome>(r => {
          resolve = r
        })
    )
    const { input, type, submit } = setup(onInstall)
    type('someone/my-plugin')
    submit()

    await waitFor(() => expect(input).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Installing...' })).toBeDisabled()
    resolve({ status: 'cancelled' })
    await waitFor(() => expect(input).toBeEnabled())
  })

  it('キャンセル時は何も表示せず、入力を保持する', async () => {
    const onInstall = vi.fn(
      async (): Promise<InstallOutcome> => ({ status: 'cancelled' })
    )
    const { input, type, submit } = setup(onInstall)
    type('someone/my-plugin')
    submit()

    await waitFor(() => expect(input).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(input).toHaveValue('someone/my-plugin')
  })

  it.each<[string, InstallOutcome, string]>([
    [
      'repoNotFound',
      {
        status: 'failed',
        error: {
          kind: 'backend',
          error: toPluginApiError({ kind: 'repoNotFound' }),
        },
      },
      'Repository not found',
    ],
    [
      'rateLimited',
      {
        status: 'failed',
        error: {
          kind: 'backend',
          error: toPluginApiError({ kind: 'rateLimited', resetAt: null }),
        },
      },
      'GitHub API rate limit',
    ],
    [
      'alreadyInstalled',
      { status: 'failed', error: { kind: 'alreadyInstalled', id: 'my-plugin' } },
      'my-plugin',
    ],
    [
      'incompatible',
      {
        status: 'failed',
        error: { kind: 'incompatible', range: '^9.0.0', current: '3.2.0' },
      },
      '^9.0.0',
    ],
  ])('%s のエラーを表示する', async (_name, outcome, expected) => {
    const { type, submit } = setup(vi.fn(async () => outcome))
    type('someone/my-plugin')
    submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(expected)
  })

  it('マニフェストエラーはすべて列挙する', async () => {
    const outcome: InstallOutcome = {
      status: 'failed',
      error: {
        kind: 'manifestInvalid',
        errors: [
          {
            category: 'structural',
            code: 'missingField',
            field: 'notyra.displayName',
            value: undefined,
          },
          {
            category: 'value',
            code: 'invalidVersion',
            field: 'version',
            value: 'v1',
          },
          {
            category: 'value',
            code: 'unknownPermission',
            field: 'notyra.permissions[0].name',
            value: 'fs',
          },
        ],
      },
    }
    const { type, submit } = setup(vi.fn(async () => outcome))
    type('someone/my-plugin')
    submit()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('3')
    const items = within(alert).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('notyra.displayName')
    expect(items[1]).toHaveTextContent('"v1"')
    expect(items[2]).toHaveTextContent('"fs"')
  })

  it('disabled のときは入力と送信を無効化する', () => {
    const onInstall = vi.fn<(spec: string) => Promise<InstallOutcome>>()
    const { input, button } = setup(onInstall, true)
    expect(input).toBeDisabled()
    expect(button).toBeDisabled()
  })
})
