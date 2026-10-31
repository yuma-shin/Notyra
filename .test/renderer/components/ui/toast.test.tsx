import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Toast } from '@/renderer/components/ui/toast'

afterEach(() => { cleanup(); vi.useRealTimers() })
it('uses alert for errors and status for other messages, and dismisses after five seconds', async () => {
  vi.useFakeTimers()
  const dismiss = vi.fn()
  const item = { id: 't', kind: 'error' as const, message: 'Failure', duration: 5000 }
  const result = render(<Toast item={item} onDismiss={dismiss} closeLabel="Close" />)
  expect(screen.getByRole('alert')).toHaveTextContent('Failure')
  await vi.advanceTimersByTimeAsync(4999)
  expect(dismiss).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(dismiss).toHaveBeenCalledWith('t')
  result.rerender(<Toast item={{ ...item, kind: 'info' }} onDismiss={dismiss} closeLabel="Close" />)
  expect(screen.getByRole('status')).toHaveTextContent('Failure')
})
it('allows manual dismissal and cancels timers on unmount', async () => {
  vi.useFakeTimers()
  const dismiss = vi.fn()
  const result = render(<Toast item={{ id: 't', kind: 'success', message: 'Done', duration: 5000 }} onDismiss={dismiss} closeLabel="Close" />)
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(dismiss).toHaveBeenCalledWith('t')
  result.unmount()
  await vi.advanceTimersByTimeAsync(5000)
  expect(dismiss).toHaveBeenCalledTimes(1)
})
