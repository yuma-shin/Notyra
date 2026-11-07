import { useCallback, useEffect, useRef, useState } from 'react'
import type { PluginInstallRequest } from '@/shared/plugin/installLink'
import { tauriApi } from '@/renderer/lib/tauriApi'

/** Subscribe before reading the inbox so cold starts and already-open settings use the same path. */
export function usePluginInstallRequest(onRequest: () => void) {
  const [request, setRequest] = useState<PluginInstallRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const notifyRef = useRef(onRequest)
  notifyRef.current = onRequest
  const refreshRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    // Partial APIs are used by browser previews and older test fixtures.
    const api = tauriApi.installLinks
    if (!api) return
    let disposed = false
    let sequence = 0
    const refresh = async () => {
      const seq = ++sequence
      try {
        const next = await api.getPending()
        if (disposed || seq !== sequence) return
        setRequest(next)
        setError(null)
        if (next) notifyRef.current()
      } catch (e) {
        if (!disposed && seq === sequence) setError(String(e))
      }
    }
    refreshRef.current = refresh
    const unsubscribe = api.onChanged(() => {
      void refresh()
    })
    void refresh()
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const dismiss = useCallback(async (requestId: number) => {
    await tauriApi.installLinks.dismiss(requestId)
    // Refresh even if the native event is delayed or missed.
    await refreshRef.current()
  }, [])

  return { request, dismiss, error }
}
