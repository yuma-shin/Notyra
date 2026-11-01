import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownToolbar } from '@/renderer/components/editor/MarkdownToolbar'
import type { PluginHostContextValue } from '@/renderer/contexts/PluginHostContext'
import {
  createRegistries,
  type Registries,
} from '@/renderer/lib/plugins/host/registries'

const mocks = vi.hoisted(() => ({
  host: null as PluginHostContextValue | null,
}))

vi.mock('@/renderer/contexts/PluginHostContext', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@/renderer/contexts/PluginHostContext')
  >()),
  usePluginHost: () => mocks.host,
}))

const ICON = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>'

function renderToolbar() {
  const noop = vi.fn()
  return render(
    <MarkdownToolbar
      onApplyAlert={noop}
      onApplyCheckbox={noop}
      onApplyColor={noop}
      onApplyFormat={noop}
      onApplyHeading={noop}
      onApplyList={noop}
      onApplyQuote={noop}
      onApplyTable={noop}
      onToggleAlertPalette={noop}
      onToggleColorPalette={noop}
      onToggleHeadingPalette={noop}
      onToggleTablePicker={noop}
      showAlertPalette={false}
      showColorPalette={false}
      showHeadingPalette={false}
      showTablePicker={false}
    />
  )
}

let registries: Registries
let reportError: ReturnType<typeof vi.fn>

beforeEach(() => {
  registries = createRegistries({ platform: 'other' })
  reportError = vi.fn()
  mocks.host = {
    windowKind: 'main',
    registries,
    host: null,
    reportError,
  }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('MarkdownToolbar の Plugin ボタン', () => {
  it('登録したボタンをラベル付きで描画し、SVG を DOM に挿入しない', () => {
    registries.commands.register('p1', { id: 'go', title: 'Go', run: vi.fn() })
    registries.toolbar.register('p1', {
      command: 'go',
      icon: ICON,
      tooltip: 'Run Go',
    })
    renderToolbar()

    const button = screen.getByRole('button', { name: 'Run Go' })
    expect(button.querySelector('svg')).toBeNull()
    const icon = button.querySelector('span[aria-hidden="true"]') as HTMLElement
    expect(icon.style.backgroundColor).toBe('currentcolor')
  })

  it('ボタンを押すと Plugin_Command を実行する', () => {
    const run = vi.fn()
    registries.commands.register('p1', { id: 'go', title: 'Go', run })
    registries.toolbar.register('p1', {
      command: 'go',
      icon: ICON,
      tooltip: 'Run Go',
    })
    renderToolbar()

    fireEvent.click(screen.getByRole('button', { name: 'Run Go' }))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('実行が失敗したら所有 Plugin のエラーとして報告し、ツールバーは表示を続ける', async () => {
    const error = new Error('boom')
    registries.commands.register('p1', {
      id: 'go',
      title: 'Go',
      run: () => Promise.reject(error),
    })
    registries.toolbar.register('p1', {
      command: 'go',
      icon: ICON,
      tooltip: 'Run Go',
    })
    renderToolbar()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run Go' }))
    })
    expect(reportError).toHaveBeenCalledWith('p1', 'command', error)
    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument()
  })

  it('登録・解除に追従する', () => {
    renderToolbar()
    expect(screen.queryByRole('button', { name: 'Run Go' })).toBeNull()

    let disposable: { dispose(): void } | undefined
    act(() => {
      disposable = registries.toolbar.register('p1', {
        command: 'go',
        icon: ICON,
        tooltip: 'Run Go',
      })
    })
    expect(screen.getByRole('button', { name: 'Run Go' })).toBeInTheDocument()

    act(() => disposable?.dispose())
    expect(screen.queryByRole('button', { name: 'Run Go' })).toBeNull()
  })

  it('PluginHostProvider の外では Plugin のボタンを描画しない', () => {
    mocks.host = null
    renderToolbar()
    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument()
    expect(document.querySelector('[data-plugin-id]')).toBeNull()
  })
})
