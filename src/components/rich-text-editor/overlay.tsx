'use client'

import { type ComponentProps, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { RichTextSidebar } from './sidebar.js'
import styles from './styles.module.scss'
import { EditorIcon } from '../workspace/icons.js'

/** Anchor to canvas content while keeping the editor above the workspace sidebar. */
export function RichTextOverlay({
  anchor,
  onConfirm,
  label = 'Rich text',
  open,
  portalDocument = anchor.ownerDocument,
  ...editor
}: ComponentProps<typeof RichTextSidebar> & {
  anchor: HTMLElement
  open: boolean
  label?: string
  portalDocument?: Document
  onConfirm: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [expanded, setExpanded] = useState(false)
  useLayoutEffect(() => {
    const element = dialog.current
    const canvas = anchor.ownerDocument.defaultView
    const host = portalDocument.defaultView
    if (!element || !host || !open) return
    let bounds = anchor.getBoundingClientRect()
    const position = () => {
      if (anchor.isConnected) bounds = anchor.getBoundingClientRect()
      let left = bounds.left
      let top = bounds.top
      let anchorWidth = bounds.width
      if (canvas && canvas !== host && canvas.frameElement) {
        const frame = canvas.frameElement.getBoundingClientRect()
        const scaleX = frame.width / canvas.innerWidth
        const scaleY = frame.height / canvas.innerHeight
        left = frame.left + bounds.left * scaleX
        top = frame.top + bounds.top * scaleY
        anchorWidth *= scaleX
      }
      const viewport = host.visualViewport
      const width = viewport?.width ?? host.innerWidth
      const height = viewport?.height ?? host.innerHeight
      const offsetLeft = viewport?.offsetLeft ?? 0
      const offsetTop = viewport?.offsetTop ?? 0
      const panelWidth = Math.min(Math.max(anchorWidth, 560), 760, width - 24)
      const panelHeight = Math.min(expanded ? 640 : 340, height - 24)
      Object.assign(element.style, {
        width: `${panelWidth}px`,
        height: `${panelHeight}px`,
        left: `${Math.max(offsetLeft + 12, Math.min(left, offsetLeft + width - panelWidth - 12))}px`,
        top: `${Math.max(offsetTop + 12, Math.min(top, offsetTop + height - panelHeight - 12))}px`,
      })
    }
    position()
    canvas?.addEventListener('scroll', position, true)
    host.addEventListener('resize', position)
    host.addEventListener('scroll', position, true)
    host.visualViewport?.addEventListener('resize', position)
    host.visualViewport?.addEventListener('scroll', position)
    return () => {
      canvas?.removeEventListener('scroll', position, true)
      host.removeEventListener('resize', position)
      host.removeEventListener('scroll', position, true)
      host.visualViewport?.removeEventListener('resize', position)
      host.visualViewport?.removeEventListener('scroll', position)
    }
  }, [anchor, portalDocument, open, expanded])
  useLayoutEffect(() => {
    const element = dialog.current
    const host = portalDocument.defaultView
    if (!element || !host || !open) return
    element.showModal()
    const focus = host.requestAnimationFrame(() => element.querySelector('button')?.focus())
    return () => {
      host.cancelAnimationFrame(focus)
      element.close()
      if (anchor.isConnected) anchor.focus({ preventScroll: true })
    }
  }, [anchor, portalDocument, open])

  return createPortal(
    <dialog
      ref={dialog}
      className={styles.canvasOverlay}
      aria-label="Edit rich text"
      data-annotation-popup
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          if (!editor.disabled && !expanded) onConfirm()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        if (!editor.disabled && !expanded) onConfirm()
      }}
    >
      <header className={styles.overlayHeader}>
        <div className={styles.overlayTitle}>
          <EditorIcon name="text" />
          <strong title={label}>{label}</strong>
        </div>
        <button
          className={styles.confirm}
          type="button"
          disabled={editor.disabled || expanded}
          onClick={onConfirm}
        >
          <EditorIcon name="check" />
          Confirm
        </button>
      </header>
      <RichTextSidebar
        {...editor}
        onEscape={() => {
          if (!expanded) onConfirm()
        }}
        onDrawerChange={setExpanded}
      />
    </dialog>,
    portalDocument.querySelector('[data-visual-editor-workspace]') ?? portalDocument.body,
  )
}
