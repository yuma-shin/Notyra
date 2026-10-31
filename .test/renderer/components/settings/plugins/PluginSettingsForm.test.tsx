import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react'
import { PluginSettingsForm } from '@/renderer/components/settings/plugins/PluginSettingsForm'
import type { SettingDeclaration, SettingValue } from '@/shared/plugin/types'

const SETTINGS: SettingDeclaration[] = [
  {
    key: 'prefix',
    title: 'Prefix',
    description: '{{name}} は翻訳しない',
    type: 'string',
    default: '#',
  },
  { key: 'depth', title: 'Depth', type: 'number', default: 3 },
  { key: 'numbers', title: 'Show numbers', type: 'boolean', default: false },
  {
    key: 'style',
    title: 'Style',
    type: 'select',
    default: 'plain',
    options: [
      { value: 'plain', label: 'Plain' },
      { value: 'fancy', label: 'plugins.installed.title' },
    ],
  },
]

function setup(stored: Record<string, unknown> = {}) {
  const saveSetting = vi.fn(
    async (_id: string, _key: string, _value: SettingValue) => {}
  )
  const loadSettings = vi.fn(async () => stored)
  render(
    <PluginSettingsForm
      displayName="My Plugin"
      loadSettings={loadSettings}
      pluginId="my-plugin"
      saveSetting={saveSetting}
      settings={SETTINGS}
    />
  )
  return { saveSetting, loadSettings }
}

async function waitLoaded() {
  await waitFor(() => expect(screen.getByLabelText('Prefix')).toBeEnabled())
}

describe('PluginSettingsForm', () => {
  afterEach(() => {
    cleanup()
  })

  it('保存値と既定値（未保存・型不一致）で4種類の入力欄を表示する', async () => {
    const { loadSettings } = setup({ prefix: '>', depth: 'not-a-number' })
    await waitLoaded()
    expect(loadSettings).toHaveBeenCalledWith('my-plugin')
    expect(screen.getByLabelText('Prefix')).toHaveValue('>')
    expect(screen.getByLabelText('Depth')).toHaveValue('3')
    expect(screen.getByLabelText('Show numbers')).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(screen.getByLabelText('Style')).toHaveValue('plain')
  })

  it('Plugin 由来の文言を翻訳せずに表示する', async () => {
    setup()
    await waitLoaded()
    expect(screen.getByText('{{name}} は翻訳しない')).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'plugins.installed.title' })
    ).toBeInTheDocument()
  })

  it('型に合う入力は入力のたびに保存する', async () => {
    const { saveSetting } = setup()
    await waitLoaded()
    fireEvent.change(screen.getByLabelText('Prefix'), {
      target: { value: '' },
    })
    fireEvent.change(screen.getByLabelText('Depth'), {
      target: { value: '2.5' },
    })
    fireEvent.click(screen.getByLabelText('Show numbers'))
    fireEvent.change(screen.getByLabelText('Style'), {
      target: { value: 'fancy' },
    })
    expect(saveSetting.mock.calls).toEqual([
      ['my-plugin', 'prefix', ''],
      ['my-plugin', 'depth', 2.5],
      ['my-plugin', 'numbers', true],
      ['my-plugin', 'style', 'fancy'],
    ])
  })

  it('数値型に不正な値（空文字を含む）を入力するとエラーを表示して保存しない', async () => {
    const { saveSetting } = setup()
    await waitLoaded()
    const depth = screen.getByLabelText('Depth')
    for (const value of ['abc', '', '  ', 'Infinity']) {
      fireEvent.change(depth, { target: { value } })
      expect(depth).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByText('Enter a number')).toBeInTheDocument()
    }
    expect(saveSetting).not.toHaveBeenCalled()

    fireEvent.change(depth, { target: { value: '4' } })
    expect(depth).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText('Enter a number')).toBeNull()
    expect(saveSetting).toHaveBeenCalledWith('my-plugin', 'depth', 4)
  })

  it('保存に失敗したらエラーを表示する', async () => {
    const saveSetting = vi.fn(async () => {
      throw new Error('disk full')
    })
    render(
      <PluginSettingsForm
        displayName="My Plugin"
        loadSettings={async () => ({})}
        pluginId="my-plugin"
        saveSetting={saveSetting}
        settings={SETTINGS}
      />
    )
    await waitLoaded()
    fireEvent.change(screen.getByLabelText('Prefix'), {
      target: { value: 'x' },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save the setting: disk full'
    )
  })

  it('設定項目がなければその旨を表示する', () => {
    render(
      <PluginSettingsForm
        displayName="My Plugin"
        loadSettings={async () => ({})}
        pluginId="my-plugin"
        saveSetting={async () => {}}
        settings={[]}
      />
    )
    expect(
      screen.getByText('This plugin has no settings')
    ).toBeInTheDocument()
  })
})
