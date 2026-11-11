import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ScreenshotCapture } from './screenshot-capture.js'

const capture = vi.hoisted(() => vi.fn())
vi.mock('../../annotations/screenshot.js', () => ({ captureScreenshot: capture }))
vi.mock('./screenshot-capture.module.scss', () => ({ default: {} }))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const complete = vi.fn()
const cancel = vi.fn()
const draft = { id: 'note-1', point: { x: 300, y: 300 } }
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((item) => item.textContent === label)!
beforeEach(async () => {
  capture.mockReset().mockResolvedValue(undefined)
  complete.mockClear()
  cancel.mockClear()
  HTMLDialogElement.prototype.showModal = vi.fn()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      createElement(ScreenshotCapture, { draft, onComplete: complete, onCancel: cancel }),
    ),
  )
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
it('waits for the selected page capture to finish before completing the note', async () => {
  let finish!: () => void
  capture.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  await act(async () => button('Screenshot page').click())
  expect(capture).toHaveBeenCalledWith(draft.id, draft.point, undefined)
  expect(complete).not.toHaveBeenCalled()
  expect(button('Back').disabled).toBe(true)
  await act(async () => finish())
  expect(complete).toHaveBeenCalledOnce()
})
it('keeps a failed capture open for retry and supports going back without saving', async () => {
  capture.mockRejectedValueOnce(new Error('Storage unavailable'))
  await act(async () => button('Screenshot page').click())
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Storage unavailable')
  expect(complete).not.toHaveBeenCalled()
  await act(async () => button('Back').click())
  expect(cancel).toHaveBeenCalledOnce()
})
it('supports keyboard area selection and passes its bounds to capture', async () => {
  await act(async () => button('Screenshot area').click())
  expect(button('Capture area').disabled).toBe(true)
  await act(async () =>
    container
      .querySelector('[role="group"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
  )
  expect(button('Capture area').disabled).toBe(false)
  await act(async () => button('Capture area').click())
  expect(capture).toHaveBeenCalledWith(draft.id, draft.point, {
    x: 210,
    y: 220,
    width: 200,
    height: 160,
  })
  expect(complete).toHaveBeenCalledOnce()
})

it('requires a dragged area to contain the marker and handles reverse dragging', async () => {
  await act(async () => button('Screenshot area').click())
  const surface = container.querySelector('[role="group"]') as HTMLElement
  surface.setPointerCapture = vi.fn()
  const drag = async (x: number, y: number, endX: number, endY: number) => {
    await act(async () => {
      surface.dispatchEvent(
        new MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }),
      )
    })
    await act(async () => {
      surface.dispatchEvent(
        new MouseEvent('pointermove', { clientX: endX, clientY: endY, bubbles: true }),
      )
    })
    await act(async () => {
      surface.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    })
  }
  await drag(10, 10, 100, 100)
  expect(button('Capture area').disabled).toBe(true)
  await drag(400, 400, 200, 200)
  expect(button('Capture area').disabled).toBe(false)
  await act(async () => button('Capture area').click())
  expect(capture).toHaveBeenCalledWith(draft.id, draft.point, {
    x: 200,
    y: 200,
    width: 200,
    height: 200,
  })
})
