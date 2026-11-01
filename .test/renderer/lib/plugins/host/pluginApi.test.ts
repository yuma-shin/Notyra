import { EditorState } from '@codemirror/state'
import fc from 'fast-check'
import {
  idArb,
  permissionsArb,
  runs,
} from '../../../../helpers/pluginArbitraries'

// Feature: plugin-system, Property 14: 権限ゲート
it('Property 14: rejects every privileged API before calling the backend when permission is missing', async () => {
  await fc.assert(
    fc.asyncProperty(permissionsArb, async permissions => {
      const s = setup({ permissions })
      const calls = [
        [
          'clipboard',
          () => s.api.clipboard.readText(),
          s.backend.clipboardRead,
        ],
        [
          'clipboard',
          () => s.api.clipboard.writeText('x'),
          s.backend.clipboardWrite,
        ],
        [
          'shell:openExternal',
          () => s.api.shell.openExternal('https://example.com'),
          s.backend.openExternal,
        ],
        [
          'network',
          () => s.api.network.fetch('https://api.example.com'),
          s.backend.httpRequest,
        ],
        [
          'notes:read',
          () => s.api.notes.listRootFolders(),
          s.backend.notes.listRoots,
        ],
        ['notes:read', () => s.api.notes.list('/notes'), s.backend.notes.list],
        [
          'notes:read',
          () => s.api.notes.read('/notes/a.md'),
          s.backend.notes.read,
        ],
        [
          'notes:write',
          () => s.api.notes.create({ rootFolder: '/notes', title: 'a' }),
          s.backend.notes.create,
        ],
        [
          'notes:write',
          () =>
            s.api.notes.update('/notes/a.md', { body: 'b', frontMatter: {} }),
          s.backend.notes.update,
        ],
        [
          'notes:write',
          () => s.api.notes.rename('/notes/a.md', 'b'),
          s.backend.notes.rename,
        ],
        [
          'notes:write',
          () => s.api.notes.move('/notes', '/notes/a.md', 'x'),
          s.backend.notes.move,
        ],
        [
          'notes:write',
          () => s.api.notes.delete('/notes/a.md'),
          s.backend.notes.delete,
        ],
      ] as const
      for (const [permission, call, backend] of calls) {
        if (permissions.includes(permission)) {
          await call()
          expect(backend).toHaveBeenCalled()
        } else {
          await expect(call()).rejects.toMatchObject({
            kind: 'permissionDenied',
          })
          expect(backend).not.toHaveBeenCalled()
        }
      }
      expect(() => s.api.styles.add('body {}')).not.toThrow()
      expect(() => s.api.events.onActiveNoteChange(() => {})).not.toThrow()
      s.getSession()?.disposeAll()
    }),
    runs
  )
})

// Feature: plugin-system, Property 15: 外部 URL のスキーム制限
it('Property 15: opens only http, https and mailto URLs', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom(
        'http',
        'https',
        'mailto',
        'file',
        'javascript',
        'data',
        'ftp',
        'ws',
        'custom'
      ),
      idArb,
      async (scheme, value) => {
        const s = setup({ permissions: ['shell:openExternal'] })
        const url =
          scheme === 'mailto'
            ? `mailto:${value}@example.com`
            : `${scheme}://example.com/${value}`
        if (['http', 'https', 'mailto'].includes(scheme)) {
          await s.api.shell.openExternal(url)
          expect(s.backend.openExternal).toHaveBeenCalled()
        } else {
          await expect(s.api.shell.openExternal(url)).rejects.toMatchObject({
            kind: 'schemeNotAllowed',
          })
          expect(s.backend.openExternal).not.toHaveBeenCalled()
        }
        s.getSession()?.disposeAll()
      }
    ),
    runs
  )
})

// Feature: plugin-system, Property 31: ID の接頭辞付与
it('Property 31: qualifies command and panel IDs exactly once', () => {
  fc.assert(
    fc.property(idArb, local => {
      const s = setup()
      s.api.commands.register({ id: local, title: local, run: () => {} })
      s.api.sidePanel.registerView({
        id: local,
        title: local,
        icon: '<svg/>',
        render: () => {},
      })
      expect(s.registries.commands.getCommands()[0].id).toBe(
        `${PLUGIN}:${local}`
      )
      expect(s.registries.sidePanel.getViews()[0].id).toBe(`${PLUGIN}:${local}`)
      s.getSession()?.disposeAll()
    }),
    runs
  )
})
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPluginApi,
  decodeBase64,
  encodeBase64,
  findContainingRoot,
  noteNameFromPath,
  normalizePathLexically,
  type PluginApiBackend,
  type PluginApiDeps,
  toPluginResponse,
} from '@/renderer/lib/plugins/host/pluginApi'
import {
  createRegistries,
  PLUGIN_STYLE_ATTRIBUTE,
} from '@/renderer/lib/plugins/host/registries'
import { PluginSession } from '@/renderer/lib/plugins/host/session'
import { SHARED_MODULES } from '@/renderer/lib/plugins/host/sharedModules'
import { PluginApiError } from '@/shared/plugin/api'
import type { Permission, SettingDeclaration } from '@/shared/plugin/types'

const PLUGIN = 'toc'

function createBackend(roots: readonly string[] = ['/notes']): PluginApiBackend {
  return {
    clipboardRead: vi.fn(async () => 'clip'),
    clipboardWrite: vi.fn(async () => {}),
    openExternal: vi.fn(async () => {}),
    httpRequest: vi.fn(async () => ({
      status: 200,
      headers: [] as Array<[string, string]>,
      bodyBase64: '',
      url: 'https://api.example.com/',
    })),
    notes: {
      resolveRoot: vi.fn(async (_id: string, path: string) => {
        const root = findContainingRoot(path, roots)
        if (root === null) throw new PluginApiError('outOfScope', 'outside roots', { path })
        return root
      }),
      listRoots: vi.fn(async () => ['/notes']),
      list: vi.fn(async () => []),
      read: vi.fn(async (_id: string, path: string) => ({
        path,
        body: 'b',
        frontMatter: {},
      })),
      create: vi.fn(async () => '/notes/a.md'),
      update: vi.fn(async () => {}),
      rename: vi.fn(async () => '/notes/b.md'),
      move: vi.fn(async () => '/notes/x/a.md'),
      delete: vi.fn(async () => {}),
    },
  }
}

interface Setup {
  permissions?: Permission[]
  declarations?: SettingDeclaration[]
  roots?: string[]
  confirm?: boolean
}

function setup(options: Setup = {}) {
  const registries = createRegistries({ platform: 'other', document })
  const backend = createBackend(options.roots)
  let session: PluginSession | null = new PluginSession(PLUGIN)
  let permissions = options.permissions ?? []
  const confirmDelete = vi.fn(async () => options.confirm ?? true)
  const onRegistrationError = vi.fn()
  const deps: PluginApiDeps = {
    backend,
    registries,
    appVersion: '3.2.0',
    getSession: () => session,
    getConsentedPermissions: () => permissions,
    getDisplayName: () => '目次',
    getSettingDeclarations: () => options.declarations ?? [],
    getRootFolders: () => options.roots ?? ['/notes'],
    confirmDelete,
    onRegistrationError,
  }
  const api = createPluginApi(PLUGIN, deps)
  return {
    api,
    registries,
    backend,
    confirmDelete,
    onRegistrationError,
    getSession: () => session,
    setSession: (s: PluginSession | null) => {
      session = s
    },
    setPermissions: (p: Permission[]) => {
      permissions = p
    },
  }
}

afterEach(() => {
  for (const el of document.head.querySelectorAll(
    `style[${PLUGIN_STYLE_ATTRIBUTE}]`
  )) {
    el.remove()
  }
  vi.useRealTimers()
})

describe('createPluginApi: basics', () => {
  it('exposes pluginId, apiVersion and the shared modules', () => {
    const { api } = setup()
    expect(api.pluginId).toBe(PLUGIN)
    expect(api.apiVersion).toBe('3.2.0')
    expect(api.modules).toBe(SHARED_MODULES)
  })
})

describe('createPluginApi: registrations and the session', () => {
  it('passes local IDs to the registries without adding a second prefix', () => {
    const { api, registries } = setup()
    api.sidePanel.registerView({
      id: 'outline',
      title: 'Outline',
      icon: '<svg/>',
      render: () => {},
    })
    api.commands.register({ id: 'refresh', title: 'Refresh', run: () => {} })
    api.toolbar.addButton({ command: 'refresh', icon: '<svg/>', tooltip: 't' })
    api.keymaps.add({ key: 'Mod-Shift-y', command: 'refresh' })

    expect(registries.sidePanel.getViews().map(v => v.id)).toEqual([
      'toc:outline',
    ])
    expect(registries.commands.getCommands().map(c => c.id)).toEqual([
      'toc:refresh',
    ])
    expect(registries.toolbar.getButtons()[0].command).toBe('toc:refresh')
    expect(registries.keymaps.lookup('Ctrl-Shift-y')?.command).toBe(
      'toc:refresh'
    )
  })

  it('removes every registration on disposeAll (Plugin_Stop)', () => {
    const { api, registries, getSession } = setup()
    api.styles.add('.a{}')
    api.sidePanel.registerView({
      id: 'v',
      title: 'V',
      icon: '',
      render: () => {},
    })
    api.markdown.registerRemarkPlugin(() => {})
    api.markdown.registerRehypePlugin(() => {})
    api.editor.registerExtension(EditorView.lineWrapping)
    api.commands.register({ id: 'c', title: 'C', run: () => {} })
    api.toolbar.addButton({ command: 'c', icon: '', tooltip: '' })
    api.keymaps.add({ key: 'Mod-Alt-q', command: 'c' })
    api.events.onActiveNoteChange(() => {})
    api.settings.onDidChange(() => {})

    expect(
      document.head.querySelectorAll('style[data-plugin-id]')
    ).toHaveLength(1)
    getSession()?.disposeAll()

    expect(
      document.head.querySelectorAll('style[data-plugin-id]')
    ).toHaveLength(0)
    expect(registries.sidePanel.getViews()).toHaveLength(0)
    expect(registries.markdown.getSnapshot().remark).toHaveLength(0)
    expect(registries.markdown.getSnapshot().rehype).toHaveLength(0)
    expect(registries.editorExtensions.getExtensions()).toHaveLength(0)
    expect(registries.commands.getCommands()).toHaveLength(0)
    expect(registries.toolbar.getButtons()).toHaveLength(0)
    expect(registries.keymaps.store.getSnapshot()).toHaveLength(0)
    expect(registries.activeNote.store.getSnapshot()).toHaveLength(0)
    expect(registries.settings.store.getSnapshot()).toHaveLength(0)
  })

  it('untracks a registration the plugin disposes itself', () => {
    const { api, getSession, registries } = setup()
    const session = getSession() as PluginSession
    const untrack = vi.spyOn(session, 'untrack')
    const d = api.commands.register({ id: 'c', title: 'C', run: () => {} })
    d.dispose()
    d.dispose()
    expect(untrack).toHaveBeenCalledTimes(1)
    expect(registries.commands.getCommands()).toHaveLength(0)
    expect(session.disposeAll()).toEqual([])
  })

  it('reports and rethrows registry rejections', () => {
    const { api, onRegistrationError } = setup()
    api.commands.register({ id: 'c', title: 'C', run: () => {} })
    expect(() =>
      api.commands.register({ id: 'c', title: 'C', run: () => {} })
    ).toThrow(PluginApiError)
    expect(onRegistrationError).toHaveBeenCalledWith(
      'command',
      expect.objectContaining({ kind: 'invalidArgument' })
    )
  })

  it('rejects invalid arguments with invalidArgument', () => {
    const { api } = setup()
    const call = () =>
      api.commands.register({
        id: 'a:b',
        title: 'x',
        run: () => {},
      })
    expect(call).toThrow(
      expect.objectContaining({ kind: 'invalidArgument' }) as Error
    )
    expect(() =>
      api.sidePanel.registerView({
        id: 'v',
        title: 'V',
        icon: '',
        render: 'nope' as unknown as () => void,
      })
    ).toThrow(expect.objectContaining({ kind: 'invalidArgument' }) as Error)
  })

  it('throws pluginNotActive outside a session', async () => {
    const { api, setSession, getSession } = setup({
      permissions: ['clipboard'],
    })
    getSession()?.disposeAll()
    expect(() => api.styles.add('.a{}')).toThrow(
      expect.objectContaining({ kind: 'pluginNotActive' }) as Error
    )
    setSession(null)
    expect(() => api.settings.getAll()).toThrow(
      expect.objectContaining({ kind: 'pluginNotActive' }) as Error
    )
    await expect(api.clipboard.readText()).rejects.toMatchObject({
      kind: 'pluginNotActive',
    })
  })
})

describe('createPluginApi: commands.execute', () => {
  it('runs a registered command by local or real ID', async () => {
    const { api } = setup()
    const run = vi.fn()
    api.commands.register({ id: 'c', title: 'C', run })
    await api.commands.execute('c')
    await api.commands.execute('toc:c')
    expect(run).toHaveBeenCalledTimes(2)
    await expect(api.commands.execute('missing')).rejects.toMatchObject({
      kind: 'invalidArgument',
    })
  })

  it('rejects with timeout after 10 seconds', async () => {
    vi.useFakeTimers()
    const { api } = setup()
    api.commands.register({
      id: 'slow',
      title: 'Slow',
      run: () => new Promise(() => {}),
    })
    const result = api.commands.execute('slow')
    const assertion = expect(result).rejects.toMatchObject({ kind: 'timeout' })
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
  })
})

describe('createPluginApi: permission gate', () => {
  it('rejects permissioned APIs without calling the backend', async () => {
    const { api, backend } = setup({ permissions: [] })
    const calls = [
      api.clipboard.readText(),
      api.clipboard.writeText('x'),
      api.shell.openExternal('https://example.com'),
      api.network.fetch('https://example.com'),
      api.notes.listRootFolders(),
      api.notes.read('/notes/a.md'),
      api.notes.create({ rootFolder: '/notes', title: 'a' }),
      api.notes.delete('/notes/a.md'),
    ]
    for (const call of calls) {
      await expect(call).rejects.toMatchObject({ kind: 'permissionDenied' })
    }
    expect(backend.clipboardRead).not.toHaveBeenCalled()
    expect(backend.clipboardWrite).not.toHaveBeenCalled()
    expect(backend.openExternal).not.toHaveBeenCalled()
    expect(backend.httpRequest).not.toHaveBeenCalled()
    expect(backend.notes.listRoots).not.toHaveBeenCalled()
    expect(backend.notes.read).not.toHaveBeenCalled()
    expect(backend.notes.create).not.toHaveBeenCalled()
    expect(backend.notes.delete).not.toHaveBeenCalled()
  })

  it('evaluates permissions at call time', async () => {
    const { api, backend, setPermissions } = setup({ permissions: [] })
    await expect(api.clipboard.readText()).rejects.toMatchObject({
      kind: 'permissionDenied',
    })
    setPermissions(['clipboard'])
    await expect(api.clipboard.readText()).resolves.toBe('clip')
    expect(backend.clipboardRead).toHaveBeenCalledWith(PLUGIN)
  })

  it('separates notes:read and notes:write', async () => {
    const { api, backend } = setup({ permissions: ['notes:read'] })
    await expect(api.notes.read('/notes/a.md')).resolves.toMatchObject({
      path: '/notes/a.md',
    })
    await expect(
      api.notes.update('/notes/a.md', { body: '', frontMatter: {} })
    ).rejects.toMatchObject({ kind: 'permissionDenied' })
    expect(backend.notes.update).not.toHaveBeenCalled()
  })
})

describe('createPluginApi: shell.openExternal', () => {
  it.each([
    'https://example.com',
    'http://example.com/a',
    'mailto:a@example.com',
  ])('opens %s', async url => {
    const { api, backend } = setup({ permissions: ['shell:openExternal'] })
    await api.shell.openExternal(url)
    expect(backend.openExternal).toHaveBeenCalledWith(PLUGIN, url)
  })

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'not a url'])(
    'rejects %s with schemeNotAllowed',
    async url => {
      const { api, backend } = setup({ permissions: ['shell:openExternal'] })
      await expect(api.shell.openExternal(url)).rejects.toMatchObject({
        kind: 'schemeNotAllowed',
      })
      expect(backend.openExternal).not.toHaveBeenCalled()
    }
  )
})

describe('createPluginApi: network.fetch', () => {
  it('converts the request and the response', async () => {
    const { api, backend } = setup({ permissions: ['network'] })
    vi.mocked(backend.httpRequest).mockResolvedValueOnce({
      status: 201,
      headers: [
        ['Content-Type', 'application/json'],
        ['Set-Cookie', 'a=1'],
        ['set-cookie', 'b=2'],
      ],
      bodyBase64: encodeBase64(new TextEncoder().encode('{"ok":"日本"}')),
      url: 'https://api.example.com/final',
    })

    const res = await api.network.fetch('https://api.example.com/x', {
      method: 'POST',
      headers: { 'X-Key': 'k' },
      body: 'こんにちは',
    })

    expect(backend.httpRequest).toHaveBeenCalledWith(PLUGIN, {
      url: 'https://api.example.com/x',
      method: 'POST',
      headers: [['X-Key', 'k']],
      bodyBase64: encodeBase64(new TextEncoder().encode('こんにちは')),
    })
    expect(res.status).toBe(201)
    expect(res.ok).toBe(true)
    expect(res.url).toBe('https://api.example.com/final')
    expect(res.headers).toEqual({
      'content-type': 'application/json',
      'set-cookie': 'a=1, b=2',
    })
    await expect(res.json()).resolves.toEqual({ ok: '日本' })
    await expect(res.text()).resolves.toBe('{"ok":"日本"}')
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([
      ...new TextEncoder().encode('{"ok":"日本"}'),
    ])
  })

  it('encodes binary bodies', async () => {
    const { api, backend } = setup({ permissions: ['network'] })
    const bytes = new Uint8Array([0, 255, 128])
    await api.network.fetch('https://a.example.com', { body: bytes })
    await api.network.fetch('https://a.example.com', { body: bytes.buffer })
    for (const [, request] of vi.mocked(backend.httpRequest).mock.calls) {
      expect([...decodeBase64(request.bodyBase64 as string)]).toEqual([
        ...bytes,
      ])
    }
  })

  it('passes backend errors through as PluginApiError', async () => {
    const { api, backend } = setup({ permissions: ['network'] })
    vi.mocked(backend.httpRequest).mockRejectedValueOnce(
      new PluginApiError('blocked', 'blocked')
    )
    await expect(
      api.network.fetch('https://evil.example.com')
    ).rejects.toMatchObject({ kind: 'blocked' })
  })

  it('marks non-2xx responses as not ok', () => {
    const res = toPluginResponse({
      status: 404,
      headers: [],
      bodyBase64: '',
      url: 'https://a.example.com',
    })
    expect(res.ok).toBe(false)
  })
})

describe('createPluginApi: notes', () => {
  it.each(['read', 'create', 'rename', 'move'] as const)('deletes a canonical path returned by %s using the root resolved by the backend', async operation => {
    const { api, backend, confirmDelete } = setup({ permissions: ['notes:read', 'notes:write'], roots: ['/home/user/notes'] })
    const canonical = '/mnt/notes/a.md'
    vi.mocked(backend.notes.resolveRoot).mockResolvedValue('/home/user/notes')
    vi.mocked(backend.notes.read).mockResolvedValue({ path: canonical, body: 'body', frontMatter: {} })
    vi.mocked(backend.notes[operation === 'read' ? 'create' : operation]).mockResolvedValue(canonical)
    let path: string
    if (operation === 'read') path = (await api.notes.read('/home/user/notes/a.md')).path
    else if (operation === 'create') path = await api.notes.create({ rootFolder: '/home/user/notes', title: 'A' })
    else if (operation === 'rename') path = await api.notes.rename('/home/user/notes/old.md', 'A')
    else path = await api.notes.move('/home/user/notes', '/home/user/notes/sub/a.md', '')
    await api.notes.delete(path)
    expect(backend.notes.resolveRoot).toHaveBeenCalledWith(PLUGIN, canonical)
    expect(confirmDelete).toHaveBeenCalledWith(expect.objectContaining({ path: canonical }))
    expect(backend.notes.delete).toHaveBeenCalledWith(PLUGIN, '/home/user/notes', canonical)
  })

  it('does not show a deletion dialog when the plugin stops during root resolution', async () => {
    const { api, backend, confirmDelete, getSession } = setup({ permissions: ['notes:write'] })
    vi.mocked(backend.notes.resolveRoot).mockImplementationOnce(async () => {
      getSession()?.disposeAll()
      return '/notes'
    })
    await expect(api.notes.delete('/notes/a.md')).rejects.toMatchObject({ kind: 'pluginNotActive' })
    expect(confirmDelete).not.toHaveBeenCalled()
    expect(backend.notes.delete).not.toHaveBeenCalled()
  })

  it('requires write permission before resolving a deletion root', async () => {
    const { api, backend, confirmDelete } = setup({ permissions: ['notes:read'] })
    await expect(api.notes.delete('/notes/a.md')).rejects.toMatchObject({ kind: 'permissionDenied' })
    expect(backend.notes.resolveRoot).not.toHaveBeenCalled()
    expect(confirmDelete).not.toHaveBeenCalled()
  })

  it('maps create input to the backend', async () => {
    const { api, backend } = setup({ permissions: ['notes:write'] })
    await expect(
      api.notes.create({
        rootFolder: '/notes',
        folder: 'sub',
        title: 'T',
        body: 'b',
        frontMatter: { tags: ['x'] },
      })
    ).resolves.toBe('/notes/a.md')
    expect(backend.notes.create).toHaveBeenCalledWith(PLUGIN, {
      root: '/notes',
      folder: 'sub',
      title: 'T',
      body: 'b',
      frontMatter: { tags: ['x'] },
    })
  })

  it('deletes after confirmation with the containing root', async () => {
    const { api, backend, confirmDelete } = setup({
      permissions: ['notes:write'],
      roots: ['/notes', '/notes/work'],
    })
    await api.notes.delete('/notes/work/./a/../Plan.md')
    expect(confirmDelete).toHaveBeenCalledWith({
      pluginId: PLUGIN,
      pluginName: '目次',
      noteName: 'Plan',
      path: '/notes/work/./a/../Plan.md',
    })
    expect(backend.notes.delete).toHaveBeenCalledWith(
      PLUGIN,
      '/notes/work',
      '/notes/work/./a/../Plan.md'
    )
  })

  it('rejects with deleteRejected when the user cancels', async () => {
    const { api, backend } = setup({
      permissions: ['notes:write'],
      confirm: false,
    })
    await expect(api.notes.delete('/notes/a.md')).rejects.toMatchObject({
      kind: 'deleteRejected',
    })
    expect(backend.notes.delete).not.toHaveBeenCalled()
  })

  it('rejects paths outside the roots without showing the dialog', async () => {
    const { api, backend, confirmDelete } = setup({
      permissions: ['notes:write'],
    })
    await expect(api.notes.delete('/notes/../secret.md')).rejects.toMatchObject(
      { kind: 'outOfScope' }
    )
    expect(confirmDelete).not.toHaveBeenCalled()
    expect(backend.notes.delete).not.toHaveBeenCalled()
  })

  it('does not delete when the plugin stops while the dialog is open', async () => {
    const { api, backend, confirmDelete, getSession } = setup({
      permissions: ['notes:write'],
    })
    confirmDelete.mockImplementationOnce(async () => {
      getSession()?.disposeAll()
      return true
    })
    await expect(api.notes.delete('/notes/a.md')).rejects.toMatchObject({
      kind: 'pluginNotActive',
    })
    expect(backend.notes.delete).not.toHaveBeenCalled()
  })
})

describe('createPluginApi: settings', () => {
  const declarations: SettingDeclaration[] = [
    {
      key: 'depth',
      title: 'Depth',
      type: 'select',
      default: '3',
      options: [
        { value: '2', label: 'H2' },
        { value: '3', label: 'H3' },
      ],
    },
    { key: 'numbers', title: 'Numbers', type: 'boolean', default: false },
  ]

  it('resolves stored values against the declarations', () => {
    const { api, registries } = setup({ declarations })
    expect(api.settings.getAll()).toEqual({ depth: '3', numbers: false })

    registries.settings.setValues(PLUGIN, { depth: '2', numbers: 'yes' })
    expect(api.settings.get('depth')).toBe('2')
    expect(api.settings.get('numbers')).toBe(false)
    expect(() => api.settings.get('unknown')).toThrow(
      expect.objectContaining({ kind: 'invalidArgument' }) as Error
    )
  })

  it('notifies onDidChange with resolved values until disposed', () => {
    const { api, registries } = setup({ declarations })
    const listener = vi.fn()
    const d = api.settings.onDidChange(listener)

    registries.settings.setValues(PLUGIN, { depth: '2', numbers: true })
    registries.settings.setValues('other', { depth: '2' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ depth: '2', numbers: true })

    d.dispose()
    registries.settings.setValues(PLUGIN, { depth: '3' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps the previous values when no change notification arrives', () => {
    const { api, registries } = setup({ declarations })
    registries.settings.setValues(PLUGIN, { depth: '2' })
    expect(api.settings.get('depth')).toBe('2')
    expect(api.settings.get('depth')).toBe('2')
  })
})

describe('createPluginApi: editor.scrollToLine', () => {
  it('returns false without an active editor and scrolls otherwise', () => {
    const { api, registries } = setup()
    expect(api.editor.scrollToLine(1)).toBe(false)

    const view = new EditorView({
      state: EditorState.create({ doc: 'a\nb\nc' }),
      parent: document.body,
    })
    const d = registries.activeEditor.register(view)
    expect(api.editor.scrollToLine(2)).toBe(true)
    d.dispose()
    view.destroy()
  })
})

describe('path helpers', () => {
  it('normalizes paths lexically', () => {
    expect(normalizePathLexically('/a/./b//c/../d/')).toBe('/a/b/d')
    expect(normalizePathLexically('C:\\Notes\\..\\..\\x')).toBe('C:/x')
    expect(normalizePathLexically('/..')).toBe('/')
    expect(normalizePathLexically('../../a')).toBe('../../a')
  })

  it('finds the deepest containing root', () => {
    expect(findContainingRoot('/notes/a.md', ['/notes'])).toBe('/notes')
    expect(findContainingRoot('/notes', ['/notes'])).toBe('/notes')
    expect(findContainingRoot('/notes2/a.md', ['/notes'])).toBeNull()
    expect(findContainingRoot('/notes/w/a.md', ['/notes', '/notes/w'])).toBe(
      '/notes/w'
    )
    expect(findContainingRoot('c:\\notes\\a.md', ['C:\\Notes'])).toBe(
      'C:\\Notes'
    )
    expect(findContainingRoot('/Notes/a.md', ['/notes'])).toBeNull()
  })

  it('derives the note name from the path', () => {
    expect(noteNameFromPath('/notes/Plan.md')).toBe('Plan')
    expect(noteNameFromPath('C:\\notes\\Memo.MD')).toBe('Memo')
  })
})
