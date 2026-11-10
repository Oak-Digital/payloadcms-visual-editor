'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PayloadCMSDocument } from '../../types.js'
import { documentKey, fieldDocument } from '../../utils/field-target.js'
import styles from './styles.module.scss'

type Block = { key: string; path: string; id: string; label: string; index: number; count: number }

/** Controls stay in the preview document, including when the sidebar is portaled out. */
export function CanvasBlockControls({
  active,
  epoch,
  owner,
  lists,
  onMove,
}: {
  active: boolean
  epoch: number
  owner: PayloadCMSDocument
  lists: { key: string; path: string; rows: { id: string; label: string }[] }[]
  onMove: (key: string, path: string, id: string, destination: number) => void
}) {
  const [targets, setTargets] = useState<{ element: HTMLElement; block: Block }[]>([])
  const [dragging, setDragging] = useState<Block>()
  const [over, setOver] = useState<string>()
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    if (!active) {
      setTargets([])
      setDragging(undefined)
      return
    }
    const next: typeof targets = []
    const restore: (() => void)[] = []
    for (const list of document.querySelectorAll<HTMLElement>('[data-payload-block-list]')) {
      const key = documentKey(fieldDocument(list, owner))
      const path = list.dataset.payloadBlockList!
      const rows = lists.find((entry) => entry.key === key && entry.path === path)?.rows
      if (!rows) continue
      for (const element of Array.from(list.children)) {
        if (!(element instanceof HTMLElement)) continue
        const index = rows.findIndex((row) => row.id === element.dataset.payloadBlockId)
        if (index < 0) continue
        const position = element.style.position
        if (getComputedStyle(element).position === 'static') element.style.position = 'relative'
        element.setAttribute('data-arrange-block-controls', '')
        restore.push(() => {
          element.style.position = position
          element.removeAttribute('data-arrange-block-controls')
        })
        next.push({ element, block: { key, path, ...rows[index], index, count: rows.length } })
      }
    }
    setTargets(next)
    return () => restore.forEach((undo) => undo())
  }, [active, epoch, owner, lists])

  function move(block: Block, index: number) {
    if (index === block.index || index < 0 || index >= block.count) return
    onMove(block.key, block.path, block.id, index)
    setAnnouncement(`${block.label} moved to position ${index + 1} of ${block.count}`)
  }

  useEffect(() => {
    if (!dragging) return
    const cleanups = targets.map(({ element, block }) => {
      const accepts =
        block.key === dragging.key && block.path === dragging.path && block.id !== dragging.id
      const enter = (event: DragEvent) => {
        if (!accepts) return
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        setOver(block.id)
      }
      const drop = (event: DragEvent) => {
        if (!accepts) return
        event.preventDefault()
        event.stopPropagation()
        move(dragging, block.index)
        setDragging(undefined)
        setOver(undefined)
      }
      element.addEventListener('dragover', enter)
      element.addEventListener('drop', drop)
      return () => {
        element.removeEventListener('dragover', enter)
        element.removeEventListener('drop', drop)
      }
    })
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [dragging, targets, onMove])

  if (!active) return null
  return (
    <>
      <span className={styles.canvasAnnouncement} role="status" aria-live="polite">
        {announcement}
      </span>
      {targets.map(({ element, block }) =>
        createPortal(
          <div
            className={`${styles.canvasBlockOverlay} ${over === block.id ? styles.canvasBlockDrop : ''}`}
            data-feedback-toolbar=""
            key={block.id}
          >
            <div
              className={styles.canvasBlockBar}
              role="group"
              aria-label={`Reorder ${block.label}`}
            >
              <button
                type="button"
                className={styles.canvasBlockGrip}
                draggable={block.count > 1}
                aria-label={`Drag ${block.label} to reorder. Use arrow keys to move.`}
                title="Drag to reorder · ↑ / ↓ to move"
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault()
                    event.stopPropagation()
                    move(block, block.index + (event.key === 'ArrowUp' ? -1 : 1))
                  }
                  if (event.key === 'Escape') {
                    setDragging(undefined)
                    setOver(undefined)
                  }
                }}
                onDragStart={(event) => {
                  event.stopPropagation()
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', block.id)
                  setDragging(block)
                }}
                onDragEnd={() => {
                  setDragging(undefined)
                  setOver(undefined)
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  {[4, 8, 12].flatMap((y) =>
                    [5, 11].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" />),
                  )}
                </svg>
              </button>
              <span className={styles.canvasBlockLabel} title={block.label}>
                {block.label}
              </span>
              <button
                type="button"
                aria-label={`Move ${block.label} up`}
                title="Move up"
                disabled={block.index === 0}
                onClick={() => move(block, block.index - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${block.label} down`}
                title="Move down"
                disabled={block.index === block.count - 1}
                onClick={() => move(block, block.index + 1)}
              >
                ↓
              </button>
            </div>
          </div>,
          element,
          `${block.key}:${block.path}:${block.id}`,
        ),
      )}
    </>
  )
}
