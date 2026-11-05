'use client'

import { useEffect, useRef } from 'react'

import type { PayloadCMSDocument } from '../../types.js'

import { usePreviewRefresh } from '../../hooks/use-preview-refresh.js'
import styles from './styles.module.scss'

export function RichTextDialog({
  adminRoute,
  documentInfo,
  onClose,
  onStage,
  path,
  stagedValue,
}: {
  adminRoute: string
  documentInfo: PayloadCMSDocument
  onClose: () => void
  onStage?: (value: unknown) => void
  path: string
  stagedValue?: unknown
}) {
  const refreshPreview = usePreviewRefresh()
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
      if (event.data?.type === 'payload-visual-editor:ready' && onStage) {
        frame.current?.contentWindow?.postMessage(
          { type: 'payload-visual-editor:initial', value: stagedValue },
          window.location.origin,
        )
      }
      if (event.data?.type === 'payload-visual-editor:staged' && onStage) {
        dirty.current = false
        onStage(event.data.value)
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
  }, [onStage, stagedValue])
  const close = () => {
    if (dirty.current && !window.confirm('Discard unsaved rich-text changes?')) {
      return
    }
    if (saved.current) {
      void refreshPreview().then(onClose)
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
        Close editor
      </button>
      <iframe
        ref={frame}
        src={`${adminRoute}/visual-rich-text?${new URLSearchParams({ id: String(documentInfo.id), collection: documentInfo.collection, locale: documentInfo.locale || '', path, ...(onStage ? { mode: 'stage' } : {}) })}`}
        title="Rich-text editor"
      />
    </dialog>
  )
}
