import { describe, it, expect, vi, afterEach } from 'vitest'
import fc from 'fast-check'
import { permissionsArb, runs } from '../../../../helpers/pluginArbitraries'
import i18n from 'i18next'
import { permissionKey } from '@/renderer/components/settings/plugins/ConsentDialog'

// Feature: plugin-system, Property 11: Consent_Dialog の表示内容
it('Property 11: displays metadata, permission descriptions, purposes and classified destinations', () => {
  fc.assert(
    fc.property(
      permissionsArb,
      fc.string(),
      fc.boolean(),
      (permissions, text, publicNetwork) => {
        const request: ConsentRequest = {
          ...base,
          displayName: `Name ${text}`,
          author: `Author ${text}`,
          permissions: permissions.map(name => ({
            name,
            purpose: `Purpose ${text}`,
          })),
          destinations: permissions.includes('network')
            ? [
                {
                  dest: publicNetwork ? 'api.example.com' : 'localhost:3000',
                  class: publicNetwork ? 'public' : 'private',
                },
              ]
            : [],
        }
        try {
          renderDialog(request)
          expect(document.body.textContent).toContain(request.displayName)
          expect(screen.getByTestId('consent-author').textContent).toBe(
            request.author
          )
          expect(screen.getByTestId('consent-source').textContent).toContain(
            'someone/my-plugin'
          )
          permissions.forEach(permission => {
            const row = document.querySelector(
              `[data-permission="${permission}"]`
            )
            expect(row?.textContent).toContain(
              i18n.t(`${permissionKey(permission)}.description`)
            )
            expect(row?.textContent).toContain(`Purpose ${text}`)
          })
          expect(screen.queryByTestId('consent-no-permissions') !== null).toBe(
            permissions.length === 0
          )
          expect(screen.queryByTestId('consent-public-warning') !== null).toBe(
            permissions.includes('network') && publicNetwork
          )
          if (permissions.includes('network') && publicNetwork)
            expect(
              screen.getByTestId('consent-public-destinations').textContent
            ).toContain('api.example.com')
          expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
          expect(document.querySelectorAll('button')).toHaveLength(3) // close, cancel, agree
        } finally {
          cleanup()
        }
      }
    ),
    runs
  )
})
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
  within,
} from '@testing-library/react'
import {
  ConsentDialog,
  useConsentDialog,
} from '@/renderer/components/settings/plugins/ConsentDialog'
import type { ConsentRequest } from '@/shared/plugin/types'

const base: ConsentRequest = {
  mode: 'install',
  displayName: 'My Plugin',
  author: 'Jane Doe',
  source: { type: 'github', owner: 'someone', repo: 'my-plugin' },
  permissions: [],
  destinations: [],
}

function renderDialog(request: ConsentRequest, onResult = vi.fn()) {
  render(<ConsentDialog onResult={onResult} open={true} request={request} />)
  return onResult
}

describe('ConsentDialog', () => {
  afterEach(() => {
    cleanup()
  })

  it('表示名・作者・取得元と、Permission 0件の旨を表示する', () => {
    renderDialog(base)
    expect(screen.getByText('Install "My Plugin"')).toBeInTheDocument()
    expect(screen.getByTestId('consent-author')).toHaveTextContent('Jane Doe')
    expect(screen.getByTestId('consent-source')).toHaveTextContent(
      'GitHub: someone/my-plugin'
    )
    expect(screen.getByTestId('consent-no-permissions')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Agree and install' })
    ).toBeInTheDocument()
  })

  it('Permission の説明と Permission_Purpose を表示する', () => {
    renderDialog({
      ...base,
      permissions: [
        { name: 'notes:read', purpose: '目次を作るため' },
        { name: 'clipboard' },
      ],
    })
    const list = screen.getByTestId('consent-permissions')
    expect(within(list).getByText('Read notes')).toBeInTheDocument()
    expect(within(list).getByText('Clipboard')).toBeInTheDocument()
    expect(screen.getAllByTestId('consent-purpose')).toHaveLength(1)
    expect(screen.getByTestId('consent-purpose')).toHaveTextContent(
      'Purpose: 目次を作るため'
    )
    expect(screen.queryByTestId('consent-no-permissions')).toBeNull()
  })

  it('Public_Destination があれば警告と一覧を表示する', () => {
    renderDialog({
      ...base,
      permissions: [{ name: 'network' }],
      destinations: [
        { dest: '*.example.com', class: 'public' },
        { dest: 'localhost:8080', class: 'private' },
      ],
    })
    expect(screen.getByTestId('consent-public-warning')).toBeInTheDocument()
    expect(screen.getByTestId('consent-public-destinations')).toHaveTextContent(
      '*.example.com'
    )
    expect(screen.queryByTestId('consent-private-network')).toBeNull()
  })

  it('すべて Private ならローカル通信として表示し警告を省略する', () => {
    renderDialog({
      ...base,
      permissions: [{ name: 'network' }],
      destinations: [{ dest: '192.168.1.10', class: 'private' }],
    })
    expect(screen.queryByTestId('consent-public-warning')).toBeNull()
    expect(screen.getByTestId('consent-private-network')).toBeInTheDocument()
  })

  it('Plugin 由来の文言を HTML として解釈しない', () => {
    const { container } = render(
      <ConsentDialog
        onResult={vi.fn()}
        open={true}
        request={{ ...base, author: '<img src=x onerror=alert(1)>' }}
      />
    )
    expect(screen.getByTestId('consent-author')).toHaveTextContent(
      '<img src=x onerror=alert(1)>'
    )
    expect(container.ownerDocument.querySelector('img')).toBeNull()
  })

  it('update では追加分の見出しと更新用ボタンを表示する', () => {
    renderDialog({
      ...base,
      mode: 'update',
      permissions: [{ name: 'notes:write' }],
    })
    expect(screen.getByText('Update "My Plugin"')).toBeInTheDocument()
    expect(
      screen.getByText(
        'The new version requests the following additional permissions'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Agree and update' })
    ).toBeInTheDocument()
  })

  it('同意で true、キャンセル・×で false を返す', () => {
    const onResult = renderDialog(base)
    fireEvent.click(screen.getByRole('button', { name: 'Agree and install' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByTestId('consent-dialog-close'))
    expect(onResult.mock.calls).toEqual([[true], [false], [false]])
  })

  it('Esc で false を返す', async () => {
    const onResult = renderDialog(base)
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
  })
})

describe('useConsentDialog', () => {
  afterEach(() => {
    cleanup()
  })

  function setup() {
    let api: ReturnType<typeof useConsentDialog> | null = null
    function Harness() {
      api = useConsentDialog()
      return api.dialog
    }
    const view = render(<Harness />)
    return {
      get api() {
        if (!api) throw new Error('not rendered')
        return api
      },
      view,
    }
  }

  it('同意すると Promise が true で解決する', async () => {
    const h = setup()
    let promise!: Promise<boolean>
    act(() => {
      promise = h.api.requestConsent(base)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Agree and install' }))
    await expect(promise).resolves.toBe(true)
  })

  it('新しい要求で先の要求は false、アンマウントで未解決は false', async () => {
    const h = setup()
    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = h.api.requestConsent(base)
    })
    act(() => {
      second = h.api.requestConsent({ ...base, displayName: 'Other' })
    })
    await expect(first).resolves.toBe(false)
    h.view.unmount()
    await expect(second).resolves.toBe(false)
  })
})
