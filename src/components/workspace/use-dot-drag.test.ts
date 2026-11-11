import { act, createElement } from 'react'
import type { PointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useDotDrag } from './use-dot-drag.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.stubGlobal('matchMedia', () => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}))

it('distinguishes clicks, throws, paused releases and cancelled drags', () => {
  const drop = vi.fn()
  let drag!: ReturnType<typeof useDotDrag>
  function Test() {
    drag = useDotDrag(drop)
    return null
  }
  const root = createRoot(document.createElement('div'))
  const button = document.createElement('button')
  button.setPointerCapture = vi.fn()
  button.hasPointerCapture = () => false
  const event = (x: number, time: number) =>
    ({
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: x,
      clientY: x,
      timeStamp: time,
      currentTarget: button,
    }) as PointerEvent<HTMLButtonElement>
  act(() => root.render(createElement(Test)))
  try {
    act(() => {
      drag.handlers.onPointerDown(event(28, 0))
      drag.handlers.onPointerUp(event(29, 10))
    })
    expect(drop).not.toHaveBeenCalled()
    expect(drag.consumeClick()).toBe(false)
    act(() => {
      drag.handlers.onPointerDown(event(28, 20))
      drag.handlers.onPointerMove(event(110, 40))
      drag.handlers.onPointerMove(event(200, 60))
      drag.handlers.onPointerUp(event(200, 61))
    })
    expect(drop).toHaveBeenLastCalledWith('bottom-right')
    expect(drag.consumeClick()).toBe(true)
    expect(drag.offset).toBeNull()
    act(() => {
      drag.handlers.onPointerDown(event(28, 50))
      drag.handlers.onPointerMove(event(88, 450))
      drag.handlers.onPointerUp(event(88, 700))
    })
    expect(drop).toHaveBeenLastCalledWith('bottom-right')
    drop.mockClear()
    act(() => {
      drag.handlers.onPointerDown(event(28, 210))
      drag.handlers.onPointerMove(event(800, 230))
      drag.handlers.onPointerCancel(event(800, 240))
    })
    expect(drop).not.toHaveBeenCalled()
    expect(drag.offset).toBeNull()
    expect(drag.consumeClick()).toBe(true)
  } finally {
    act(() => root.unmount())
  }
})

it('glides from the release point, cancels motion on re-grab, and honors reduced motion', () => {
  const element = document.createElement('aside')
  const flight = { cancel: vi.fn(), onfinish: null as (() => void) | null }
  element.animate = vi.fn(() => flight as unknown as Animation)
  const container = { current: element }
  const button = document.createElement('button')
  button.setPointerCapture = vi.fn()
  button.hasPointerCapture = () => false
  let drag!: ReturnType<typeof useDotDrag>
  function Test({ reduced = false }) {
    drag = useDotDrag(vi.fn(), container, reduced)
    return null
  }
  const root = createRoot(document.createElement('div'))
  const event = (x: number, timeStamp: number) =>
    ({
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: x,
      clientY: x,
      timeStamp,
      currentTarget: button,
    }) as PointerEvent<HTMLButtonElement>
  const throwDot = () => {
    act(() => drag.handlers.onPointerDown(event(28, 0)))
    act(() => drag.handlers.onPointerMove(event(200, 20)))
    act(() => drag.handlers.onPointerUp(event(200, 21)))
  }
  act(() => root.render(createElement(Test)))
  try {
    throwDot()
    expect(element.animate).toHaveBeenCalledOnce()
    expect(drag.settling).toBe(true)
    act(() => drag.handlers.onPointerDown(event(100, 30)))
    expect(flight.cancel).toHaveBeenCalled()
    expect(drag.settling).toBe(false)
    act(() => drag.handlers.onPointerCancel(event(100, 40)))
    act(() => root.render(createElement(Test, { reduced: true })))
    throwDot()
    expect(element.animate).toHaveBeenCalledOnce()
    expect(drag.settling).toBe(false)
  } finally {
    act(() => root.unmount())
  }
})

it('keeps the grabbed point stable through idle motion and clamps dragging to the viewport', () => {
  const element = document.createElement('aside')
  let idle = true
  element.getBoundingClientRect = () => ({ left: 24, top: idle ? 20 : 24 }) as DOMRect
  element.getAnimations = () =>
    [
      {
        cancel: () => {
          idle = false
        },
      },
    ] as Animation[]
  const container = { current: element }
  const button = document.createElement('button')
  button.setPointerCapture = vi.fn()
  button.hasPointerCapture = () => false
  let drag!: ReturnType<typeof useDotDrag>
  function Test() {
    drag = useDotDrag(vi.fn(), container, true)
    return null
  }
  const root = createRoot(document.createElement('div'))
  const event = (x: number, y: number) =>
    ({
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: x,
      clientY: y,
      timeStamp: 0,
      currentTarget: button,
    }) as PointerEvent<HTMLButtonElement>
  act(() => root.render(createElement(Test)))
  try {
    act(() => drag.handlers.onPointerDown(event(52, 48)))
    expect(drag.offset).toEqual({ x: 0, y: -4 })
    act(() => drag.handlers.onPointerMove(event(152, 148)))
    expect(drag.offset).toEqual({ x: 100, y: 96 })
    act(() => drag.handlers.onPointerMove(event(-200, -200)))
    expect(drag.offset).toEqual({ x: 8 - 24, y: 8 - 24 })
    act(() => drag.handlers.onPointerMove(event(10000, 10000)))
    expect(drag.offset).toEqual({ x: innerWidth - 64 - 24, y: innerHeight - 64 - 24 })
    act(() => drag.handlers.onPointerCancel(event(10000, 10000)))
    expect(drag.offset).toBeNull()
  } finally {
    act(() => root.unmount())
  }
})
