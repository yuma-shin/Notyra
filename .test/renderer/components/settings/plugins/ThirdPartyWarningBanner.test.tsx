import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react'
import { ThirdPartyWarningBanner } from '@/renderer/components/settings/plugins/ThirdPartyWarningBanner'

describe('ThirdPartyWarningBanner', () => {
  afterEach(() => {
    cleanup()
  })

  it('警告と「了解」ボタンを表示する', () => {
    render(<ThirdPartyWarningBanner onAcknowledge={vi.fn()} />)
    expect(
      screen.getByRole('region', { name: /third-party plugins/i })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'I understand' })).toBeEnabled()
  })

  it('「了解」で onAcknowledge を呼び、実行中はボタンを無効化する', async () => {
    let resolve!: () => void
    const onAcknowledge = vi.fn(
      () =>
        new Promise<void>(r => {
          resolve = r
        })
    )
    render(<ThirdPartyWarningBanner onAcknowledge={onAcknowledge} />)
    const button = screen.getByRole('button', { name: 'I understand' })
    fireEvent.click(button)
    expect(onAcknowledge).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(button).toBeDisabled())
    resolve()
    await waitFor(() => expect(button).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('永続化に失敗したらエラーを表示し、再試行できる', async () => {
    const onAcknowledge = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce({ kind: 'io', message: 'disk full' })
      .mockResolvedValueOnce(undefined)
    render(<ThirdPartyWarningBanner onAcknowledge={onAcknowledge} />)
    const button = screen.getByRole('button', { name: 'I understand' })

    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full')

    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    )
    expect(onAcknowledge).toHaveBeenCalledTimes(2)
  })
})
