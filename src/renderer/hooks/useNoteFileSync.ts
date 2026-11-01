import { useEffect, useRef, useState } from 'react'
import type { NoteContent } from '@/shared/types'
import type { NoteMutation } from '@/shared/noteMutation'
import { tauriApi as App } from '@/renderer/lib/tauriApi'
import { NoteSaveSession, sameNotePath } from '@/renderer/lib/noteSaveSession'
import { invalidateEditorStateCache } from './useEditorStateCache'

interface Options {
  path: string | null
  onReload(content: NoteContent | null, path: string | null): void
  onRebind(path: string | null): void
  onStructure?(event: NoteMutation): Promise<void>
  onError(error: unknown): void
  onSaved?(): void
}

/** Shared by the workspace and detached note windows. */
export function useNoteFileSync(options: Options) {
  const latest = useRef(options)
  latest.current = options
  const [isSaving, setIsSaving] = useState(false)
  const [isLocked, setIsLocked] = useState(false)
  const [session] = useState(
    () =>
      new NoteSaveSession({
        async save(path, body) {
          let content = body
          if (!body.startsWith('---\n')) {
            const current = await App.markdown.getNoteContent(path)
            const raw = current?.rawContent
            if (raw?.startsWith('---\n')) {
              const end = raw.indexOf('\n---\n', 4)
              if (end !== -1)
                content = raw.substring(0, end + 5) + body.replace(/^\n+/, '')
            }
          }
          await App.markdown.saveNote(path, content)
          latest.current.onSaved?.()
          return content
        },
        load: path => App.markdown.getNoteContent(path),
        reload: (content, path) => {
          if (path) invalidateEditorStateCache(path)
          latest.current.onReload(content, path)
        },
        rebind: path => latest.current.onRebind(path),
        structure: event =>
          latest.current.onStructure?.(event) ?? Promise.resolve(),
        saving: setIsSaving,
        locked: setIsLocked,
        error: error => latest.current.onError(error),
      })
  )

  // Subscribe even when no note is selected: structural changes still update
  // the workspace list, and every host window must acknowledge prepare.
  useEffect(
    () =>
      App.markdown.onNoteMutation?.(event => {
        void session
          .mutation(event)
          .then(
            () => {
              if (event.phase !== 'abort')
                return App.markdown.ackNoteMutation(event.requestId)
            },
            error => {
              latest.current.onError(error)
              return App.markdown.ackNoteMutation(
                event.requestId,
                String(error)
              )
            }
          )
          .catch(error => latest.current.onError(error))
      }),
    [session]
  )

  useEffect(() => {
    session.bind(options.path)
    if (!options.path) return
    const path = options.path
    let reload: ReturnType<typeof setTimeout> | undefined
    void App.markdown
      .watchFile(path)
      .catch(error => latest.current.onError(error))
    const unsubscribe = App.markdown.onFileChanged(changed => {
      if (!sameNotePath(changed, path)) return
      clearTimeout(reload)
      reload = setTimeout(() => {
        void session.reloadFromWatcher()
      }, 300)
    })
    return () => {
      clearTimeout(reload)
      void App.markdown
        .unwatchFile(path)
        .catch(error => latest.current.onError(error))
      unsubscribe()
    }
  }, [options.path, session])

  // Flush on unmount. Keep the session usable when StrictMode re-mounts
  // effects on the same component instance.
  useEffect(
    () => () => {
      void session.flush().catch(() => {})
    },
    [session]
  )

  return { session, isSaving, isLocked }
}
