'use client'

import { useEffect, useRef, useState } from 'react'
import {
  captureScreenshot,
  type CaptureBounds,
  type CapturePoint,
} from '../../annotations/screenshot.js'
import styles from './screenshot-capture.module.scss'

export function ScreenshotCapture({
  draft,
  onCancel,
  onComplete,
}: {
  draft: { id: string; point: CapturePoint }
  onCancel: () => void
  onComplete: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const start = useRef<CapturePoint | null>(null)
  const busy = useRef(false)
  const [areaMode, setAreaMode] = useState(false)
  const [area, setArea] = useState<CaptureBounds | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current
    const preventScroll = (event: WheelEvent) => event.preventDefault()
    element?.addEventListener('wheel', preventScroll, { passive: false })
    element?.showModal()
    return () => {
      element?.removeEventListener('wheel', preventScroll)
      previous?.focus()
    }
  }, [])
  const capture = async (bounds?: CaptureBounds) => {
    if (busy.current) return
    busy.current = true
    setCapturing(true)
    setError('')
    try {
      await captureScreenshot(draft.id, draft.point, bounds)
      onComplete()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to capture screenshot.')
    } finally {
      busy.current = false
      setCapturing(false)
    }
  }
  const includesMarker =
    area &&
    area.width >= 24 &&
    area.height >= 24 &&
    draft.point.x >= area.x &&
    draft.point.x <= area.x + area.width &&
    draft.point.y >= area.y &&
    draft.point.y <= area.y + area.height
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      data-annotation-popup
      aria-label="Screenshot"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy.current) onCancel()
      }}
    >
      {areaMode && (
        <div
          className={styles.selection}
          aria-label="Screenshot area. Arrow keys move; Shift and arrow keys resize."
          role="group"
          tabIndex={0}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
            event.preventDefault()
            if (busy.current) return
            const dx = event.key === 'ArrowLeft' ? -10 : event.key === 'ArrowRight' ? 10 : 0
            const dy = event.key === 'ArrowUp' ? -10 : event.key === 'ArrowDown' ? 10 : 0
            setArea((current) => {
              const rect = current ?? {
                x: Math.max(window.scrollX, draft.point.x - 100),
                y: Math.max(window.scrollY, draft.point.y - 80),
                width: 200,
                height: 160,
              }
              return event.shiftKey
                ? {
                    ...rect,
                    width: Math.max(
                      24,
                      Math.min(window.scrollX + window.innerWidth - rect.x, rect.width + dx),
                    ),
                    height: Math.max(
                      24,
                      Math.min(window.scrollY + window.innerHeight - rect.y, rect.height + dy),
                    ),
                  }
                : {
                    ...rect,
                    x: Math.max(
                      window.scrollX,
                      Math.min(window.scrollX + window.innerWidth - rect.width, rect.x + dx),
                    ),
                    y: Math.max(
                      window.scrollY,
                      Math.min(window.scrollY + window.innerHeight - rect.height, rect.y + dy),
                    ),
                  }
            })
          }}
          onPointerDown={(event) => {
            if (busy.current) return
            event.currentTarget.setPointerCapture(event.pointerId)
            start.current = { x: event.clientX + window.scrollX, y: event.clientY + window.scrollY }
            setArea(null)
          }}
          onPointerMove={(event) => {
            if (!start.current || busy.current) return
            const x = event.clientX + window.scrollX,
              y = event.clientY + window.scrollY
            setArea({
              x: Math.min(x, start.current.x),
              y: Math.min(y, start.current.y),
              width: Math.abs(x - start.current.x),
              height: Math.abs(y - start.current.y),
            })
          }}
          onPointerUp={() => {
            start.current = null
          }}
          onPointerCancel={() => {
            start.current = null
          }}
        >
          {area && (
            <div
              className={styles.rectangle}
              style={{
                left: area.x - window.scrollX,
                top: area.y - window.scrollY,
                width: area.width,
                height: area.height,
              }}
            />
          )}
          <span
            className={styles.marker}
            style={{ left: draft.point.x - window.scrollX, top: draft.point.y - window.scrollY }}
          />
        </div>
      )}
      <div
        className={styles.controls}
        style={
          areaMode && draft.point.y - window.scrollY > window.innerHeight / 2
            ? { top: 20, bottom: 'auto' }
            : undefined
        }
      >
        <h2>Screenshot</h2>
        {areaMode && <p>Drag an area around the blue marker.</p>}
        {error && <p role="alert">{error}</p>}
        {capturing && <p role="status">Capturing screenshot…</p>}
        <nav>
          <button
            type="button"
            disabled={capturing}
            onClick={() => (areaMode ? setAreaMode(false) : onCancel())}
          >
            Back
          </button>
          {areaMode ? (
            <button
              type="button"
              disabled={capturing || !includesMarker}
              onClick={() => area && void capture(area)}
            >
              Capture area
            </button>
          ) : (
            <>
              <button type="button" disabled={capturing} onClick={() => setAreaMode(true)}>
                Screenshot area
              </button>
              <button type="button" disabled={capturing} onClick={() => void capture()}>
                Screenshot page
              </button>
            </>
          )}
        </nav>
      </div>
    </dialog>
  )
}
