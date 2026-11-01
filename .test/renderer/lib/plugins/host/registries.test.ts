import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ActiveEditorRegistry,
  ActiveNoteBus,
  CommandRegistry,
  createRegistries,
  EditorExtensionRegistry,
  KeymapRegistry,
  MarkdownExtensionRegistry,
  PLUGIN_STYLE_ATTRIBUTE,
  PluginThemeRegistry,
  SidePanelRegistry,
  StyleRegistry,
  ToolbarRegistry,
} from '@/renderer/lib/plugins/host/registries'
import { builtinThemes } from '@/renderer/lib/themeManager'
import type { ActiveNoteEvent, MarkdownPluggable } from '@/shared/plugin/api'
import { PluginApiError } from '@/shared/plugin/api'

const pluginStyles = () =>
  [...document.head.querySelectorAll(`style[${PLUGIN_STYLE_ATTRIBUTE}]`)].map(
    el => [el.getAttribute(PLUGIN_STYLE_ATTRIBUTE), el.textContent]
  )

const theme = (id: string) => ({
  id,
  name: id,
  nameJa: id,
  swatches: ['#000'],
  swatchesDark: ['#fff'],
  light: { '--x': '1' },
  dark: { '--x': '2' },
})

afterEach(() => {
  for (const el of document.head.querySelectorAll(
    `style[${PLUGIN_STYLE_ATTRIBUTE}]`
  )) {
    el.remove()
  }
  localStorage.clear()
})

describe('StyleRegistry', () => {
  it('inserts <style data-plugin-id> in Load_Order and removes it on dispose', () => {
    const styles = new StyleRegistry(document)
    const b = styles.add('b', '.b{}')
    styles.add('a', '.a{}')
    expect(pluginStyles()).toEqual([
      ['b', '.b{}'],
      ['a', '.a{}'],
    ])

    styles.store.setLoadOrder(['a', 'b'])
    expect(pluginStyles()).toEqual([
      ['a', '.a{}'],
      ['b', '.b{}'],
    ])

    b.dispose()
    b.dispose()
    expect(pluginStyles()).toEqual([['a', '.a{}']])
  })

  it('applies theme-conditional CSS only while that theme is selected', () => {
    const styles = new StyleRegistry(document)
    styles.add('t1', '.t1{}', { whenThemeId: 'ocean' })
    styles.add('t2', '.t2{}', { whenThemeId: 'forest' })
    expect(pluginStyles()).toEqual([])

    styles.setActiveThemeId('ocean')
    expect(pluginStyles()).toEqual([['t1', '.t1{}']])

    styles.setActiveThemeId('forest')
    expect(pluginStyles()).toEqual([['t2', '.t2{}']])

    styles.setActiveThemeId('gray')
    expect(pluginStyles()).toEqual([])
  })
})

describe('PluginThemeRegistry', () => {
  it('rejects invalid themes and IDs used by builtin, custom, or earlier plugin themes', () => {
    localStorage.setItem(
      'notyra-custom-themes',
      JSON.stringify([theme('my-custom')])
    )
    const themes = new PluginThemeRegistry()

    expect(themes.register('p0', { id: 'x' })).toEqual({
      ok: false,
      reason: 'invalidTheme',
    })
    expect(themes.register('p1', theme(builtinThemes[0].id))).toMatchObject({
      ok: false,
      reason: 'duplicateId',
    })
    expect(themes.register('p2', theme('my-custom'))).toMatchObject({
      ok: false,
      reason: 'duplicateId',
    })

    const first = themes.register('p3', theme('ocean'))
    expect(first.ok).toBe(true)
    expect(themes.register('p4', theme('ocean'))).toMatchObject({
      ok: false,
      reason: 'duplicateId',
      themeId: 'ocean',
    })
    expect(themes.find('ocean')?.pluginId).toBe('p3')

    if (first.ok) first.disposable.dispose()
    expect(themes.getThemes()).toEqual([])
    expect(themes.register('p4', theme('ocean')).ok).toBe(true)
  })
})

describe('SidePanelRegistry and CommandRegistry', () => {
  it('prefixes IDs with the Plugin_ID and rejects duplicates within a plugin', () => {
    const panel = new SidePanelRegistry()
    const render = () => {}
    panel.register('a', { id: 'toc', title: 'ToC', icon: '<svg/>', render })
    panel.register('b', { id: 'toc', title: 'ToC', icon: '<svg/>', render })
    expect(panel.getViews().map(v => v.id)).toEqual(['a:toc', 'b:toc'])
    expect(() =>
      panel.register('a', { id: 'toc', title: 'x', icon: '', render })
    ).toThrow(PluginApiError)

    const commands = new CommandRegistry()
    const run = vi.fn()
    const d = commands.register('a', { id: 'go', title: 'Go', run })
    commands.register('b', { id: 'go', title: 'Go', run })
    expect(commands.get('a:go')?.run).toBe(run)
    expect(() => commands.register('a', { id: 'go', title: '', run })).toThrow(
      PluginApiError
    )
    d.dispose()
    expect(commands.get('a:go')).toBeUndefined()
    expect(commands.get('b:go')).toBeDefined()
  })
})

describe('ToolbarRegistry', () => {
  it('resolves local command IDs to qualified IDs', () => {
    const toolbar = new ToolbarRegistry()
    toolbar.register('a', { command: 'go', icon: '<svg/>', tooltip: 'Go' })
    toolbar.register('a', { command: 'b:run', icon: '<svg/>', tooltip: 'Run' })
    expect(toolbar.getButtons().map(b => b.command)).toEqual(['a:go', 'b:run'])
  })
})

describe('KeymapRegistry', () => {
  it('normalizes keys, prefers builtin and earlier Load_Order, and caches the resolution', () => {
    const keymaps = new KeymapRegistry({
      platform: 'other',
      builtin: new Set(['Ctrl-f']),
    })
    keymaps.register('b', { key: 'Mod-Shift-k', command: 'x' })
    keymaps.register('a', { key: 'Shift-Ctrl-K', command: 'y' })
    keymaps.register('a', { key: 'Mod-f', command: 'z' })
    keymaps.store.setLoadOrder(['a', 'b'])

    const resolution = keymaps.getResolution()
    expect(keymaps.getResolution()).toBe(resolution)
    expect(keymaps.lookup('Ctrl-Shift-k')).toEqual({
      pluginId: 'a',
      key: 'Ctrl-Shift-k',
      command: 'a:y',
    })
    expect(resolution.conflicts).toEqual([
      { pluginId: 'a', key: 'Ctrl-f', command: 'a:z', with: 'builtin' },
      {
        pluginId: 'b',
        key: 'Ctrl-Shift-k',
        command: 'b:x',
        with: { pluginId: 'a' },
      },
    ])
  })

  it('rejects keys that cannot be parsed', () => {
    const keymaps = new KeymapRegistry({ platform: 'mac', builtin: new Set() })
    expect(() => keymaps.register('a', { key: 'Hyper-k', command: 'x' })).toThrow(
      PluginApiError
    )
    expect(keymaps.store.getSnapshot()).toEqual([])
  })
})

describe('MarkdownExtensionRegistry', () => {
  it('orders by Load_Order and excludes without changing the snapshot or notifying', () => {
    const markdown = new MarkdownExtensionRegistry()
    const listener = vi.fn()
    markdown.subscribe(listener)
    const pa: MarkdownPluggable = () => {}
    const pb: MarkdownPluggable = () => {}
    markdown.registerRemark('b', pb)
    markdown.registerRemark('a', pa)
    markdown.registerRehype('a', pa)
    markdown.setLoadOrder(['a', 'b'])
    listener.mockClear()

    const snapshot = markdown.getSnapshot()
    expect(markdown.getSnapshot()).toBe(snapshot)
    expect(snapshot.remark.map(e => e.pluginId)).toEqual(['a', 'b'])

    markdown.exclude('a')
    expect(markdown.getSnapshot()).toBe(snapshot)
    expect(listener).not.toHaveBeenCalled()
    expect(markdown.isExcluded('a')).toBe(true)
    expect(markdown.getActivePlugins('remark')).toEqual([
      { pluginId: 'b', plugin: pb },
    ])
    expect(markdown.getActivePlugins('rehype')).toEqual([])
  })
})

describe('EditorExtensionRegistry', () => {
  it('rejects extensions that EditorState.create cannot configure', () => {
    const editor = new EditorExtensionRegistry()
    expect(() =>
      editor.register('a', {} as unknown as import('@codemirror/state').Extension)
    ).toThrow(PluginApiError)
    expect(editor.getExtensions()).toEqual([])

    const ext = EditorView.lineWrapping
    editor.register('a', ext)
    expect(editor.getExtensions()).toEqual([ext])
  })
})

describe('ActiveNoteBus', () => {
  it('keeps delivering to other listeners when one throws', () => {
    const onListenerError = vi.fn()
    const bus = new ActiveNoteBus({ onListenerError })
    const error = new Error('boom')
    const received: string[] = []
    bus.subscribe('a', () => {
      throw error
    })
    bus.subscribe('b', e => received.push(e.type))
    const event: ActiveNoteEvent = {
      type: 'switched',
      note: null,
      windowKind: 'main',
    }

    bus.publish(event)
    expect(received).toEqual(['switched'])
    expect(onListenerError).toHaveBeenCalledWith('a', error)
  })
})

describe('ActiveEditorRegistry', () => {
  it('navigates preview-only views and removes their navigation callbacks on disposal', () => {
    const editors = new ActiveEditorRegistry()
    const first = vi.fn(() => true)
    const second = vi.fn(() => true)
    const a = editors.registerPreviewScroller(first)
    const b = editors.registerPreviewScroller(second)
    expect(editors.getActive()).toBeNull()
    expect(editors.scrollToLine(20.8)).toBe(true)
    expect(second).toHaveBeenCalledWith(20)
    expect(first).not.toHaveBeenCalled()
    expect(editors.scrollToLine(Number.NaN)).toBe(false)
    expect(second).toHaveBeenCalledTimes(1)
    b.dispose()
    b.dispose()
    expect(editors.scrollToLine(-5)).toBe(true)
    expect(first).toHaveBeenCalledWith(1)
    a.dispose()
    expect(editors.scrollToLine(1)).toBe(false)
  })

  it('scrolls the active editor and returns false without one', () => {
    const editors = new ActiveEditorRegistry()
    expect(editors.scrollToLine(1)).toBe(false)

    const view = new EditorView({
      state: EditorState.create({ doc: 'a\nb\nc' }),
      parent: document.createElement('div'),
    })
    const dispatch = vi.spyOn(view, 'dispatch')
    const registration = editors.register(view)

    expect(editors.scrollToLine(2)).toBe(true)
    expect(editors.scrollToLine(99)).toBe(true)
    expect(editors.scrollToLine(Number.NaN)).toBe(false)
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(view.state.doc.toString()).toBe('a\nb\nc')

    registration.dispose()
    expect(editors.getActive()).toBeNull()
    view.destroy()
  })
})

describe('createRegistries', () => {
  it('applies Load_Order to every per-plugin registry', () => {
    const registries = createRegistries({
      platform: 'other',
      document,
      builtinKeybindings: new Set(),
    })
    const render = () => {}
    registries.sidePanel.register('b', { id: 'v', title: '', icon: '', render })
    registries.sidePanel.register('a', { id: 'v', title: '', icon: '', render })
    registries.markdown.registerRemark('b', () => {})
    registries.markdown.registerRemark('a', () => {})

    registries.setLoadOrder(['a', 'b'])
    expect(registries.sidePanel.getViews().map(v => v.pluginId)).toEqual([
      'a',
      'b',
    ])
    expect(
      registries.markdown.getSnapshot().remark.map(e => e.pluginId)
    ).toEqual(['a', 'b'])
  })
})
