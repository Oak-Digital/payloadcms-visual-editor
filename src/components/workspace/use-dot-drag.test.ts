import { act, createElement } from 'react'
import type { PointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useDotDrag } from './use-dot-drag.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

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
      drag.handlers.onPointerMove(event(200, 40))
      drag.handlers.onPointerUp(event(200, 41))
    })
    expect(drop).toHaveBeenLastCalledWith('bottom-right')
    expect(drag.consumeClick()).toBe(true)
    expect(drag.offset).toBeNull()
    act(() => {
      drag.handlers.onPointerDown(event(28, 50))
      drag.handlers.onPointerMove(event(200, 60))
      drag.handlers.onPointerUp(event(200, 200))
    })
    expect(drop).toHaveBeenLastCalledWith('top-left')
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
