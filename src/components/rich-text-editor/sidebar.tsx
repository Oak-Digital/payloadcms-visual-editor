'use client'

import { useEffect, useRef } from 'react'

import type { PayloadCMSDocument } from '../../types.js'

import styles from './styles.module.scss'

/** Keep the host's configured Lexical features inside its admin providers. */
export function RichTextSidebar({
  adminRoute,
  disabled,
  documentInfo,
  onChange,
  onEscape,
  onDrawerChange,
  path,
  schemaPath,
  value,
}: {
  adminRoute: string
  disabled: boolean
  documentInfo: PayloadCMSDocument
  onEscape?: () => void
  onDrawerChange?: (expanded: boolean) => void
  onChange: (value: unknown) => void
  path: string
  schemaPath?: string
  value: unknown
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const currentValue = useRef(value)
  const ready = useRef(false)
  const latest = useRef({ disabled, onChange, onEscape, onDrawerChange, value })
  latest.current = { disabled, onChange, onEscape, onDrawerChange, value }
  useEffect(() => {
    // The sidebar may be portalled into the outer workspace document.
    const host = frame.current?.ownerDocument.defaultView
    if (!host) {
      return
    }
    const receive = (event: MessageEvent) => {
      if (event.origin !== host.location.origin || event.source !== frame.current?.contentWindow) {
        return
      }
      if (
        event.data?.type === 'payload-visual-editor:drawer' &&
        typeof event.data.expanded === 'boolean'
      ) {
        latest.current.onDrawerChange?.(event.data.expanded)
      }
      if (event.data?.type === 'payload-visual-editor:escape' && !latest.current.disabled) {
        latest.current.onEscape?.()
      }
      if (event.data?.type === 'payload-visual-editor:ready') {
        ready.current = true
        currentValue.current = latest.current.value
        frame.current?.contentWindow?.postMessage(
          { type: 'payload-visual-editor:initial', value: latest.current.value },
          host.location.origin,
        )
      }
      if (
        event.data?.type === 'payload-visual-editor:changed' &&
        !latest.current.disabled &&
        event.data.value
      ) {
        currentValue.current = event.data.value
        latest.current.onChange(event.data.value)
      }
    }
    host.addEventListener('message', receive)
    return () => host.removeEventListener('message', receive)
  }, [])
  useEffect(() => {
    if (ready.current && JSON.stringify(value) !== JSON.stringify(currentValue.current)) {
      currentValue.current = value
      frame.current?.contentWindow?.postMessage(
        { type: 'payload-visual-editor:initial', value },
        window.location.origin,
      )
    }
  }, [value])
  return (
    <div className={styles.sidebar} inert={disabled}>
      <iframe
        ref={frame}
        src={`${adminRoute}/visual-rich-text?${new URLSearchParams({ id: String(documentInfo.id), collection: documentInfo.collection, embedded: 'true', locale: documentInfo.locale || '', mode: 'stage', path, ...(schemaPath ? { schemaPath } : {}) })}`}
        title="Rich-text editor"
      />
    </div>
  )
}
