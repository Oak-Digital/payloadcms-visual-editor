'use client'

import { useEffect, useRef } from 'react'
import type { PayloadCMSDocument } from '../../types.js'
import styles from './styles.module.scss'

export function RichTextDialog({
  path,
  documentInfo,
  adminRoute,
  onClose,
}: {
  path: string
  documentInfo: PayloadCMSDocument
  adminRoute: string
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const saved = useRef(false)
  const dirty = useRef(false)
  useEffect(() => {
    dialog.current?.showModal()
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow)
        return
      if (event.data?.type === 'payload-visual-editor:saved') {
        saved.current = true
        dirty.current = false
      }
      if (event.data?.type === 'payload-visual-editor:changed') dirty.current = true
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [])
  const close = () => {
    if (dirty.current && !window.confirm('Discard unsaved rich-text changes?')) return
    onClose()
    if (saved.current) window.location.reload()
  }
  return (
    <dialog
      ref={dialog}
      data-annotation-popup
      aria-label="Rich-text editor"
      className={styles.dialog}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <button type="button" onClick={close} className={styles.close}>
        Close editor
      </button>
      <iframe
        ref={frame}
        title="Rich-text editor"
        src={`${adminRoute}/visual-rich-text?${new URLSearchParams({ collection: documentInfo.collection, id: String(documentInfo.id), locale: documentInfo.locale || '', path })}`}
      />
    </dialog>
  )
}
