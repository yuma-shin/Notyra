import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SidePanel } from '@/renderer/components/SidePanel'

afterEach(cleanup)
it('restores the active tab, cleans up hidden views and re-renders on reappearance', () => {
  const cleanupA = vi.fn(),
    cleanupB = vi.fn(),
    select = vi.fn()
  const a = {
    id: 'p:a',
    pluginId: 'p',
    title: 'A',
    icon: '<svg/>',
    render: vi.fn(() => cleanupA),
  }
  const b = {
    id: 'p:b',
    pluginId: 'p',
    title: 'B',
    icon: '<svg/>',
    render: vi.fn(() => cleanupB),
  }
  const props = {
    views: [a, b],
    activeViewId: 'p:b',
    onSelectView: select,
    onRenderError: vi.fn(),
    width: 300,
  }
  const result = render(<SidePanel {...props} />)
  expect(b.render).toHaveBeenCalledTimes(1)
  expect(a.render).not.toHaveBeenCalled()
  expect(screen.getByTestId('side-panel')).toHaveStyle({ width: '300px' })
  fireEvent.click(screen.getByRole('tab', { name: 'A' }))
  expect(select).toHaveBeenCalledWith('p:a')
  result.rerender(<SidePanel {...props} activeViewId="p:a" />)
  expect(cleanupB).toHaveBeenCalledTimes(1)
  result.rerender(<SidePanel {...props} />)
  expect(cleanupA).toHaveBeenCalledTimes(1)
  expect(b.render).toHaveBeenCalledTimes(2)
  result.unmount()
  expect(cleanupB).toHaveBeenCalledTimes(2)
})
it('isolates rendering failures and displays an empty state when no views remain', () => {
  const report = vi.fn(),
    failure = new Error('panel failed')
  const view = {
    id: 'p:bad',
    pluginId: 'p',
    title: 'Bad',
    icon: '<svg/>',
    render: () => {
      throw failure
    },
  }
  const props = {
    views: [view],
    onSelectView: vi.fn(),
    onRenderError: report,
    width: 240,
  }
  const result = render(<SidePanel {...props} />)
  expect(screen.getByRole('alert')).toHaveTextContent('panel failed')
  expect(report).toHaveBeenCalledWith('p', failure)
  result.rerender(<SidePanel {...props} views={[]} />)
  expect(screen.queryAllByRole('tab')).toHaveLength(0)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByTestId('side-panel').textContent).not.toBe('')
})
