'use client'

import { useRouter } from 'next/navigation.js'
import { createContext, useCallback, useContext, useEffect, useRef, useTransition } from 'react'

export const PreviewRefreshContext = createContext<
  ((signal: AbortSignal) => Promise<void>) | undefined
>(undefined)

type Refresh = {
  finish: (error?: Error) => void
  promise: Promise<void>
  started: boolean
}

/** Renew preview access before merging server content, without discarding editor state. */
export function usePreviewRefresh() {
  const router = useRouter()
  const prepare = useContext(PreviewRefreshContext)
  const [pending, startTransition] = useTransition()
  const current = useRef<Refresh | undefined>(undefined)

  useEffect(() => {
    if (!pending && current.current?.started) {
      current.current.finish()
    }
  }, [pending])
  useEffect(() => () => current.current?.finish(new Error('Preview closed before updating.')), [])

  return useCallback(() => {
    // Repeated requests from this editor share the current refresh.
    if (current.current) {
      return current.current.promise
    }
    const controller = new AbortController()
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((done, fail) => {
      resolve = done
      reject = fail
    })
    const timer = setTimeout(
      () =>
        refresh.finish(new Error('Preview update timed out. Try refreshing the preview again.')),
      20000,
    )
    const refresh: Refresh = {
      finish(error) {
        if (current.current !== refresh) {
          return
        }
        current.current = undefined
        clearTimeout(timer)
        controller.abort()
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      },
      promise,
      started: false,
    }
    current.current = refresh
    void (async () => {
      try {
        await prepare?.(controller.signal)
        if (current.current !== refresh) {
          return
        }
        refresh.started = true
        startTransition(() => router.refresh())
      } catch (error) {
        refresh.finish(error instanceof Error ? error : new Error('Unable to update preview.'))
      }
    })()
    return promise
  }, [prepare, router])
}
