'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PayloadCMSDocument } from '../../types.js'
import { documentKey, fieldDocument } from '../../utils/field-target.js'
import styles from './styles.module.scss'
import { EditorIcon } from '../workspace/icons.js'

type Block = { key: string; path: string; id: string; label: string; index: number; count: number }

/** Controls stay in the preview document, including when the sidebar is portaled out. */
export function CanvasBlockControls({
  active,
  epoch,
  owner,
  lists,
  onMove,
  onEdit,
  onComment,
  selected,
  rearrange = false,
}: {
  active: boolean
  rearrange?: boolean
  selected?: { key: string; path: string; id: string }
  epoch: number
  owner: PayloadCMSDocument
  lists: { key: string; path: string; rows: { id: string; label: string }[] }[]
  onEdit?: (key: string, path: string, id: string) => void
  onComment?: (element: HTMLElement, label: string) => void
  onMove: (key: string, path: string, id: string, destination: number) => void
}) {
  const [targets, setTargets] = useState<{ element: HTMLElement; block: Block }[]>([])
  const [dragging, setDragging] = useState<Block>()
  const [settling, setSettling] = useState<Block>()
  const gesture = useRef<
    { block: Block; x: number; y: number; started: boolean; target?: Block } | undefined
  >(undefined)
  const [over, setOver] = useState<string>()
  const [announcement, setAnnouncement] = useState('')
  const [expanded, setExpanded] = useState<string>()
  const menuId = useId()
  const focusedControl = useRef<
    { label: string; blockId: string; key: string; path: string } | undefined
  >(undefined)

  useEffect(() => {
    const trackFocus = (event: FocusEvent) => {
      const button =
        event.target instanceof HTMLElement
          ? event.target.closest<HTMLButtonElement>('[data-canvas-block-bar] button')
          : null
      const blockId =
        button?.closest<HTMLElement>('[data-payload-block-id]')?.dataset.payloadBlockId
      const list = button?.closest<HTMLElement>('[data-payload-block-list]')
      focusedControl.current =
        button?.getAttribute('aria-label') && blockId && list
          ? {
              label: button.getAttribute('aria-label')!,
              blockId,
              key: documentKey(fieldDocument(list, owner)),
              path: list.dataset.payloadBlockList!,
            }
          : undefined
    }
    document.addEventListener('focusin', trackFocus)
    return () => document.removeEventListener('focusin', trackFocus)
  }, [owner])

  useLayoutEffect(() => {
    if (
      !active ||
      !document.hasFocus() ||
      !focusedControl.current ||
      document.activeElement !== document.body
    )
      return
    const focus = focusedControl.current
    const element = targets.find(
      ({ block }) =>
        block.id === focus.blockId && block.key === focus.key && block.path === focus.path,
    )?.element
    const buttons = element?.querySelectorAll<HTMLButtonElement>('[data-canvas-block-bar] button')
    const previous = Array.from(buttons ?? []).find(
      (button) => button.getAttribute('aria-label') === focus.label && !button.disabled,
    )
    ;(previous ?? buttons?.[0])?.focus({ preventScroll: true })
  }, [active, targets])

  useEffect(() => {
    if (!expanded) return
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-canvas-block-bar]'))
        setExpanded(undefined)
    }
    document.addEventListener('pointerdown', dismiss, true)
    return () => document.removeEventListener('pointerdown', dismiss, true)
  }, [expanded])

  useEffect(() => {
    if (!active) {
      setTargets([])
      setDragging(undefined)
      setSettling(undefined)
      gesture.current = undefined
      focusedControl.current = undefined
      setOver(undefined)
      setExpanded(undefined)
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
        const scrollMarginTop = element.style.scrollMarginTop
        element.style.scrollMarginTop = '120px'
        if (getComputedStyle(element).position === 'static') element.style.position = 'relative'
        element.setAttribute('data-arrange-block-controls', '')
        restore.push(() => {
          element.style.position = position
          element.style.scrollMarginTop = scrollMarginTop
          element.removeAttribute('data-arrange-block-controls')
        })
        next.push({ element, block: { key, path, ...rows[index], index, count: rows.length } })
      }
    }
    const placeBars = () => {
      const header = document.querySelector('header')
      const position = header && getComputedStyle(header).position
      const headerBottom =
        header && (position === 'fixed' || position === 'sticky')
          ? Math.max(0, header.getBoundingClientRect().bottom)
          : 0
      const narrow = window.matchMedia('(max-width: 480px), (pointer: coarse)').matches
      next.forEach(({ element }) => {
        const rect = element.getBoundingClientRect()
        const preferred = narrow ? 4 : -40
        const top = Math.min(
          Math.max(preferred, headerBottom + 8 - rect.top),
          Math.max(4, rect.height - 48),
        )
        element.style.setProperty('--canvas-bar-top', `${top}px`)
      })
    }
    placeBars()
    window.addEventListener('scroll', placeBars, true)
    window.addEventListener('resize', placeBars)
    setTargets(next)
    return () => {
      window.removeEventListener('scroll', placeBars, true)
      window.removeEventListener('resize', placeBars)
      next.forEach(({ element }) => element.style.removeProperty('--canvas-bar-top'))
      restore.forEach((undo) => undo())
    }
  }, [active, epoch, owner, lists])

  function move(block: Block, index: number) {
    if (index === block.index || index < 0 || index >= block.count) return
    setSettling(block)
    onMove(block.key, block.path, block.id, index)
    setExpanded(undefined)
    setAnnouncement(`${block.label} moved to position ${index + 1} of ${block.count}`)
  }

  useEffect(() => {
    if (!dragging) return
    let frame = 0
    const scroll = () => {
      const current = gesture.current
      if (!current) return
      const edge = 64
      const delta = current.y < edge ? -12 : current.y > window.innerHeight - edge ? 12 : 0
      if (delta) window.scrollBy(0, delta)
      frame = requestAnimationFrame(scroll)
    }
    frame = requestAnimationFrame(scroll)
    return () => cancelAnimationFrame(frame)
  }, [dragging])

  useEffect(() => {
    if (!settling) return
    const timer = window.setTimeout(() => setSettling(undefined), 260)
    return () => window.clearTimeout(timer)
  }, [settling])

  function updateDropTarget(x: number, y: number) {
    const current = gesture.current
    if (!current) return
    const element = document.elementFromPoint(x, y)?.closest('[data-payload-block-id]')
    const target = targets.find((entry) => entry.element === element)?.block
    current.target =
      target &&
      target.key === current.block.key &&
      target.path === current.block.path &&
      target.id !== current.block.id
        ? target
        : undefined
    setOver(current.target?.id)
  }

  if (!active) return null
  return (
    <>
      <span className={styles.canvasAnnouncement} role="status" aria-live="polite">
        {announcement}
      </span>
      {targets.map(({ element, block }) =>
        createPortal(
          <div
            className={`${styles.canvasBlockOverlay} ${dragging?.key === block.key && dragging.path === block.path && dragging.id === block.id ? styles.canvasBlockDragging : ''} ${settling?.key === block.key && settling.path === block.path && settling.id === block.id ? styles.canvasBlockSettling : ''} ${over === block.id ? styles.canvasBlockDrop : ''} ${expanded === `${block.key}:${block.path}:${block.id}` || (selected?.key === block.key && selected.path === block.path && selected.id === block.id) ? styles.canvasBlockOpen : ''}`}
            data-drop-edge={
              over === block.id && dragging
                ? block.index < dragging.index
                  ? 'before'
                  : 'after'
                : undefined
            }
            data-feedback-toolbar=""
            data-canvas-rearrange={rearrange ? '' : undefined}
            onPointerDown={(event) => {
              if (
                !rearrange ||
                event.button !== 0 ||
                block.count < 2 ||
                (event.target as Element).closest('[data-canvas-block-bar]')
              )
                return
              event.preventDefault()
              event.currentTarget
                .querySelector<HTMLButtonElement>('button')
                ?.focus({ preventScroll: true })
              event.currentTarget.setPointerCapture?.(event.pointerId)
              gesture.current = { block, x: event.clientX, y: event.clientY, started: false }
            }}
            onPointerMove={(event) => {
              const current = gesture.current
              if (!current) return
              if (
                !current.started &&
                Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5
              )
                return
              current.started = true
              current.x = event.clientX
              current.y = event.clientY
              setDragging(current.block)
              updateDropTarget(event.clientX, event.clientY)
            }}
            onPointerUp={(event) => {
              const current = gesture.current
              if (current?.started) {
                updateDropTarget(event.clientX, event.clientY)
                if (current.target) move(current.block, current.target.index)
              }
              gesture.current = undefined
              setDragging(undefined)
              setOver(undefined)
            }}
            onPointerCancel={() => {
              gesture.current = undefined
              setDragging(undefined)
              setOver(undefined)
            }}
            key={block.id}
          >
            <div
              className={styles.canvasBlockBar}
              role="group"
              aria-label={`${block.label} block controls`}
              data-canvas-block-bar=""
              onKeyDown={(event) => {
                if (event.key === 'Escape' && expanded) {
                  event.preventDefault()
                  event.stopPropagation()
                  setExpanded(undefined)
                  event.currentTarget.querySelector<HTMLButtonElement>('[aria-expanded]')?.focus()
                }
              }}
            >
              <button
                type="button"
                className={styles.canvasBlockGrip}
                onPointerDown={(event) => {
                  if (event.button !== 0 || block.count < 2) return
                  event.preventDefault()
                  event.currentTarget.focus({ preventScroll: true })
                  event.currentTarget.setPointerCapture?.(event.pointerId)
                  gesture.current = { block, x: event.clientX, y: event.clientY, started: false }
                }}
                aria-label={`Drag ${block.label} to reorder. Use arrow keys to move.`}
                title="Drag to reorder · ↑ / ↓ to move"
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault()
                    event.stopPropagation()
                    move(block, block.index + (event.key === 'ArrowUp' ? -1 : 1))
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    gesture.current = undefined
                    setDragging(undefined)
                    setOver(undefined)
                  }
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
              {onEdit && (
                <button
                  type="button"
                  className={styles.canvasBlockEdit}
                  aria-label={`Edit ${block.label} block`}
                  onClick={() => onEdit(block.key, block.path, block.id)}
                >
                  Edit
                </button>
              )}
              {onComment && (
                <button
                  type="button"
                  aria-label={`Comment on ${block.label}`}
                  title="Comment"
                  onClick={() => onComment(element, block.label)}
                >
                  <EditorIcon name="comment" />
                </button>
              )}
              <button
                type="button"
                aria-label={`Move ${block.label} up`}
                title="Move up"
                disabled={block.index === 0}
                onClick={() => move(block, block.index - 1)}
              >
                <span aria-hidden="true">↑</span>
              </button>
              <button
                type="button"
                aria-label={`Move ${block.label} down`}
                title="Move down"
                disabled={block.index === block.count - 1}
                onClick={() => move(block, block.index + 1)}
              >
                <span aria-hidden="true">↓</span>
              </button>
              <button
                type="button"
                aria-label={`More actions for ${block.label}`}
                title="More actions"
                aria-expanded={expanded === `${block.key}:${block.path}:${block.id}`}
                aria-controls={`${menuId}-${block.id}`}
                onClick={() =>
                  setExpanded((current) =>
                    current === `${block.key}:${block.path}:${block.id}`
                      ? undefined
                      : `${block.key}:${block.path}:${block.id}`,
                  )
                }
              >
                <EditorIcon name="down" />
              </button>
              {expanded === `${block.key}:${block.path}:${block.id}` && (
                <div className={styles.canvasBlockMenu} id={`${menuId}-${block.id}`}>
                  <span>
                    Block {block.index + 1} of {block.count}
                  </span>
                  <button type="button" disabled={block.index === 0} onClick={() => move(block, 0)}>
                    Move to first
                  </button>
                  <button
                    type="button"
                    disabled={block.index === block.count - 1}
                    onClick={() => move(block, block.count - 1)}
                  >
                    Move to last
                  </button>
                </div>
              )}
            </div>
          </div>,
          element,
          `${block.key}:${block.path}:${block.id}`,
        ),
      )}
    </>
  )
}
