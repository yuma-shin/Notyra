import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import {
  foldGutter,
  syntaxHighlighting,
  defaultHighlightStyle,
} from '@codemirror/language'
import { githubLight } from '@uiw/codemirror-theme-github'

describe('Markdown highlighting and folding', () => {
  it('renders and updates nested Markdown without crashing editor plugins', async () => {
    const javascript = languages.find(language => language.name === 'JavaScript')
    expect(javascript).toBeDefined()
    await javascript?.load()
    const errors: unknown[] = []
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: [
          '# Heading',
          '',
          '> **Bold** and [link](https://example.com)',
          '',
          '```javascript',
          'function example() {',
          '  return { value: 42 }',
          '}',
          '```',
        ].join('\n'),
        extensions: [
          markdown({ codeLanguages: languages }),
          githubLight,
          syntaxHighlighting(defaultHighlightStyle),
          foldGutter(),
          EditorView.exceptionSink.of(error => errors.push(error)),
        ],
      }),
    })

    try {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: '## Updated\n\n```javascript\nconst value = { nested: true }\n```',
        },
      })
      expect(parent.querySelector('.cm-content')?.textContent).toContain('Updated')
      expect(errors).toEqual([])
    } finally {
      view.destroy()
      parent.remove()
    }
  })
})
