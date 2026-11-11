import { act, createElement, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { STATUS_IDLE_DELAY, useStatusCollapse } from './use-status-collapse.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let panel: ReturnType<typeof useStatusCollapse>
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
function Test({ status = 'Draft saved', blocked = false, active = true }) {
  const preview = useRef<HTMLIFrameElement>(null)
  panel = useStatusCollapse({ status, blocked, active, preview })
  return createElement(
    'div',
    null,
    createElement('iframe', { ref: preview }),
    createElement('footer', { ref: panel.footer }, createElement('button', null, 'Status')),
  )
}
const render = (props = {}) => act(() => root.render(createElement(Test, props)))
const wait = (ms = STATUS_IDLE_DELAY) => act(() => vi.advanceTimersByTime(ms))
const activity = (target: EventTarget, name = 'pointerdown') =>
  act(() => {
    target.dispatchEvent(new Event(name, { bubbles: true }))
  })
beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

it('collapses after idle and reopens for each new status with a fresh delay', () => {
  render()
  wait(STATUS_IDLE_DELAY - 1)
  expect(panel.collapsed).toBe(false)
  wait(1)
  expect(panel.collapsed).toBe(true)
  render({ status: 'Unsaved' })
  expect(panel.collapsed).toBe(false)
  wait()
  expect(panel.collapsed).toBe(true)
  render({ status: 'Draft saved' })
  expect(panel.collapsed).toBe(false)
  wait()
  expect(panel.collapsed).toBe(true)
})
it('restarts for workspace and preview activity, including iframe reloads', () => {
  render()
  wait(4000)
  activity(document, 'keydown')
  wait(4000)
  expect(panel.collapsed).toBe(false)
  const frame = container.querySelector('iframe')!
  activity(frame, 'load')
  activity(frame.contentDocument!, 'input')
  wait(4000)
  expect(panel.collapsed).toBe(false)
  wait(1000)
  expect(panel.collapsed).toBe(true)
})
it('keeps hovered and keyboard-focused controls expanded until leaving', () => {
  render()
  const footer = container.querySelector('footer')!
  activity(footer, 'pointerenter')
  wait(10000)
  expect(panel.collapsed).toBe(false)
  activity(footer, 'pointerleave')
  act(() => container.querySelector('button')!.focus())
  wait(10000)
  expect(panel.collapsed).toBe(false)
  act(() => container.querySelector('button')!.blur())
  wait()
  expect(panel.collapsed).toBe(true)
})
it('pins busy, errors and recovery open and pauses when the editor closes', () => {
  render()
  wait()
  for (const status of ['Save failed', 'Saving…', 'Restore edits']) {
    render({ status, blocked: true })
    expect(panel.collapsed).toBe(false)
    act(() => panel.toggle())
    wait(10000)
    expect(panel.collapsed).toBe(false)
  }
  render({ active: false })
  wait(10000)
  expect(panel.collapsed).toBe(false)
  render()
  wait()
  expect(panel.collapsed).toBe(true)
})
it('supports manual toggles and removes timers and listeners on unmount', () => {
  render()
  act(() => panel.toggle())
  expect(panel.collapsed).toBe(true)
  wait()
  expect(panel.collapsed).toBe(true)
  act(() => panel.toggle())
  expect(panel.collapsed).toBe(false)
  wait()
  expect(panel.collapsed).toBe(true)
  act(() => root.render(null))
  activity(document)
  expect(vi.getTimerCount()).toBe(0)
})
