import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent, RefObject } from 'react'

import { dotFlight, releaseVelocity, resolveDotPosition } from './dot-placement.js'
import type { DotPosition, PointerSample } from './dot-placement.js'

type Drag = {
  id: number
  startX: number
  startY: number
  left: number
  top: number
  samples: PointerSample[]
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
  const [landing, setLanding] = useState<{
    x: number
    y: number
    velocity: { x: number; y: number }
  } | null>(null)
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
    const motion = dotFlight(landing, { x: bounds.left, y: bounds.top }, landing.velocity, {
      width: window.innerWidth,
      height: window.innerHeight,
    })
    const flight = element.animate(motion.frames, { duration: motion.duration, easing: 'linear' })
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
    const events = event.nativeEvent?.getCoalescedEvents?.() ?? []
    for (const sample of [...events, event]) {
      current.samples.push({ x: sample.clientX, y: sample.clientY, time: sample.timeStamp })
    }
    current.samples = current.samples.filter((sample) => sample.time >= event.timeStamp - 100)
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
      const velocity = releaseVelocity(current.samples, {
        x: event.clientX,
        y: event.clientY,
        time: event.timeStamp,
      })
      setLanding({
        x: current.left + event.clientX - current.startX,
        y: current.top + event.clientY - current.startY,
        velocity,
      })
      onDrop(
        resolveDotPosition(
          current.left + event.clientX - current.startX + 28,
          current.top + event.clientY - current.startY + 28,
          velocity.x,
          velocity.y,
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
