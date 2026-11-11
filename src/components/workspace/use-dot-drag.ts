import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent, RefObject } from 'react'

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
  samples: { x: number; y: number; time: number }[]
  baseLeft: number
  baseTop: number
  moved: boolean
}

export function useDotDrag(
  onDrop: (position: DotPosition) => void,
  container?: RefObject<HTMLElement | null>,
  reduceMotion = false,
  open = false,
) {
  const drag = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)

  const animation = useRef<Animation | null>(null)
  const [landing, setLanding] = useState<{ x: number; y: number } | null>(null)
  const [systemReduceMotion, setSystemReduceMotion] = useState(false)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setSystemReduceMotion(preference.matches)
    update()
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  useLayoutEffect(() => {
    const element = container?.current
    if (!landing || !element || reduceMotion || systemReduceMotion || open) {
      setLanding(null)
      return
    }
    const bounds = element.getBoundingClientRect()
    const x = landing.x - bounds.left
    const y = landing.y - bounds.top
    const distance = Math.hypot(x, y)
    const bounce = Math.min(6, distance * 0.025)
    const dx = distance ? (-x / distance) * bounce : 0
    const dy = distance ? (-y / distance) * bounce : 0
    const flight = element.animate(
      [
        {
          transform: `translate(${x}px, ${y}px)`,
          offset: 0,
          easing: 'cubic-bezier(0.16, 0.7, 0.3, 1)',
        },
        { transform: `translate(${dx}px, ${dy}px)`, offset: 0.8, easing: 'ease-in-out' },
        { transform: 'translate(0, 0)', offset: 1 },
      ],
      { duration: Math.min(850, 440 + distance * 0.25) },
    )
    animation.current = flight
    flight.onfinish = () => setLanding(null)
    return () => {
      flight.cancel()
      animation.current = null
    }
  }, [landing, container, reduceMotion, systemReduceMotion, open])

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    if (event.clientX !== current.x || event.clientY !== current.y) {
      current.samples.push({ x: event.clientX, y: event.clientY, time: event.timeStamp })
      while (current.samples.length > 2 && current.samples[1].time < event.timeStamp - 100) {
        current.samples.shift()
      }
    }
    current.x = event.clientX
    current.y = event.clientY
    const x = event.clientX - current.startX
    const y = event.clientY - current.startY
    current.moved ||= Math.hypot(x, y) > 6
    if (current.moved)
      setOffset({
        x: current.left - current.baseLeft + x,
        y: current.top - current.baseTop + y,
      })
  }

  function finish(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    suppressClick.current = current.moved
    if (current.moved && !cancelled) {
      const last = current.samples[current.samples.length - 1]
      const first = current.samples[0]
      const elapsed = last.time - first.time
      const recent = event.timeStamp - last.time < 120 && elapsed > 0
      setLanding({
        x: current.left + event.clientX - current.startX,
        y: current.top + event.clientY - current.startY,
      })
      onDrop(
        resolveDotPosition(
          current.left + event.clientX - current.startX + 28,
          current.top + event.clientY - current.startY + 28,
          recent ? (last.x - first.x) / elapsed : 0,
          recent ? (last.y - first.y) / elapsed : 0,
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
    settling: Boolean(landing),
    consumeClick: () => {
      const suppressed = suppressClick.current
      suppressClick.current = false
      return suppressed
    },
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0 || !event.isPrimary) return
        const bounds = (container?.current ?? event.currentTarget).getBoundingClientRect()
        animation.current?.cancel()
        setLanding(null)
        const base = (container?.current ?? event.currentTarget).getBoundingClientRect()
        setOffset({ x: bounds.left - base.left, y: bounds.top - base.top })
        suppressClick.current = false
        drag.current = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          baseLeft: base.left,
          baseTop: base.top,
          left: bounds.left,
          top: bounds.top,
          x: event.clientX,
          y: event.clientY,
          samples: [{ x: event.clientX, y: event.clientY, time: event.timeStamp }],
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
