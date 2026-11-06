'use client'
import { useEffect, useState } from 'react'
import type { SharedTarget } from '../utils/shared-content.js'

/** Host renderers decide how shared documents appear; messages are confined to the same-origin workspace. */
export function useSharedContentPreview() {
  const [documents, setDocuments] = useState<
    { target: SharedTarget; document: Record<string, any>; focusPath?: string }[]
  >([])
  useEffect(() => {
    if (window.parent === window) return
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== window.parent ||
        event.data?.type !== 'visual-editor:shared-preview'
      )
        return
      const { target, document, focusPath } = event.data
      if (!target || typeof target.slug !== 'string' || !document || typeof document !== 'object')
        return
      setDocuments((all) => [
        ...all.filter((item) => item.target.slug !== target.slug || item.target.id !== target.id),
        { target, document, focusPath },
      ])
    }
    window.addEventListener('message', receive)
    window.parent.postMessage({ type: 'visual-editor:shared-ready' }, window.location.origin)
    return () => window.removeEventListener('message', receive)
  }, [])
  return documents
}
