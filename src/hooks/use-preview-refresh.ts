'use client'

import { useRouter } from 'next/navigation.js'
import { useCallback, useEffect, useRef, useTransition } from 'react'

/** Wait for the server component merge without navigating or discarding editor state. */
export function usePreviewRefresh() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const completion = useRef<(() => void) | undefined>(undefined)
  useEffect(() => {
    if (!pending && completion.current) {
      const resolve = completion.current
      completion.current = undefined
      resolve()
    }
  }, [pending])
  return useCallback(
    () =>
      new Promise<void>((resolve) => {
        completion.current = resolve
        startTransition(() => router.refresh())
      }),
    [router],
  )
}
