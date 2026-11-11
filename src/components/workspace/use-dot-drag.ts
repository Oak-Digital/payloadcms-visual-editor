import { useRef, useState } from 'react'
import type { PointerEvent } from 'react'

import { resolveDotPosition } from './dot-placement.js'
import type { DotPosition } from './dot-placement.js'

type Drag = {
  id: number
  startX: number
  startY: number
  left: number
  top: number
  x: number
  y: number
  time: number
  vx: number
  vy: number
  moved: boolean
}

export function useDotDrag(onDrop: (position: DotPosition) => void) {
  const drag = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    const elapsed = event.timeStamp - current.time
    if (elapsed > 0) {
      current.vx = (event.clientX - current.x) / elapsed
      current.vy = (event.clientY - current.y) / elapsed
    }
    current.x = event.clientX
    current.y = event.clientY
    current.time = event.timeStamp
    const x = event.clientX - current.startX
    const y = event.clientY - current.startY
    current.moved ||= Math.hypot(x, y) > 6
    if (current.moved) setOffset({ x, y })
  }

  function finish(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    suppressClick.current = current.moved
    if (current.moved && !cancelled) {
      const recent = event.timeStamp - current.time < 100
      onDrop(
        resolveDotPosition(
          current.left + event.clientX - current.startX + 28,
          current.top + event.clientY - current.startY + 28,
          recent ? current.vx : 0,
          recent ? current.vy : 0,
          window.innerWidth,
          window.innerHeight,
        ),
      )
    }
    drag.current = null
    setOffset(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return {
    offset,
    consumeClick: () => {
      const suppressed = suppressClick.current
      suppressClick.current = false
      return suppressed
    },
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0 || !event.isPrimary) return
        const bounds = event.currentTarget.getBoundingClientRect()
        suppressClick.current = false
        drag.current = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          left: bounds.left,
          top: bounds.top,
          x: event.clientX,
          y: event.clientY,
          time: event.timeStamp,
          vx: 0,
          vy: 0,
          moved: false,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      },
      onPointerMove: move,
      onPointerUp: (event: PointerEvent<HTMLButtonElement>) => finish(event),
      onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => finish(event, true),
      onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => finish(event, true),
    },
  }
}
