import { afterEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { idArb, runs } from '../../../../helpers/pluginArbitraries'

// Feature: plugin-system, Property 7: レジストリ一覧の表示モデル
it('Property 7: preserves filtered order and shows install actions only for uninstalled IDs', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(idArb, { minLength: 1, maxLength: 7 }),
      fc.array(fc.boolean(), { minLength: 7, maxLength: 7 }),
      fc.constantFrom('', ' NAME ', 'missing', 'description'),
      async (ids, flags, query) => {
        const entries = ids.map((id, i) => ({
          id,
          name: `Name ${id}`,
          description: i % 2 ? 'Description of plugin' : 'Other',
          author: id,
          repo: `o/${id}`,
        }))
        const installedIds = new Set(ids.filter((_, i) => flags[i]))
        try {
          await act(async () => {
            renderList({
              fetchRegistry: async () => registryJson(entries),
              installedIds,
            })
          })
          fireEvent.change(screen.getByRole('searchbox'), {
            target: { value: query },
          })
          const q = query.trim().toLowerCase()
          const expected = entries.filter(
            e =>
              !q ||
              e.name.toLowerCase().includes(q) ||
              e.description.toLowerCase().includes(q)
          )
          const rows = screen.queryAllByTestId('registry-entry')
          expect(rows.map(row => row.getAttribute('data-plugin-id'))).toEqual(
            expected.map(e => e.id)
          )
          rows.forEach((row, i) => {
            expect(
              within(row).queryByTestId('registry-entry-installed') !== null
            ).toBe(installedIds.has(expected[i].id))
            expect(
              within(row).queryByTestId('registry-entry-install') !== null
            ).toBe(!installedIds.has(expected[i].id))
          })
        } finally {
          cleanup()
        }
      }
    ),
    runs
  )
})
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import i18n from 'i18next'
import {
  RegistryList,
  type RegistryListProps,
  repositoryUrl,
} from '@/renderer/components/settings/plugins/RegistryList'
import type { RegistryEntry } from '@/shared/plugin/types'

const ENTRIES: RegistryEntry[] = [
  {
    id: 'notyra-toc',
    name: 'Table of Contents',
    description: 'Shows headings in the side panel',
    author: 'Jane Doe',
    repo: 'jane/notyra-toc',
  },
  {
    id: 'notyra-word-count',
    name: 'Word Count',
    description: 'Counts words in the active note',
    author: 'John Roe',
    repo: 'john/notyra-word-count',
  },
  {
    id: 'notyra-raw',
    name: '<b>plugins.registry.install</b>',
    description: '{{author}} literal',
    author: '<img src=x>',
    repo: 'https://github.com/raw/notyra-raw.git',
  },
]

function registryJson(entries: RegistryEntry[] = ENTRIES): string {
  return JSON.stringify({ schemaVersion: 1, plugins: entries })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderList(props: Partial<RegistryListProps> = {}) {
  const fetchRegistry =
    props.fetchRegistry ?? vi.fn(() => Promise.resolve(registryJson()))
  const onInstall = props.onInstall ?? vi.fn(() => Promise.resolve())
  const openExternal = props.openExternal ?? vi.fn()
  const utils = render(
    <RegistryList
      disabled={props.disabled}
      fetchRegistry={fetchRegistry}
      installedIds={props.installedIds ?? new Set()}
      onInstall={onInstall}
      openExternal={openExternal}
    />
  )
  return { ...utils, fetchRegistry, onInstall, openExternal }
}

function entryById(id: string): HTMLElement {
  const el = screen
    .getAllByTestId('registry-entry')
    .find(e => e.getAttribute('data-plugin-id') === id)
  if (!el) throw new Error(`entry ${id} not found`)
  return el
}

describe('RegistryList', () => {
  afterEach(async () => {
    cleanup()
    await i18n.changeLanguage('en')
  })

  it('fetches the registry on mount and shows a loading state until it resolves', async () => {
    const pending = deferred<string>()
    const fetchRegistry = vi.fn(() => pending.promise)
    renderList({ fetchRegistry })

    expect(fetchRegistry).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('registry-loading')).toBeInTheDocument()

    await act(async () => pending.resolve(registryJson()))

    expect(screen.queryByTestId('registry-loading')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('registry-entry')).toHaveLength(3)
  })

  it('shows name, description, author and a repository link for each entry', async () => {
    const { openExternal } = renderList()
    const item = await screen.findByText('Table of Contents')
    const entry = item.closest('li') as HTMLElement

    expect(
      within(entry).getByText('Shows headings in the side panel')
    ).toBeInTheDocument()
    expect(within(entry).getByText('By Jane Doe')).toBeInTheDocument()

    const link = within(entry).getByRole('link', {
      name: 'Open jane/notyra-toc',
    })
    expect(link).toHaveAttribute('href', 'https://github.com/jane/notyra-toc')
    fireEvent.click(link)
    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/jane/notyra-toc'
    )
  })

  it('renders plugin-provided text verbatim without translating or parsing HTML', async () => {
    renderList()
    await screen.findAllByTestId('registry-entry')
    const entry = entryById('notyra-raw')

    expect(within(entry).getByTestId('registry-entry-name').textContent).toBe(
      '<b>plugins.registry.install</b>'
    )
    expect(
      within(entry).getByTestId('registry-entry-description').textContent
    ).toBe('{{author}} literal')
    expect(within(entry).getByTestId('registry-entry-author').textContent).toBe(
      'By <img src=x>'
    )
    expect(entry.querySelector('b')).toBeNull()
    expect(entry.querySelector('img')).toBeNull()
    // GitHub URL 形式の repo も正規化したリンクになる
    expect(within(entry).getByRole('link')).toHaveAttribute(
      'href',
      'https://github.com/raw/notyra-raw'
    )
  })

  it('marks installed entries and shows install buttons only for the others', async () => {
    renderList({ installedIds: new Set(['notyra-word-count']) })
    await screen.findAllByTestId('registry-entry')

    const installed = entryById('notyra-word-count')
    expect(
      within(installed).getByTestId('registry-entry-installed')
    ).toHaveTextContent('Installed')
    expect(
      within(installed).queryByTestId('registry-entry-install')
    ).not.toBeInTheDocument()

    const notInstalled = entryById('notyra-toc')
    expect(
      within(notInstalled).getByTestId('registry-entry-install')
    ).toHaveTextContent(/^Install$/)
    expect(
      within(notInstalled).queryByTestId('registry-entry-installed')
    ).not.toBeInTheDocument()
  })

  it('filters by name or description, case-insensitively and ignoring surrounding spaces', async () => {
    renderList()
    await screen.findAllByTestId('registry-entry')
    const search = screen.getByRole('searchbox')

    fireEvent.change(search, { target: { value: '  WORD ' } })
    expect(
      screen.getAllByTestId('registry-entry').map(e => e.dataset.pluginId)
    ).toEqual(['notyra-word-count'])

    fireEvent.change(search, { target: { value: 'headings' } })
    expect(
      screen.getAllByTestId('registry-entry').map(e => e.dataset.pluginId)
    ).toEqual(['notyra-toc'])

    fireEvent.change(search, { target: { value: 'no such plugin' } })
    expect(screen.queryByTestId('registry-entry')).not.toBeInTheDocument()
    expect(screen.getByTestId('registry-search-empty')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: '   ' } })
    expect(
      screen.getAllByTestId('registry-entry').map(e => e.dataset.pluginId)
    ).toEqual(['notyra-toc', 'notyra-word-count', 'notyra-raw'])
  })

  it('shows an empty state when the registry has no plugins', async () => {
    renderList({
      fetchRegistry: vi.fn(() => Promise.resolve(registryJson([]))),
    })
    expect(await screen.findByTestId('registry-empty')).toBeInTheDocument()
  })

  it('calls onInstall with the entry and disables install buttons while installing', async () => {
    const pending = deferred<void>()
    const onInstall = vi.fn(() => pending.promise)
    renderList({ onInstall })
    await screen.findAllByTestId('registry-entry')

    const target = within(entryById('notyra-toc')).getByTestId(
      'registry-entry-install'
    )
    fireEvent.click(target)

    expect(onInstall).toHaveBeenCalledTimes(1)
    expect(onInstall).toHaveBeenCalledWith(ENTRIES[0])
    expect(target).toHaveTextContent('Installing...')
    expect(target).toBeDisabled()
    expect(
      within(entryById('notyra-word-count')).getByTestId(
        'registry-entry-install'
      )
    ).toBeDisabled()

    await act(async () => pending.resolve())

    expect(target).toHaveTextContent(/^Install$/)
    expect(target).toBeEnabled()
  })

  it('re-enables install buttons when onInstall rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pending = deferred<void>()
    renderList({ onInstall: vi.fn(() => pending.promise) })
    await screen.findAllByTestId('registry-entry')
    const target = within(entryById('notyra-toc')).getByTestId(
      'registry-entry-install'
    )

    fireEvent.click(target)
    await act(async () => pending.reject(new Error('failed')))

    expect(target).toBeEnabled()
    expect(target).toHaveTextContent(/^Install$/)
    consoleError.mockRestore()
  })

  it('disables install buttons when disabled is set', async () => {
    const { onInstall } = renderList({ disabled: true })
    await screen.findAllByTestId('registry-entry')

    for (const button of screen.getAllByTestId('registry-entry-install')) {
      expect(button).toBeDisabled()
      fireEvent.click(button)
    }
    expect(onInstall).not.toHaveBeenCalled()
  })

  it('shows an error, a retry button and the repository hint when fetching fails, and retries', async () => {
    const fetchRegistry = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(registryJson())
    renderList({ fetchRegistry })

    const error = await screen.findByTestId('registry-error')
    expect(error).toHaveAttribute('role', 'alert')
    expect(
      within(error).getByText('Could not load the plugin list')
    ).toBeInTheDocument()
    expect(within(error).getByText('connection refused')).toBeInTheDocument()
    expect(
      within(error).getByTestId('registry-unavailable-hint')
    ).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()

    fireEvent.click(within(error).getByRole('button', { name: 'Retry' }))

    expect(fetchRegistry).toHaveBeenCalledTimes(2)
    expect(await screen.findAllByTestId('registry-entry')).toHaveLength(3)
    expect(screen.queryByTestId('registry-error')).not.toBeInTheDocument()
  })

  it('treats a registry that fails to parse as an error', async () => {
    renderList({
      fetchRegistry: vi.fn(() =>
        Promise.resolve(
          JSON.stringify({ schemaVersion: 1, plugins: [{ id: 'x' }] })
        )
      ),
    })

    const error = await screen.findByTestId('registry-error')
    expect(
      within(error).getByText('The plugin list has an invalid format')
    ).toBeInTheDocument()
    expect(within(error).getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(screen.queryByTestId('registry-entry')).not.toBeInTheDocument()
  })

  it('switches Notyra-defined text with the UI language', async () => {
    await i18n.changeLanguage('ja')
    renderList({ installedIds: new Set(['notyra-toc']) })
    await screen.findAllByTestId('registry-entry')

    expect(screen.getByText('プラグインを探す')).toBeInTheDocument()
    expect(
      within(entryById('notyra-toc')).getByText('インストール済み')
    ).toBeInTheDocument()
    expect(
      within(entryById('notyra-word-count')).getByText('作者: John Roe')
    ).toBeInTheDocument()
  })
})

describe('repositoryUrl', () => {
  it('builds a GitHub URL from owner/repo and GitHub URL forms', () => {
    expect(repositoryUrl('jane/notyra-toc')).toBe(
      'https://github.com/jane/notyra-toc'
    )
    expect(repositoryUrl('https://github.com/jane/notyra-toc/')).toBe(
      'https://github.com/jane/notyra-toc'
    )
    expect(repositoryUrl('not a repo')).toBeNull()
  })
})
