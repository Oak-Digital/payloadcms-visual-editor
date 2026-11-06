'use client'

import { useEffect, useRef, useState } from 'react'

import type { PayloadCMSDocument } from '../../types.js'

import { usePreviewRefresh } from '../../hooks/use-preview-refresh.js'
import styles from './styles.module.scss'

export function RichTextDialog({
  adminRoute,
  documentInfo,
  onClose,
  path,
}: {
  adminRoute: string
  documentInfo: PayloadCMSDocument
  onClose: () => void
  path: string
}) {
  const refreshPreview = usePreviewRefresh()
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const saved = useRef(false)
  const dirty = useRef(false)
  useEffect(() => {
    dialog.current?.showModal()
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.current?.contentWindow
      ) {
        return
      }
      if (event.data?.type === 'payload-visual-editor:saved') {
        saved.current = true
        dirty.current = false
      }
      if (event.data?.type === 'payload-visual-editor:changed') {
        dirty.current = true
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [])
  const close = () => {
    if (dirty.current && !window.confirm('Discard unsaved rich-text changes?')) {
      return
    }
    if (saved.current) {
      setError('')
      void refreshPreview()
        .then(onClose)
        .catch((cause) => {
          setError(cause instanceof Error ? cause.message : 'Unable to update preview.')
        })
    } else {
      onClose()
    }
  }
  return (
    <dialog
      aria-label="Rich-text editor"
      className={styles.dialog}
      data-annotation-popup
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      ref={dialog}
    >
      <button className={styles.close} onClick={close} type="button">
        {error ? 'Retry preview update' : 'Close editor'}
      </button>
      {error && <p role="alert">{error}</p>}
      <iframe
        ref={frame}
        src={`${adminRoute}/visual-rich-text?${new URLSearchParams({ id: String(documentInfo.id), collection: documentInfo.collection, locale: documentInfo.locale || '', path })}`}
        title="Rich-text editor"
      />
    </dialog>
  )
}
